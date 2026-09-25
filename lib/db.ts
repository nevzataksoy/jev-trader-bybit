import postgres from "postgres";
import { getDatabaseMaintenanceConfig } from "./config";
import { getSafeErrorMessage } from "./errors";
import { asPostgresJson } from "./postgres-json";
import type {
  BotExecutionResult,
  BotRunSummary,
  DailyPortfolioPoint,
  DecisionContextSnapshot,
  JevDecision,
  MacroState,
  MarketIndicatorState,
  OrderHistoryItem,
  PortfolioSnapshot,
  PortfolioRiskContext,
  TickerPrices,
  TradeAsset,
} from "./types";

let sqlClient: ReturnType<typeof postgres> | null = null;

export type DatabaseProvider = "supabase" | "neon" | "postgresql";
export type DatabaseConnectionMode = "transaction_pooler" | "session_pooler" | "direct";

export interface DatabaseConnectionInfo {
  configured: boolean;
  provider: DatabaseProvider | null;
  connectionMode: DatabaseConnectionMode | null;
}

export function getDatabaseConnectionInfo(): DatabaseConnectionInfo {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return { configured: false, provider: null, connectionMode: null };
  try {
    const url = new URL(connectionString);
    const configured = (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && url.hostname !== "host"
      && url.username !== "user"
      && url.pathname !== "/database";
    if (!configured) return { configured: false, provider: null, connectionMode: null };

    const hostname = url.hostname.toLowerCase();
    const isSupabase = hostname.endsWith(".supabase.co")
      || hostname.endsWith(".supabase.com")
      || hostname.includes(".pooler.supabase.");
    const provider: DatabaseProvider = isSupabase
      ? "supabase"
      : hostname.endsWith(".neon.tech") ? "neon" : "postgresql";
    const port = url.port || "5432";
    const connectionMode: DatabaseConnectionMode = isSupabase && port === "6543"
      ? "transaction_pooler"
      : isSupabase && hostname.includes(".pooler.supabase.") && port === "5432"
        ? "session_pooler"
        : "direct";

    return { configured: true, provider, connectionMode };
  } catch {
    return { configured: false, provider: null, connectionMode: null };
  }
}

export function isDatabaseConfigured() {
  return getDatabaseConnectionInfo().configured;
}

export async function checkDatabaseConnection() {
  if (!isDatabaseConfigured()) return false;
  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 AS ok`;
    return Number(rows[0]?.ok ?? 0) === 1;
  } catch {
    return false;
  }
}

export function getSql() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!sqlClient) {
    sqlClient = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return sqlClient;
}


export async function saveMacroSnapshot(state: MacroState) {
  if (!state.source_observed_at || state.data_quality === "unavailable") return;
  const sql = getSql();
  await sql`
    INSERT INTO macro_snapshots (source_observed_at, collected_at, state)
    VALUES (${state.source_observed_at}::timestamptz, ${state.collected_at}::timestamptz, ${sql.json(asPostgresJson(state))})
    ON CONFLICT (source_observed_at) DO UPDATE SET
      collected_at = EXCLUDED.collected_at,
      state = EXCLUDED.state
  `;
}

export async function getLatestMacroSnapshot(): Promise<MacroState | null> {
  if (!isDatabaseConfigured()) return null;
  const sql = getSql();
  const rows = await sql`SELECT state FROM macro_snapshots ORDER BY collected_at DESC LIMIT 1`;
  return rows.length ? parseJson<MacroState | null>(rows[0].state, null) : null;
}

export async function getLatestMarketState(): Promise<Record<TradeAsset, MarketIndicatorState> | null> {
  if (!isDatabaseConfigured()) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT market_state
    FROM bot_runs
    WHERE status = 'completed' AND market_state IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  return rows.length
    ? parseJson<Record<TradeAsset, MarketIndicatorState> | null>(rows[0].market_state, null)
    : null;
}

export async function beginBotRun(cycleKey: string) {
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
  const sql = getSql();
  await sql`
    INSERT INTO portfolio_snapshots (
      cycle_key, captured_at, total_portfolio_usdt, balances, prices
    ) VALUES (
      ${cycleKey}, ${snapshot.capturedAt}::timestamptz, ${snapshot.totalPortfolioUsdt},
      ${sql.json(asPostgresJson(snapshot.balances))}, ${sql.json(asPostgresJson(snapshot.prices))}
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
  decisionContext: DecisionContextSnapshot,
  decisions: JevDecision[],
  executions: BotExecutionResult[],
) {
  const sql = getSql();
  await sql`
    UPDATE bot_runs
    SET completed_at = NOW(), status = 'completed', model = ${model},
        market_state = ${sql.json(asPostgresJson(marketState))},
        decision_context = ${sql.json(asPostgresJson(decisionContext))},
        decisions = ${sql.json(asPostgresJson(decisions))},
        executions = ${sql.json(asPostgresJson(executions))},
        error = NULL
    WHERE cycle_key = ${cycleKey}
  `;
}

export async function failBotRun(cycleKey: string, error: unknown) {
  if (!isDatabaseConfigured()) return;
  const sql = getSql();
  const message = getSafeErrorMessage(error, "Unknown cron failure");
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

export interface DatabaseCleanupResult {
  archivedDailySnapshots: number;
  expiredRuns: number;
  expiredOrders: number;
  expiredMacroSnapshots: number;
  expiredDailySnapshots: number;
  staleRunsClosed: number;
  expiredExperiments: number;
  orphanedMarketSnapshots: number;
  expiredPendingSignals: number;
  deletedPendingSignals: number;
  orphanedEngineRevisions: number;
}

export async function cleanupDatabase(): Promise<DatabaseCleanupResult> {
  if (!isDatabaseConfigured()) {
    return {
      archivedDailySnapshots: 0,
      expiredRuns: 0,
      expiredOrders: 0,
      expiredMacroSnapshots: 0,
      expiredDailySnapshots: 0,
      staleRunsClosed: 0,
      expiredExperiments: 0,
      orphanedMarketSnapshots: 0,
      expiredPendingSignals: 0,
      deletedPendingSignals: 0,
      orphanedEngineRevisions: 0,
    };
  }
  const sql = getSql();
  const retention = getDatabaseMaintenanceConfig();
  return sql.begin(async (transaction) => {
    let archivedDailySnapshots = 0;
    for (const timeZone of ["UTC", "Europe/Istanbul"] as const) {
      const archived = await transaction`
        INSERT INTO daily_portfolio_snapshots (
          time_zone, local_date, captured_at, total_portfolio_usdt, prices
        )
        SELECT DISTINCT ON (local_date)
          ${timeZone},
          local_date,
          captured_at,
          total_portfolio_usdt,
          prices
        FROM (
          SELECT
            (captured_at AT TIME ZONE ${timeZone})::date AS local_date,
            captured_at,
            total_portfolio_usdt,
            prices
          FROM portfolio_snapshots
        ) localized
        ORDER BY local_date, captured_at DESC
        ON CONFLICT (time_zone, local_date) DO UPDATE SET
          captured_at = EXCLUDED.captured_at,
          total_portfolio_usdt = EXCLUDED.total_portfolio_usdt,
          prices = EXCLUDED.prices
        WHERE EXCLUDED.captured_at > daily_portfolio_snapshots.captured_at
        RETURNING local_date
      `;
      archivedDailySnapshots += archived.length;
    }

    const staleRuns = await transaction`
      UPDATE bot_runs
      SET completed_at = NOW(), status = 'failed', error = COALESCE(error, 'Automatically closed as a stale running cycle.')
      WHERE status = 'running' AND started_at < NOW() - INTERVAL '24 hours'
      RETURNING cycle_key
    `;
    const expiredRuns = await transaction`
      DELETE FROM bot_runs
      WHERE status IN ('completed', 'failed', 'skipped')
        AND COALESCE(completed_at, started_at) < NOW() - (${retention.detailedRunRetentionDays} * INTERVAL '1 day')
      RETURNING cycle_key
    `;
    const expiredOrders = await transaction`
      DELETE FROM spot_orders
      WHERE is_open = FALSE
        AND COALESCE(executed_at, updated_at, created_at) < NOW() - (${retention.orderRetentionDays} * INTERVAL '1 day')
      RETURNING order_id
    `;
    const expiredMacro = await transaction`
      DELETE FROM macro_snapshots
      WHERE source_observed_at < NOW() - (${retention.macroRetentionDays} * INTERVAL '1 day')
      RETURNING source_observed_at
    `;
    const expiredDaily = await transaction`
      DELETE FROM daily_portfolio_snapshots
      WHERE local_date < (CURRENT_DATE - ${retention.dailyHistoryRetentionDays}::int)
      RETURNING local_date
    `;
    const expiredExperiments = await transaction`
      DELETE FROM strategy_experiments
      WHERE status IN ('completed', 'cancelled')
        AND COALESCE(completed_at, planned_end_at) < NOW() - (${retention.experimentRetentionDays} * INTERVAL '1 day')
      RETURNING experiment_id
    `;
    const orphanedMarketSnapshots = await transaction`
      DELETE FROM shared_market_snapshots snapshot
      WHERE snapshot.captured_at < NOW() - (${retention.experimentRetentionDays} * INTERVAL '1 day')
        AND NOT EXISTS (SELECT 1 FROM engine_runs run WHERE run.snapshot_id = snapshot.id)
      RETURNING id
    `;
    const expiredPendingSignals = await transaction`
      UPDATE engine_pending_signals
      SET status = 'expired', resolved_at = NOW(), resolution_reason = 'Expired by end-of-cycle cleanup.'
      WHERE status = 'active' AND expires_at <= NOW()
      RETURNING id
    `;
    const deletedPendingSignals = await transaction`
      DELETE FROM engine_pending_signals
      WHERE status <> 'active'
        AND COALESCE(resolved_at, created_at) < NOW() - (LEAST(${retention.experimentRetentionDays}, 30) * INTERVAL '1 day')
      RETURNING id
    `;
    const orphanedEngineRevisions = await transaction`
      DELETE FROM engine_revisions revision
      WHERE revision.created_at < NOW() - INTERVAL '1 day'
        AND NOT EXISTS (SELECT 1 FROM engine_runs run WHERE run.revision_id = revision.id)
      RETURNING id
    `;
    return {
      archivedDailySnapshots,
      expiredRuns: expiredRuns.length,
      expiredOrders: expiredOrders.length,
      expiredMacroSnapshots: expiredMacro.length,
      expiredDailySnapshots: expiredDaily.length,
      staleRunsClosed: staleRuns.length,
      expiredExperiments: expiredExperiments.length,
      orphanedMarketSnapshots: orphanedMarketSnapshots.length,
      expiredPendingSignals: expiredPendingSignals.length,
      deletedPendingSignals: deletedPendingSignals.length,
      orphanedEngineRevisions: orphanedEngineRevisions.length,
    };
  });
}

export async function getDailyPortfolioHistory(
  days = 90,
  timeZone: "UTC" | "Europe/Istanbul" = "UTC",
): Promise<DailyPortfolioPoint[]> {
  if (!isDatabaseConfigured()) return [];
  const sql = getSql();
  const rows = await sql`
    WITH candidate_snapshots AS (
      SELECT
        local_date,
        captured_at,
        total_portfolio_usdt,
        prices
      FROM daily_portfolio_snapshots
      WHERE time_zone = ${timeZone}
        AND local_date >= ((NOW() AT TIME ZONE ${timeZone})::date - ${days}::int)
      UNION ALL
      SELECT
        (captured_at AT TIME ZONE ${timeZone})::date AS local_date,
        captured_at,
        total_portfolio_usdt,
        prices
      FROM portfolio_snapshots
      WHERE captured_at >= NOW() - (${days} * INTERVAL '1 day')
    ),
    localized_snapshots AS (
      SELECT DISTINCT ON (local_date)
        local_date,
        captured_at,
        total_portfolio_usdt,
        prices
      FROM candidate_snapshots
      ORDER BY local_date, captured_at DESC
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

export async function getPortfolioRiskContext(currentEquityUsdt: number): Promise<PortfolioRiskContext> {
  if (!isDatabaseConfigured()) {
    return {
      window_hours: 24,
      starting_equity_usdt: null,
      peak_equity_usdt: null,
      current_drawdown_pct: 0,
      completed_orders_24h: 0,
    };
  }
  const sql = getSql();
  const [snapshots, orderCounts] = await Promise.all([
    sql`
      SELECT total_portfolio_usdt
      FROM portfolio_snapshots
      WHERE captured_at >= NOW() - INTERVAL '24 hours'
      ORDER BY captured_at ASC
    `,
    sql`
      SELECT COUNT(*)::int AS count
      FROM spot_orders
      WHERE cum_exec_qty > 0
        AND COALESCE(executed_at, updated_at) >= NOW() - INTERVAL '24 hours'
    `,
  ]);
  const equities = snapshots.map((row) => Number(row.total_portfolio_usdt)).filter(Number.isFinite);
  const startingEquity = equities.at(0) ?? null;
  const peakEquity = equities.length ? Math.max(...equities, currentEquityUsdt) : null;
  const drawdown = peakEquity && peakEquity > 0
    ? Math.max(0, ((peakEquity - currentEquityUsdt) / peakEquity) * 100)
    : 0;
  return {
    window_hours: 24,
    starting_equity_usdt: startingEquity,
    peak_equity_usdt: peakEquity,
    current_drawdown_pct: drawdown,
    completed_orders_24h: Number(orderCounts[0]?.count ?? 0),
  };
}

export async function getRecentRuns(limit = 12): Promise<BotRunSummary[]> {
  if (!isDatabaseConfigured()) return [];
  const sql = getSql();
  const rows = await sql`
    SELECT cycle_key, started_at, completed_at, status, model, market_state, decision_context, decisions, executions, error
    FROM bot_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => ({
    cycleKey: String(row.cycle_key),
    startedAt: new Date(String(row.started_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    status: String(row.status) as BotRunSummary["status"],
    model: row.model ? String(row.model) : null,
    marketState: parseJson<BotRunSummary["marketState"]>(row.market_state, null),
    decisionContext: parseJson<BotRunSummary["decisionContext"]>(row.decision_context, null),
    decisions: parseJson<JevDecision[]>(row.decisions, []),
    executions: parseJson<BotExecutionResult[]>(row.executions, []),
    error: row.error ? String(row.error) : null,
  }));
}
