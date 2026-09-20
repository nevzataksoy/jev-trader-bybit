import postgres from "postgres";
import type {
  BotExecutionResult,
  BotRunSummary,
  DailyPortfolioPoint,
  JevDecision,
  OrderHistoryItem,
  PortfolioSnapshot,
  TickerPrices,
} from "./types";

let sqlClient: ReturnType<typeof postgres> | null = null;
let schemaPromise: Promise<void> | null = null;

export function isDatabaseConfigured() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && url.hostname !== "host"
      && url.username !== "user"
      && url.pathname !== "/database";
  } catch {
    return false;
  }
}

function getSql() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!sqlClient) {
    sqlClient = postgres(connectionString, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return sqlClient;
}

async function createSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS bot_runs (
      cycle_key TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
      model TEXT,
      market_state JSONB,
      decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
      executions JSONB NOT NULL DEFAULT '[]'::jsonb,
      error TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id BIGSERIAL PRIMARY KEY,
      cycle_key TEXT NOT NULL UNIQUE,
      captured_at TIMESTAMPTZ NOT NULL,
      total_portfolio_usdt NUMERIC(30, 10) NOT NULL,
      balances JSONB NOT NULL,
      prices JSONB NOT NULL,
      CONSTRAINT portfolio_snapshots_run_fk
        FOREIGN KEY (cycle_key) REFERENCES bot_runs(cycle_key) ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS spot_orders (
      order_id TEXT PRIMARY KEY,
      order_link_id TEXT NOT NULL DEFAULT '',
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL,
      qty NUMERIC(40, 18) NOT NULL DEFAULT 0,
      price NUMERIC(40, 18) NOT NULL DEFAULT 0,
      avg_price NUMERIC(40, 18) NOT NULL DEFAULT 0,
      cum_exec_qty NUMERIC(40, 18) NOT NULL DEFAULT 0,
      cum_exec_value NUMERIC(40, 18) NOT NULL DEFAULT 0,
      fee NUMERIC(40, 18) NOT NULL DEFAULT 0,
      fee_currency TEXT NOT NULL DEFAULT '',
      order_status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      executed_at TIMESTAMPTZ,
      is_open BOOLEAN NOT NULL DEFAULT FALSE,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS portfolio_snapshots_captured_idx ON portfolio_snapshots(captured_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS spot_orders_created_idx ON spot_orders(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS bot_runs_started_idx ON bot_runs(started_at DESC)`;
}

export async function ensureDatabase() {
  if (!schemaPromise) {
    schemaPromise = createSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function beginBotRun(cycleKey: string) {
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO bot_runs (cycle_key, started_at, status)
    VALUES (${cycleKey}, NOW(), 'running')
    ON CONFLICT (cycle_key) DO UPDATE
      SET started_at = NOW(), completed_at = NULL, status = 'running', error = NULL
      WHERE bot_runs.status = 'failed'
         OR (bot_runs.status = 'running' AND bot_runs.started_at < NOW() - INTERVAL '12 minutes')
    RETURNING cycle_key
  `;
  return rows.length === 1;
}

export async function savePortfolioSnapshot(cycleKey: string, snapshot: PortfolioSnapshot) {
  await ensureDatabase();
  const sql = getSql();
  await sql`
    INSERT INTO portfolio_snapshots (
      cycle_key, captured_at, total_portfolio_usdt, balances, prices
    ) VALUES (
      ${cycleKey}, ${snapshot.capturedAt}::timestamptz, ${snapshot.totalPortfolioUsdt},
      ${JSON.stringify(snapshot.balances)}::jsonb, ${JSON.stringify(snapshot.prices)}::jsonb
    )
    ON CONFLICT (cycle_key) DO UPDATE SET
      captured_at = EXCLUDED.captured_at,
      total_portfolio_usdt = EXCLUDED.total_portfolio_usdt,
      balances = EXCLUDED.balances,
      prices = EXCLUDED.prices
  `;
}

export async function completeBotRun(
  cycleKey: string,
  model: string,
  marketState: unknown,
  decisions: JevDecision[],
  executions: BotExecutionResult[],
) {
  const sql = getSql();
  await sql`
    UPDATE bot_runs
    SET completed_at = NOW(), status = 'completed', model = ${model},
        market_state = ${JSON.stringify(marketState)}::jsonb,
        decisions = ${JSON.stringify(decisions)}::jsonb,
        executions = ${JSON.stringify(executions)}::jsonb,
        error = NULL
    WHERE cycle_key = ${cycleKey}
  `;
}

export async function failBotRun(cycleKey: string, error: unknown) {
  if (!isDatabaseConfigured()) return;
  await ensureDatabase();
  const sql = getSql();
  const message = error instanceof Error ? error.message : "Unknown cron failure";
  await sql`
    UPDATE bot_runs
    SET completed_at = NOW(), status = 'failed', error = ${message.slice(0, 2_000)}
    WHERE cycle_key = ${cycleKey}
  `;
}

function timestampFromMillis(value: string | null) {
  if (!value) return null;
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null;
}

export async function upsertOrders(orders: OrderHistoryItem[]) {
  if (!isDatabaseConfigured() || orders.length === 0) return;
  await ensureDatabase();
  const sql = getSql();
  for (const order of orders) {
    const createdAt = timestampFromMillis(order.createdTime);
    const updatedAt = timestampFromMillis(order.updatedTime);
    if (!createdAt || !updatedAt) continue;
    const executedAt = timestampFromMillis(order.executedTime);
    await sql`
      INSERT INTO spot_orders (
        order_id, order_link_id, symbol, side, order_type, qty, price, avg_price,
        cum_exec_qty, cum_exec_value, fee, fee_currency, order_status,
        created_at, updated_at, executed_at, is_open, synced_at
      ) VALUES (
        ${order.orderId}, ${order.orderLinkId}, ${order.symbol}, ${order.side}, ${order.orderType},
        ${Number(order.qty || 0)}, ${Number(order.price || 0)}, ${Number(order.avgPrice || 0)},
        ${Number(order.cumExecQty || 0)}, ${Number(order.cumExecValue || 0)}, ${Number(order.fee || 0)},
        ${order.feeCurrency}, ${order.orderStatus}, ${createdAt}::timestamptz,
        ${updatedAt}::timestamptz, ${executedAt}::timestamptz, ${order.isOpen}, NOW()
      )
      ON CONFLICT (order_id) DO UPDATE SET
        order_link_id = EXCLUDED.order_link_id,
        symbol = EXCLUDED.symbol,
        side = EXCLUDED.side,
        order_type = EXCLUDED.order_type,
        qty = EXCLUDED.qty,
        price = EXCLUDED.price,
        avg_price = EXCLUDED.avg_price,
        cum_exec_qty = EXCLUDED.cum_exec_qty,
        cum_exec_value = EXCLUDED.cum_exec_value,
        fee = EXCLUDED.fee,
        fee_currency = EXCLUDED.fee_currency,
        order_status = EXCLUDED.order_status,
        updated_at = EXCLUDED.updated_at,
        executed_at = COALESCE(EXCLUDED.executed_at, spot_orders.executed_at),
        is_open = EXCLUDED.is_open,
        synced_at = NOW()
    `;
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export async function getDailyPortfolioHistory(
  days = 90,
  timeZone: "UTC" | "Europe/Istanbul" = "UTC",
): Promise<DailyPortfolioPoint[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    WITH localized_snapshots AS (
      SELECT
        (captured_at AT TIME ZONE ${timeZone})::date AS local_date,
        captured_at,
        total_portfolio_usdt,
        prices
      FROM portfolio_snapshots
      WHERE captured_at >= NOW() - (${days} * INTERVAL '1 day')
    )
    SELECT DISTINCT ON (local_date)
      local_date::text AS date,
      captured_at,
      total_portfolio_usdt,
      prices
    FROM localized_snapshots
    ORDER BY local_date DESC, captured_at DESC
  `;
  return rows
    .map((row) => ({
      date: String(row.date),
      capturedAt: new Date(String(row.captured_at)).toISOString(),
      totalPortfolioUsdt: Number(row.total_portfolio_usdt),
      prices: parseJson<TickerPrices>(row.prices, { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 }),
    }))
    .reverse();
}

export async function getStoredOrders(limit = 200): Promise<OrderHistoryItem[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM spot_orders ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => ({
    orderId: String(row.order_id),
    orderLinkId: String(row.order_link_id),
    symbol: String(row.symbol),
    side: String(row.side) as "Buy" | "Sell",
    orderType: String(row.order_type),
    qty: String(row.qty),
    price: String(row.price),
    avgPrice: String(row.avg_price),
    cumExecQty: String(row.cum_exec_qty),
    cumExecValue: String(row.cum_exec_value),
    fee: String(row.fee),
    feeCurrency: String(row.fee_currency),
    orderStatus: String(row.order_status),
    createdTime: String(new Date(String(row.created_at)).getTime()),
    updatedTime: String(new Date(String(row.updated_at)).getTime()),
    executedTime: row.executed_at ? String(new Date(String(row.executed_at)).getTime()) : null,
    isOpen: Boolean(row.is_open),
  }));
}

export async function getRecentRuns(limit = 12): Promise<BotRunSummary[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    SELECT cycle_key, started_at, completed_at, status, model, market_state, decisions, executions, error
    FROM bot_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => ({
    cycleKey: String(row.cycle_key),
    startedAt: new Date(String(row.started_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    status: String(row.status) as BotRunSummary["status"],
    model: row.model ? String(row.model) : null,
    marketState: parseJson<BotRunSummary["marketState"]>(row.market_state, null),
    decisions: parseJson<JevDecision[]>(row.decisions, []),
    executions: parseJson<BotExecutionResult[]>(row.executions, []),
    error: row.error ? String(row.error) : null,
  }));
}
