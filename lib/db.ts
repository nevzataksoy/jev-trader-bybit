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

export function getSql() {
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
      decision_context JSONB,
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
  await sql`
    CREATE TABLE IF NOT EXISTS macro_snapshots (
      source_observed_at TIMESTAMPTZ PRIMARY KEY,
      collected_at TIMESTAMPTZ NOT NULL,
      state JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_portfolio_snapshots (
      time_zone TEXT NOT NULL,
      local_date DATE NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      total_portfolio_usdt NUMERIC(30, 10) NOT NULL,
      prices JSONB NOT NULL,
      PRIMARY KEY (time_zone, local_date)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS strategy_experiments (
      experiment_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled')),
      initial_capital_usdt NUMERIC(30, 10) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      planned_end_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      engine_versions JSONB NOT NULL,
      configuration JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS shared_market_snapshots (
      id BIGSERIAL PRIMARY KEY,
      cycle_key TEXT NOT NULL UNIQUE,
      captured_at TIMESTAMPTZ NOT NULL,
      prices JSONB NOT NULL,
      indicators JSONB NOT NULL,
      fees JSONB NOT NULL,
      macro JSONB,
      data_quality JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS engine_runs (
      id BIGSERIAL PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
      cycle_key TEXT NOT NULL,
      snapshot_id BIGINT NOT NULL REFERENCES shared_market_snapshots(id) ON DELETE CASCADE,
      engine_id TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      jev_model TEXT,
      latency_ms INTEGER,
      usage JSONB,
      decision_context JSONB,
      decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
      portfolio_judgments JSONB,
      executions JSONB NOT NULL DEFAULT '[]'::jsonb,
      error TEXT,
      UNIQUE (experiment_id, cycle_key, engine_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS engine_portfolios (
      experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
      engine_id TEXT NOT NULL,
      asset TEXT NOT NULL CHECK (asset IN ('USDT', 'BTC', 'ETH', 'XAUT')),
      quantity NUMERIC(40, 18) NOT NULL DEFAULT 0,
      average_entry_price NUMERIC(40, 18),
      realized_pnl_usdt NUMERIC(30, 10) NOT NULL DEFAULT 0,
      last_trade_action TEXT,
      last_trade_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (experiment_id, engine_id, asset)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS engine_equity_snapshots (
      id BIGSERIAL PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
      cycle_key TEXT NOT NULL,
      engine_id TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      total_equity_usdt NUMERIC(30, 10) NOT NULL,
      cash_usdt NUMERIC(30, 10) NOT NULL,
      balances JSONB NOT NULL,
      prices JSONB NOT NULL,
      drawdown_pct NUMERIC(12, 6) NOT NULL DEFAULT 0,
      UNIQUE (experiment_id, cycle_key, engine_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS engine_orders (
      order_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
      cycle_key TEXT NOT NULL,
      snapshot_id BIGINT NOT NULL REFERENCES shared_market_snapshots(id) ON DELETE CASCADE,
      engine_id TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      asset TEXT NOT NULL CHECK (asset IN ('BTC', 'ETH', 'XAUT')),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
      quantity NUMERIC(40, 18) NOT NULL,
      reference_price NUMERIC(40, 18) NOT NULL,
      simulated_fill_price NUMERIC(40, 18) NOT NULL,
      gross_value_usdt NUMERIC(30, 10) NOT NULL,
      fee_usdt NUMERIC(30, 10) NOT NULL,
      slippage_pct NUMERIC(12, 6) NOT NULL,
      decision_status TEXT NOT NULL,
      simulation_status TEXT NOT NULL,
      routing_status TEXT NOT NULL,
      exchange_order_id TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      UNIQUE (experiment_id, cycle_key, engine_id, asset)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS portfolio_snapshots_captured_idx ON portfolio_snapshots(captured_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS spot_orders_created_idx ON spot_orders(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS bot_runs_started_idx ON bot_runs(started_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS macro_snapshots_collected_idx ON macro_snapshots(collected_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS daily_portfolio_snapshots_captured_idx ON daily_portfolio_snapshots(captured_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS shared_market_snapshots_captured_idx ON shared_market_snapshots(captured_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS engine_runs_experiment_idx ON engine_runs(experiment_id, started_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS engine_equity_experiment_idx ON engine_equity_snapshots(experiment_id, engine_id, captured_at)`;
  await sql`CREATE INDEX IF NOT EXISTS engine_orders_experiment_idx ON engine_orders(experiment_id, engine_id, created_at DESC)`;
  await sql`ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS decision_context JSONB`;
  await sql`ALTER TABLE engine_runs DROP CONSTRAINT IF EXISTS engine_runs_engine_id_check`;
  await sql`ALTER TABLE engine_portfolios DROP CONSTRAINT IF EXISTS engine_portfolios_engine_id_check`;
  await sql`ALTER TABLE engine_equity_snapshots DROP CONSTRAINT IF EXISTS engine_equity_snapshots_engine_id_check`;
  await sql`ALTER TABLE engine_orders DROP CONSTRAINT IF EXISTS engine_orders_engine_id_check`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(1609212026)`;
    const applied = await transaction`
      SELECT 1 FROM app_schema_migrations
      WHERE version = '20260921_native_jsonb_v1'
    `;
    if (applied.length) return;

    await transaction`
      UPDATE bot_runs SET
        market_state = CASE WHEN jsonb_typeof(market_state) = 'string' THEN (market_state #>> '{}')::jsonb ELSE market_state END,
        decision_context = CASE WHEN jsonb_typeof(decision_context) = 'string' THEN (decision_context #>> '{}')::jsonb ELSE decision_context END,
        decisions = CASE WHEN jsonb_typeof(decisions) = 'string' THEN (decisions #>> '{}')::jsonb ELSE decisions END,
        executions = CASE WHEN jsonb_typeof(executions) = 'string' THEN (executions #>> '{}')::jsonb ELSE executions END
      WHERE jsonb_typeof(market_state) = 'string'
         OR jsonb_typeof(decision_context) = 'string'
         OR jsonb_typeof(decisions) = 'string'
         OR jsonb_typeof(executions) = 'string'
    `;
    await transaction`
      UPDATE portfolio_snapshots SET
        balances = CASE WHEN jsonb_typeof(balances) = 'string' THEN (balances #>> '{}')::jsonb ELSE balances END,
        prices = CASE WHEN jsonb_typeof(prices) = 'string' THEN (prices #>> '{}')::jsonb ELSE prices END
      WHERE jsonb_typeof(balances) = 'string' OR jsonb_typeof(prices) = 'string'
    `;
    await transaction`
      UPDATE macro_snapshots
      SET state = (state #>> '{}')::jsonb
      WHERE jsonb_typeof(state) = 'string'
    `;
    await transaction`
      UPDATE daily_portfolio_snapshots
      SET prices = (prices #>> '{}')::jsonb
      WHERE jsonb_typeof(prices) = 'string'
    `;
    await transaction`
      UPDATE strategy_experiments SET
        engine_versions = CASE WHEN jsonb_typeof(engine_versions) = 'string' THEN (engine_versions #>> '{}')::jsonb ELSE engine_versions END,
        configuration = CASE WHEN jsonb_typeof(configuration) = 'string' THEN (configuration #>> '{}')::jsonb ELSE configuration END
      WHERE jsonb_typeof(engine_versions) = 'string' OR jsonb_typeof(configuration) = 'string'
    `;
    await transaction`
      UPDATE shared_market_snapshots SET
        prices = CASE WHEN jsonb_typeof(prices) = 'string' THEN (prices #>> '{}')::jsonb ELSE prices END,
        indicators = CASE WHEN jsonb_typeof(indicators) = 'string' THEN (indicators #>> '{}')::jsonb ELSE indicators END,
        fees = CASE WHEN jsonb_typeof(fees) = 'string' THEN (fees #>> '{}')::jsonb ELSE fees END,
        macro = CASE WHEN jsonb_typeof(macro) = 'string' THEN (macro #>> '{}')::jsonb ELSE macro END,
        data_quality = CASE WHEN jsonb_typeof(data_quality) = 'string' THEN (data_quality #>> '{}')::jsonb ELSE data_quality END
      WHERE jsonb_typeof(prices) = 'string'
         OR jsonb_typeof(indicators) = 'string'
         OR jsonb_typeof(fees) = 'string'
         OR jsonb_typeof(macro) = 'string'
         OR jsonb_typeof(data_quality) = 'string'
    `;
    await transaction`
      UPDATE engine_runs SET
        usage = CASE WHEN jsonb_typeof(usage) = 'string' THEN (usage #>> '{}')::jsonb ELSE usage END,
        decision_context = CASE WHEN jsonb_typeof(decision_context) = 'string' THEN (decision_context #>> '{}')::jsonb ELSE decision_context END,
        decisions = CASE WHEN jsonb_typeof(decisions) = 'string' THEN (decisions #>> '{}')::jsonb ELSE decisions END,
        portfolio_judgments = CASE WHEN jsonb_typeof(portfolio_judgments) = 'string' THEN (portfolio_judgments #>> '{}')::jsonb ELSE portfolio_judgments END,
        executions = CASE WHEN jsonb_typeof(executions) = 'string' THEN (executions #>> '{}')::jsonb ELSE executions END
      WHERE jsonb_typeof(usage) = 'string'
         OR jsonb_typeof(decision_context) = 'string'
         OR jsonb_typeof(decisions) = 'string'
         OR jsonb_typeof(portfolio_judgments) = 'string'
         OR jsonb_typeof(executions) = 'string'
    `;
    await transaction`
      UPDATE engine_equity_snapshots SET
        balances = CASE WHEN jsonb_typeof(balances) = 'string' THEN (balances #>> '{}')::jsonb ELSE balances END,
        prices = CASE WHEN jsonb_typeof(prices) = 'string' THEN (prices #>> '{}')::jsonb ELSE prices END
      WHERE jsonb_typeof(balances) = 'string' OR jsonb_typeof(prices) = 'string'
    `;
    await transaction`
      INSERT INTO app_schema_migrations (version)
      VALUES ('20260921_native_jsonb_v1')
    `;
  });
}

export async function saveMacroSnapshot(state: MacroState) {
  if (!state.source_observed_at || state.data_quality === "unavailable") return;
  await ensureDatabase();
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
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`SELECT state FROM macro_snapshots ORDER BY collected_at DESC LIMIT 1`;
  return rows.length ? parseJson<MacroState | null>(rows[0].state, null) : null;
}

export async function getLatestMarketState(): Promise<Record<TradeAsset, MarketIndicatorState> | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureDatabase();
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
  await ensureDatabase();
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

export interface DatabaseCleanupResult {
  archivedDailySnapshots: number;
  expiredRuns: number;
  expiredOrders: number;
  expiredMacroSnapshots: number;
  expiredDailySnapshots: number;
  staleRunsClosed: number;
  expiredExperiments: number;
  orphanedMarketSnapshots: number;
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
    };
  }
  await ensureDatabase();
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
    return {
      archivedDailySnapshots,
      expiredRuns: expiredRuns.length,
      expiredOrders: expiredOrders.length,
      expiredMacroSnapshots: expiredMacro.length,
      expiredDailySnapshots: expiredDaily.length,
      staleRunsClosed: staleRuns.length,
      expiredExperiments: expiredExperiments.length,
      orphanedMarketSnapshots: orphanedMarketSnapshots.length,
    };
  });
}

export async function getDailyPortfolioHistory(
  days = 90,
  timeZone: "UTC" | "Europe/Istanbul" = "UTC",
): Promise<DailyPortfolioPoint[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureDatabase();
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
  await ensureDatabase();
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
  await ensureDatabase();
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
