import postgres from "postgres";
import type { HistoricalDataset, SimulationCycleRecord, SimulationSummary } from "./types";

let client: ReturnType<typeof postgres> | null = null;

export function assertLocalBacktestDatabase(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("BACKTEST_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("BACKTEST_DATABASE_URL must use postgres:// or postgresql://.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(url.hostname) && process.env.ALLOW_REMOTE_BACKTEST_DB !== "true") {
    throw new Error(
      `Backtests are local-only by default; refusing database host ${url.hostname}. `
      + "Use a local BACKTEST_DATABASE_URL or explicitly set ALLOW_REMOTE_BACKTEST_DB=true.",
    );
  }
  return connectionString;
}

export function getBacktestConnectionString() {
  const explicit = process.env.BACKTEST_DATABASE_URL?.trim();
  const fallback = process.env.DATABASE_URL?.trim();
  const value = explicit || fallback;
  if (!value) throw new Error("BACKTEST_DATABASE_URL is not configured.");
  return assertLocalBacktestDatabase(value);
}

function getSql() {
  if (!client) {
    client = postgres(getBacktestConnectionString(), {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      prepare: false,
      onnotice: () => undefined,
    });
  }
  return client;
}

export async function ensureSimulationSchema() {
  const sql = getSql();
  await sql`CREATE SCHEMA IF NOT EXISTS simulation`;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.runs (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      config JSONB NOT NULL,
      summary JSONB,
      error TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.candles (
      run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      interval_minutes INTEGER NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      close_at TIMESTAMPTZ NOT NULL,
      open NUMERIC(40, 18) NOT NULL,
      high NUMERIC(40, 18) NOT NULL,
      low NUMERIC(40, 18) NOT NULL,
      close NUMERIC(40, 18) NOT NULL,
      volume NUMERIC(40, 18) NOT NULL,
      turnover NUMERIC(40, 18) NOT NULL,
      PRIMARY KEY (run_id, asset, interval_minutes, start_at)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.derivative_points (
      run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('open_interest', 'funding')),
      observed_at TIMESTAMPTZ NOT NULL,
      value NUMERIC(40, 18) NOT NULL,
      PRIMARY KEY (run_id, asset, kind, observed_at)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.macro_points (
      run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
      observed_on DATE NOT NULL,
      values JSONB NOT NULL,
      PRIMARY KEY (run_id, observed_on)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.cycles (
      run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
      cycle_at TIMESTAMPTZ NOT NULL,
      execution_at TIMESTAMPTZ NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      semantic_state JSONB NOT NULL,
      macro_state JSONB,
      portfolio_risk JSONB NOT NULL,
      equity_before_usdt NUMERIC(30, 10) NOT NULL,
      equity_after_usdt NUMERIC(30, 10) NOT NULL,
      PRIMARY KEY (run_id, cycle_at)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.market_snapshots (
      run_id TEXT NOT NULL,
      cycle_at TIMESTAMPTZ NOT NULL,
      asset TEXT NOT NULL,
      state JSONB NOT NULL,
      PRIMARY KEY (run_id, cycle_at, asset),
      FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.decisions (
      run_id TEXT NOT NULL,
      cycle_at TIMESTAMPTZ NOT NULL,
      asset TEXT NOT NULL,
      decision JSONB NOT NULL,
      PRIMARY KEY (run_id, cycle_at, asset),
      FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.orders (
      run_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      cycle_at TIMESTAMPTZ NOT NULL,
      asset TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      decision_price NUMERIC(40, 18) NOT NULL,
      fill_price NUMERIC(40, 18),
      quantity NUMERIC(40, 18) NOT NULL,
      gross_value_usdt NUMERIC(30, 10) NOT NULL,
      fee_usdt NUMERIC(30, 10) NOT NULL,
      slippage_usdt NUMERIC(30, 10) NOT NULL,
      PRIMARY KEY (run_id, order_id),
      FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS simulation.portfolio_snapshots (
      run_id TEXT NOT NULL,
      cycle_at TIMESTAMPTZ NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
      total_equity_usdt NUMERIC(30, 10) NOT NULL,
      balances JSONB NOT NULL,
      prices JSONB NOT NULL,
      PRIMARY KEY (run_id, cycle_at, phase),
      FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS simulation_cycles_run_idx ON simulation.cycles(run_id, cycle_at)`;
  await sql`CREATE INDEX IF NOT EXISTS simulation_orders_run_idx ON simulation.orders(run_id, cycle_at)`;
}

export async function beginSimulationRun(
  runId: string,
  periodStart: string,
  periodEnd: string,
  config: unknown,
) {
  await ensureSimulationSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO simulation.runs (id, started_at, period_start, period_end, status, config)
    VALUES (${runId}, NOW(), ${periodStart}::timestamptz, ${periodEnd}::timestamptz, 'running', ${JSON.stringify(config)}::jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  if (!rows.length) throw new Error(`Simulation run ${runId} already exists; choose a new --run-id.`);
}

async function inBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    if (batch.length) await insert(batch);
  }
}

async function insertCandleRows(rows: Array<{
  run_id: string; asset: string; interval_minutes: number; start_at: Date; close_at: Date;
  open: number; high: number; low: number; close: number; volume: number; turnover: number;
}>) {
  const sql = getSql();
  await inBatches(rows, (batch) => sql`
    INSERT INTO simulation.candles ${sql(batch,
      "run_id", "asset", "interval_minutes", "start_at", "close_at",
      "open", "high", "low", "close", "volume", "turnover")}
    ON CONFLICT DO NOTHING
  `);
}

async function insertDerivativeRows(rows: Array<{
  run_id: string; asset: string; kind: string; observed_at: Date; value: number;
}>) {
  const sql = getSql();
  await inBatches(rows, (batch) => sql`
    INSERT INTO simulation.derivative_points ${sql(batch, "run_id", "asset", "kind", "observed_at", "value")}
    ON CONFLICT DO NOTHING
  `);
}

async function insertMacroRows(rows: Array<{ run_id: string; observed_on: string; values: string }>) {
  const sql = getSql();
  await inBatches(rows, async (batch) => {
    for (const row of batch) {
      await sql`
        INSERT INTO simulation.macro_points (run_id, observed_on, values)
        VALUES (${row.run_id}, ${row.observed_on}::date, ${row.values}::jsonb)
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

export async function saveHistoricalDataset(runId: string, dataset: HistoricalDataset) {
  const candleRows = Object.values(dataset.assets).flatMap((data) => [
    ...data.candles15m.map((item) => ({ run_id: runId, asset: data.asset, interval_minutes: 15, start_at: new Date(item.startTime), close_at: new Date(item.closeTime), open: item.open, high: item.high, low: item.low, close: item.close, volume: item.volume, turnover: item.turnover })),
    ...data.candles1h.map((item) => ({ run_id: runId, asset: data.asset, interval_minutes: 60, start_at: new Date(item.startTime), close_at: new Date(item.closeTime), open: item.open, high: item.high, low: item.low, close: item.close, volume: item.volume, turnover: item.turnover })),
    ...data.candles4h.map((item) => ({ run_id: runId, asset: data.asset, interval_minutes: 240, start_at: new Date(item.startTime), close_at: new Date(item.closeTime), open: item.open, high: item.high, low: item.low, close: item.close, volume: item.volume, turnover: item.turnover })),
  ]);
  await insertCandleRows(candleRows);

  const derivativeRows = Object.values(dataset.assets).flatMap((data) => [
    ...data.openInterest.map((item) => ({ run_id: runId, asset: data.asset, kind: "open_interest", observed_at: new Date(item.timestamp), value: item.openInterest })),
    ...data.funding.map((item) => ({ run_id: runId, asset: data.asset, kind: "funding", observed_at: new Date(item.timestamp), value: item.rate })),
  ]);
  await insertDerivativeRows(derivativeRows);

  const macroRows = dataset.macroRows.map((row) => ({ run_id: runId, observed_on: row.date, values: JSON.stringify(row) }));
  await insertMacroRows(macroRows);
}

export async function saveSimulationCycle(record: SimulationCycleRecord) {
  const sql = getSql();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO simulation.cycles (
        run_id, cycle_at, execution_at, model, input_tokens, output_tokens,
        semantic_state, macro_state, portfolio_risk, equity_before_usdt, equity_after_usdt
      ) VALUES (
        ${record.runId}, ${record.cycleAt}::timestamptz, ${record.executionAt}::timestamptz,
        ${record.model}, ${record.inputTokens}, ${record.outputTokens}, ${JSON.stringify(record.semanticState)}::jsonb,
        ${JSON.stringify(record.macro)}::jsonb, ${JSON.stringify(record.portfolioRisk)}::jsonb,
        ${record.equityBeforeUsdt}, ${record.equityAfterUsdt}
      ) ON CONFLICT (run_id, cycle_at) DO UPDATE SET
        model = EXCLUDED.model, input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
        semantic_state = EXCLUDED.semantic_state, macro_state = EXCLUDED.macro_state,
        portfolio_risk = EXCLUDED.portfolio_risk, equity_before_usdt = EXCLUDED.equity_before_usdt,
        equity_after_usdt = EXCLUDED.equity_after_usdt
    `;
    for (const asset of Object.keys(record.marketState) as Array<keyof typeof record.marketState>) {
      await transaction`
        INSERT INTO simulation.market_snapshots (run_id, cycle_at, asset, state)
        VALUES (${record.runId}, ${record.cycleAt}::timestamptz, ${asset}, ${JSON.stringify(record.marketState[asset])}::jsonb)
        ON CONFLICT (run_id, cycle_at, asset) DO UPDATE SET state = EXCLUDED.state
      `;
    }
    for (const decision of record.decisions) {
      await transaction`
        INSERT INTO simulation.decisions (run_id, cycle_at, asset, decision)
        VALUES (${record.runId}, ${record.cycleAt}::timestamptz, ${decision.asset}, ${JSON.stringify(decision)}::jsonb)
        ON CONFLICT (run_id, cycle_at, asset) DO UPDATE SET decision = EXCLUDED.decision
      `;
    }
    for (const execution of record.executions.filter((item) => item.orderId)) {
      await transaction`
        INSERT INTO simulation.orders (
          run_id, order_id, cycle_at, asset, action, status, reason, decision_price,
          fill_price, quantity, gross_value_usdt, fee_usdt, slippage_usdt
        ) VALUES (
          ${record.runId}, ${execution.orderId!}, ${record.cycleAt}::timestamptz, ${execution.asset},
          ${execution.action}, ${execution.status}, ${execution.reason}, ${execution.decisionPrice},
          ${execution.fillPrice}, ${execution.quantity}, ${execution.grossValueUsdt},
          ${execution.feeUsdt}, ${execution.slippageUsdt}
        ) ON CONFLICT (run_id, order_id) DO NOTHING
      `;
    }
    for (const snapshot of [
      { phase: "before", equity: record.equityBeforeUsdt, balances: record.balancesBefore },
      { phase: "after", equity: record.equityAfterUsdt, balances: record.balancesAfter },
    ] as const) {
      await transaction`
        INSERT INTO simulation.portfolio_snapshots (run_id, cycle_at, phase, total_equity_usdt, balances, prices)
        VALUES (${record.runId}, ${record.cycleAt}::timestamptz, ${snapshot.phase}, ${snapshot.equity},
          ${JSON.stringify(snapshot.balances)}::jsonb, ${JSON.stringify(record.prices)}::jsonb)
        ON CONFLICT (run_id, cycle_at, phase) DO UPDATE SET
          total_equity_usdt = EXCLUDED.total_equity_usdt, balances = EXCLUDED.balances, prices = EXCLUDED.prices
      `;
    }
  });
}

export async function completeSimulationRun(summary: SimulationSummary) {
  const sql = getSql();
  await sql`
    UPDATE simulation.runs
    SET completed_at = NOW(), status = 'completed', summary = ${JSON.stringify(summary)}::jsonb, error = NULL
    WHERE id = ${summary.runId}
  `;
}

export async function failSimulationRun(runId: string, error: unknown) {
  if (!client) return;
  const message = error instanceof Error ? error.message : String(error);
  await getSql()`
    UPDATE simulation.runs SET completed_at = NOW(), status = 'failed', error = ${message.slice(0, 2_000)}
    WHERE id = ${runId}
  `;
}

export async function getSimulationSummary(runId?: string): Promise<SimulationSummary | null> {
  await ensureSimulationSchema();
  const sql = getSql();
  const rows = runId
    ? await sql`SELECT summary FROM simulation.runs WHERE id = ${runId} AND status = 'completed' LIMIT 1`
    : await sql`SELECT summary FROM simulation.runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`;
  if (!rows.length || !rows[0].summary) return null;
  return (typeof rows[0].summary === "string" ? JSON.parse(rows[0].summary) : rows[0].summary) as SimulationSummary;
}

export async function closeSimulationDatabase() {
  if (client) await client.end({ timeout: 5 });
  client = null;
}
