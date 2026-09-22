import type { ExecutionPlan } from "../risk";
import { ensureDatabase, getSql, isDatabaseConfigured } from "../db";
import { asPostgresJson } from "../postgres-json";
import type {
  AssetId,
  BotExecutionResult,
  DecisionContextSnapshot,
  FeeRate,
  JevDecision,
  MacroState,
  MarketIndicatorState,
  PortfolioRiskContext,
  PositionContext,
  SpotBalance,
  TickerPrices,
  TradeAsset,
} from "../types";
import { ASSET_IDS, TRADE_ASSETS } from "../types";
import type { StrategyEngineId, StrategyEngineResult } from "./types";
import { calculatePaperFill } from "./paper";

export interface ExperimentConfiguration {
  experimentId: string;
  initialCapitalUsdt: number;
  minimumDays: number;
  minimumFilledOrdersPerEngine: number;
}

export interface SharedSnapshotInput {
  cycleKey: string;
  capturedAt: string;
  prices: TickerPrices;
  indicators: Record<TradeAsset, MarketIndicatorState>;
  fees: Record<TradeAsset, FeeRate>;
  macro: MacroState | null;
}

export interface PaperTradingState {
  balances: SpotBalance[];
  positions: Record<TradeAsset, PositionContext>;
  portfolioRisk: PortfolioRiskContext;
  totalPortfolioUsdt: number;
}

export interface PaperOrderInput {
  experimentId: string;
  cycleKey: string;
  snapshotId: number;
  engineId: StrategyEngineId;
  engineVersion: string;
  decision: JevDecision;
  plan: ExecutionPlan;
  market: MarketIndicatorState;
  fee: FeeRate;
  capturedAt: string;
  estimatedSlippagePct: number;
}

export interface EngineComparisonPoint {
  engineId: StrategyEngineId;
  capturedAt: string;
  totalEquityUsdt: number;
  cashUsdt: number;
  drawdownPct: number;
}

export interface EngineComparisonSummary {
  engineId: StrategyEngineId;
  engineVersion: string;
  totalEquityUsdt: number;
  cashUsdt: number;
  returnPct: number;
  maxDrawdownPct: number;
  filledOrders: number;
  turnoverUsdt: number;
  feesUsdt: number;
  latestDecisionAt: string | null;
  jevFailures: number;
  averageLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  completedRuns: number;
  abstentionRuns: number;
  abstentionRatePct: number;
  balances: SpotBalance[];
}

export interface ExperimentOrderItem {
  orderId: string;
  engineId: StrategyEngineId;
  engineVersion: string;
  asset: TradeAsset;
  symbol: string;
  side: "Buy" | "Sell";
  quantity: number;
  referencePrice: number;
  simulatedFillPrice: number;
  grossValueUsdt: number;
  feeUsdt: number;
  slippagePct: number;
  simulationStatus: string;
  routingStatus: string;
  reason: string;
  createdAt: string;
}

export interface ExperimentRunItem {
  engineId: StrategyEngineId;
  engineVersion: string;
  cycleKey: string;
  status: "running" | "completed" | "failed";
  jevModel: string | null;
  latencyMs: number | null;
  decisions: JevDecision[];
  executions: BotExecutionResult[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ModelsDashboardState {
  generatedAt: string;
  runMode: string;
  activeEngines: StrategyEngineId[];
  availableEngines: StrategyEngineId[];
  exchangeExecutionEngine: StrategyEngineId | "none";
  exchangeRoutingForcedOff: boolean;
  database: "connected" | "not_configured" | "error";
  message: string | null;
  experiment: null | {
    experimentId: string;
    status: string;
    initialCapitalUsdt: number;
    startedAt: string;
    plannedEndAt: string;
    minimumFilledOrdersPerEngine: number;
    engineVersions: Record<StrategyEngineId, string>;
  };
  engines: EngineComparisonSummary[];
  equity: EngineComparisonPoint[];
  orders: ExperimentOrderItem[];
  runs: ExperimentRunItem[];
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

export async function ensureStrategyExperiment(
  config: ExperimentConfiguration,
  engineVersions: Record<StrategyEngineId, string>,
) {
  await ensureDatabase();
  const sql = getSql();
  await sql.begin(async (transaction) => {
    const requestedEngineVersions = Object.fromEntries(Object.entries(engineVersions).sort(([left], [right]) => left.localeCompare(right)));
    const existingRows = await transaction`
      SELECT engine_versions FROM strategy_experiments WHERE experiment_id = ${config.experimentId} LIMIT 1
    `;
    if (existingRows.length) {
      const existingVersions = parseJson<Record<string, string>>(existingRows[0].engine_versions, {});
      const normalizedExisting = Object.fromEntries(Object.entries(existingVersions).sort(([left], [right]) => left.localeCompare(right)));
      if (JSON.stringify(normalizedExisting) !== JSON.stringify(requestedEngineVersions)) {
        throw new Error(`AB_EXPERIMENT_ID ${config.experimentId} already belongs to a different engine set. Use a new experiment id.`);
      }
    }
    await transaction`
      INSERT INTO strategy_experiments (
        experiment_id, status, initial_capital_usdt, started_at, planned_end_at, engine_versions, configuration
      ) VALUES (
        ${config.experimentId}, 'running', ${config.initialCapitalUsdt}, NOW(),
        NOW() + (${config.minimumDays} * INTERVAL '1 day'),
        ${sql.json(asPostgresJson(requestedEngineVersions))},
        ${sql.json(asPostgresJson({ engineIds: Object.keys(requestedEngineVersions), minimumDays: config.minimumDays, minimumFilledOrdersPerEngine: config.minimumFilledOrdersPerEngine }))}
      )
      ON CONFLICT (experiment_id) DO NOTHING
    `;
    for (const engineId of Object.keys(requestedEngineVersions)) {
      for (const asset of ASSET_IDS) {
        await transaction`
          INSERT INTO engine_portfolios (
            experiment_id, engine_id, asset, quantity, average_entry_price, realized_pnl_usdt
          ) VALUES (
            ${config.experimentId}, ${engineId}, ${asset},
            ${asset === "USDT" ? config.initialCapitalUsdt : 0}, NULL, 0
          )
          ON CONFLICT (experiment_id, engine_id, asset) DO NOTHING
        `;
      }
    }
  });
}

export async function saveSharedMarketSnapshot(input: SharedSnapshotInput) {
  await ensureDatabase();
  const sql = getSql();
  const dataQuality = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, input.indicators[asset].data_quality]));
  const rows = await sql`
    INSERT INTO shared_market_snapshots (
      cycle_key, captured_at, prices, indicators, fees, macro, data_quality
    ) VALUES (
      ${input.cycleKey}, ${input.capturedAt}::timestamptz, ${sql.json(asPostgresJson(input.prices))},
      ${sql.json(asPostgresJson(input.indicators))}, ${sql.json(asPostgresJson(input.fees))},
      ${sql.json(asPostgresJson(input.macro))}, ${sql.json(asPostgresJson(dataQuality))}
    )
    ON CONFLICT (cycle_key) DO UPDATE SET
      captured_at = EXCLUDED.captured_at,
      prices = EXCLUDED.prices,
      indicators = EXCLUDED.indicators,
      fees = EXCLUDED.fees,
      macro = EXCLUDED.macro,
      data_quality = EXCLUDED.data_quality
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function beginEngineRun(
  experimentId: string,
  cycleKey: string,
  snapshotId: number,
  engineId: StrategyEngineId,
  engineVersion: string,
) {
  const sql = getSql();
  await sql`
    INSERT INTO engine_runs (
      experiment_id, cycle_key, snapshot_id, engine_id, engine_version, status, started_at
    ) VALUES (${experimentId}, ${cycleKey}, ${snapshotId}, ${engineId}, ${engineVersion}, 'running', NOW())
    ON CONFLICT (experiment_id, cycle_key, engine_id) DO UPDATE SET
      snapshot_id = EXCLUDED.snapshot_id,
      engine_version = EXCLUDED.engine_version,
      status = 'running',
      started_at = NOW(),
      completed_at = NULL,
      error = NULL
    WHERE engine_runs.status = 'failed'
       OR (engine_runs.status = 'running' AND engine_runs.started_at < NOW() - INTERVAL '12 minutes')
  `;
}

export async function completeEngineRun(
  experimentId: string,
  cycleKey: string,
  result: StrategyEngineResult,
  context: DecisionContextSnapshot,
  executions: BotExecutionResult[],
) {
  const sql = getSql();
  await sql`
    UPDATE engine_runs
    SET status = 'completed', completed_at = NOW(), jev_model = ${result.model}, latency_ms = ${result.latencyMs},
        usage = ${sql.json(asPostgresJson(result.usage))},
        decision_context = ${sql.json(asPostgresJson(context))},
        decisions = ${sql.json(asPostgresJson(result.decisions))},
        portfolio_judgments = ${sql.json(asPostgresJson(result.portfolioJudgments))},
        executions = ${sql.json(asPostgresJson(executions))},
        error = NULL
    WHERE experiment_id = ${experimentId} AND cycle_key = ${cycleKey} AND engine_id = ${result.engineId}
  `;
}

export async function failEngineRun(
  experimentId: string,
  cycleKey: string,
  engineId: StrategyEngineId,
  error: string,
) {
  const sql = getSql();
  await sql`
    UPDATE engine_runs
    SET status = 'failed', completed_at = NOW(), error = ${error.slice(0, 2_000)}
    WHERE experiment_id = ${experimentId} AND cycle_key = ${cycleKey} AND engine_id = ${engineId}
  `;
}

export async function getPaperTradingState(
  experimentId: string,
  engineId: StrategyEngineId,
  prices: TickerPrices,
  now = Date.now(),
): Promise<PaperTradingState> {
  const sql = getSql();
  const [portfolioRows, equityRows, orderCountRows] = await Promise.all([
    sql`
      SELECT asset, quantity, average_entry_price, last_trade_action, last_trade_at
      FROM engine_portfolios
      WHERE experiment_id = ${experimentId} AND engine_id = ${engineId}
    `,
    sql`
      SELECT total_equity_usdt
      FROM engine_equity_snapshots
      WHERE experiment_id = ${experimentId} AND engine_id = ${engineId}
        AND captured_at >= NOW() - INTERVAL '24 hours'
      ORDER BY captured_at ASC
    `,
    sql`
      SELECT COUNT(*)::int AS count
      FROM engine_orders
      WHERE experiment_id = ${experimentId} AND engine_id = ${engineId}
        AND simulation_status = 'filled' AND created_at >= NOW() - INTERVAL '24 hours'
    `,
  ]);
  const rowByAsset = new Map(portfolioRows.map((row) => [String(row.asset) as AssetId, row]));
  const balances = ASSET_IDS.map((asset) => {
    const quantity = Number(rowByAsset.get(asset)?.quantity ?? 0);
    return {
      coin: asset,
      free: quantity,
      locked: 0,
      total: quantity,
      usdtValue: quantity * prices[asset],
    } satisfies SpotBalance;
  });
  const totalPortfolioUsdt = balances.reduce((sum, balance) => sum + balance.usdtValue, 0);
  const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const row = rowByAsset.get(asset);
    const balance = balances.find((item) => item.coin === asset)!;
    const averageEntry = row?.average_entry_price === null || row?.average_entry_price === undefined
      ? null
      : Number(row.average_entry_price);
    const lastTradeAt = row?.last_trade_at ? new Date(String(row.last_trade_at)).toISOString() : null;
    return [asset, {
      asset,
      status: balance.total > 0 ? "held" : "flat",
      quantity: balance.total,
      value_usdt: balance.usdtValue,
      allocation_pct: totalPortfolioUsdt > 0 ? balance.usdtValue / totalPortfolioUsdt * 100 : 0,
      average_entry_price: averageEntry,
      unrealized_pnl_pct: averageEntry && averageEntry > 0 ? (prices[asset] / averageEntry - 1) * 100 : null,
      cost_basis_quality: balance.total > 0 ? "complete" : "unavailable",
      last_trade_action: row?.last_trade_action === "buy" || row?.last_trade_action === "sell" ? row.last_trade_action : null,
      last_trade_at: lastTradeAt,
      minutes_since_last_trade: lastTradeAt ? Math.max(0, (now - new Date(lastTradeAt).getTime()) / 60_000) : null,
    } satisfies PositionContext];
  })) as Record<TradeAsset, PositionContext>;
  const equities = equityRows.map((row) => Number(row.total_equity_usdt)).filter(Number.isFinite);
  const peak = equities.length ? Math.max(...equities, totalPortfolioUsdt) : totalPortfolioUsdt;
  return {
    balances,
    positions,
    totalPortfolioUsdt,
    portfolioRisk: {
      window_hours: 24,
      starting_equity_usdt: equities.at(0) ?? null,
      peak_equity_usdt: peak || null,
      current_drawdown_pct: peak > 0 ? Math.max(0, (peak - totalPortfolioUsdt) / peak * 100) : 0,
      completed_orders_24h: Number(orderCountRows[0]?.count ?? 0),
    },
  };
}

export async function simulatePaperOrder(input: PaperOrderInput): Promise<BotExecutionResult> {
  const sql = getSql();
  const symbol = input.market.symbol;
  const orderId = `paper-${input.experimentId}-${input.engineId}-${new Date(input.cycleKey).getTime()}-${input.decision.asset.toLowerCase()}`;
  return sql.begin(async (transaction) => {
    const existing = await transaction`SELECT order_id FROM engine_orders WHERE order_id = ${orderId}`;
    if (existing.length) {
      return {
        asset: input.decision.asset,
        symbol,
        action: input.decision.action,
        status: "skipped",
        reason: "Paper order already exists for this engine and cycle.",
        orderId,
      } satisfies BotExecutionResult;
    }
    const rows = await transaction`
      SELECT asset, quantity, average_entry_price
      FROM engine_portfolios
      WHERE experiment_id = ${input.experimentId} AND engine_id = ${input.engineId}
        AND asset IN ('USDT', ${input.decision.asset})
      FOR UPDATE
    `;
    const rowByAsset = new Map(rows.map((row) => [String(row.asset), row]));
    const cash = Number(rowByAsset.get("USDT")?.quantity ?? 0);
    const assetQuantity = Number(rowByAsset.get(input.decision.asset)?.quantity ?? 0);
    const averageEntry = Number(rowByAsset.get(input.decision.asset)?.average_entry_price ?? 0);
    const side = input.decision.action === "buy" ? "Buy" : "Sell";
    const fill = calculatePaperFill({
      side,
      cashUsdt: cash,
      assetQuantity,
      averageEntryPrice: averageEntry,
      referencePrice: input.market.last_price,
      spreadPct: input.market.bid_ask_spread_pct,
      slippagePct: input.estimatedSlippagePct,
      takerFeePct: input.fee.taker_fee_pct,
      buyFraction: input.plan.buyPctOfUsdt,
      sellFraction: input.plan.sellPctOfHolding,
    });

    if (side === "Buy") {
      await transaction`
        UPDATE engine_portfolios
        SET quantity = ${fill.newCashUsdt}, updated_at = ${input.capturedAt}::timestamptz
        WHERE experiment_id = ${input.experimentId} AND engine_id = ${input.engineId} AND asset = 'USDT'
      `;
      await transaction`
        UPDATE engine_portfolios
        SET quantity = ${fill.newAssetQuantity}, average_entry_price = ${fill.newAverageEntryPrice}, last_trade_action = 'buy',
            last_trade_at = ${input.capturedAt}::timestamptz, updated_at = ${input.capturedAt}::timestamptz
        WHERE experiment_id = ${input.experimentId} AND engine_id = ${input.engineId} AND asset = ${input.decision.asset}
      `;
    } else {
      await transaction`
        UPDATE engine_portfolios
        SET quantity = ${fill.newCashUsdt}, updated_at = ${input.capturedAt}::timestamptz
        WHERE experiment_id = ${input.experimentId} AND engine_id = ${input.engineId} AND asset = 'USDT'
      `;
      await transaction`
        UPDATE engine_portfolios
        SET quantity = ${fill.newAssetQuantity}, average_entry_price = ${fill.newAverageEntryPrice},
            realized_pnl_usdt = realized_pnl_usdt + ${fill.realizedPnlUsdt}, last_trade_action = 'sell',
            last_trade_at = ${input.capturedAt}::timestamptz, updated_at = ${input.capturedAt}::timestamptz
        WHERE experiment_id = ${input.experimentId} AND engine_id = ${input.engineId} AND asset = ${input.decision.asset}
      `;
    }
    await transaction`
      INSERT INTO engine_orders (
        order_id, experiment_id, cycle_key, snapshot_id, engine_id, engine_version, asset, symbol,
        side, quantity, reference_price, simulated_fill_price, gross_value_usdt, fee_usdt, slippage_pct,
        decision_status, simulation_status, routing_status, exchange_order_id, reason, created_at
      ) VALUES (
        ${orderId}, ${input.experimentId}, ${input.cycleKey}, ${input.snapshotId}, ${input.engineId},
        ${input.engineVersion}, ${input.decision.asset}, ${symbol}, ${side}, ${fill.quantity}, ${input.market.last_price},
        ${fill.fillPrice}, ${fill.grossValueUsdt}, ${fill.feeUsdt}, ${fill.adversePct}, 'accepted', 'filled',
        'suppressed_ab_test', NULL, ${input.plan.reason}, ${input.capturedAt}::timestamptz
      )
    `;
    return {
      asset: input.decision.asset,
      symbol,
      action: input.decision.action,
      status: "confirmed",
      reason: `${input.plan.reason} Simulated fill recorded; exchange routing suppressed by the A/B lock.`,
      orderId,
      orderLinkId: orderId,
      filledQuantity: fill.quantity,
      filledValueUsdt: fill.grossValueUsdt,
    } satisfies BotExecutionResult;
  });
}

export async function savePaperEquitySnapshot(
  experimentId: string,
  cycleKey: string,
  engineId: StrategyEngineId,
  capturedAt: string,
  prices: TickerPrices,
) {
  const state = await getPaperTradingState(experimentId, engineId, prices, new Date(capturedAt).getTime());
  const sql = getSql();
  await sql`
    INSERT INTO engine_equity_snapshots (
      experiment_id, cycle_key, engine_id, captured_at, total_equity_usdt, cash_usdt, balances, prices, drawdown_pct
    ) VALUES (
      ${experimentId}, ${cycleKey}, ${engineId}, ${capturedAt}::timestamptz, ${state.totalPortfolioUsdt},
      ${state.balances.find((balance) => balance.coin === "USDT")?.total ?? 0},
      ${sql.json(asPostgresJson(state.balances))}, ${sql.json(asPostgresJson(prices))},
      ${state.portfolioRisk.current_drawdown_pct}
    )
    ON CONFLICT (experiment_id, cycle_key, engine_id) DO UPDATE SET
      captured_at = EXCLUDED.captured_at,
      total_equity_usdt = EXCLUDED.total_equity_usdt,
      cash_usdt = EXCLUDED.cash_usdt,
      balances = EXCLUDED.balances,
      prices = EXCLUDED.prices,
      drawdown_pct = EXCLUDED.drawdown_pct
  `;
  return state;
}

export async function getModelsDashboardState(
  requestedExperimentId?: string,
): Promise<Omit<ModelsDashboardState, "generatedAt" | "runMode" | "exchangeRoutingForcedOff" | "database" | "message">> {
  if (!isDatabaseConfigured()) return { experiment: null, engines: [], equity: [], orders: [], runs: [] };
  await ensureDatabase();
  const sql = getSql();
  const experimentRows = requestedExperimentId
    ? await sql`SELECT * FROM strategy_experiments WHERE experiment_id = ${requestedExperimentId} LIMIT 1`
    : await sql`SELECT * FROM strategy_experiments ORDER BY started_at DESC LIMIT 1`;
  if (!experimentRows.length) return { experiment: null, engines: [], equity: [], orders: [], runs: [] };
  const experimentRow = experimentRows[0];
  const experimentId = String(experimentRow.experiment_id);
  const [equityRows, orderRows, runRows, portfolioRows, orderStatsRows, runStatsRows] = await Promise.all([
    sql`
      SELECT engine_id, captured_at, total_equity_usdt, cash_usdt, drawdown_pct
      FROM engine_equity_snapshots
      WHERE experiment_id = ${experimentId}
      ORDER BY captured_at ASC
      LIMIT 12000
    `,
    sql`
      SELECT * FROM engine_orders
      WHERE experiment_id = ${experimentId}
      ORDER BY created_at DESC
      LIMIT 500
    `,
    sql`
      SELECT engine_id, engine_version, cycle_key, status, jev_model, latency_ms, usage,
             decisions, executions, error, started_at, completed_at
      FROM engine_runs
      WHERE experiment_id = ${experimentId}
      ORDER BY started_at DESC
      LIMIT 200
    `,
    sql`
      SELECT engine_id, asset, quantity
      FROM engine_portfolios
      WHERE experiment_id = ${experimentId}
    `,
    sql`
      SELECT engine_id, COUNT(*)::int AS filled_orders,
             COALESCE(SUM(gross_value_usdt), 0) AS turnover_usdt,
             COALESCE(SUM(fee_usdt), 0) AS fees_usdt
      FROM engine_orders
      WHERE experiment_id = ${experimentId} AND simulation_status = 'filled'
      GROUP BY engine_id
    `,
    sql`
      SELECT engine_id,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failures,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
             COUNT(*) FILTER (
               WHERE status = 'completed'
                 AND jsonb_typeof(engine_runs.decisions) = 'array'
                 AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(
                     CASE
                       WHEN jsonb_typeof(engine_runs.decisions) = 'array' THEN engine_runs.decisions
                       ELSE '[]'::jsonb
                     END
                   ) AS decision
                   WHERE decision->>'action' IN ('buy', 'sell')
                 )
             )::int AS abstention_runs,
             AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS average_latency_ms,
             COALESCE(SUM(COALESCE((usage->>'input_tokens')::bigint, 0)), 0) AS input_tokens,
             COALESCE(SUM(COALESCE((usage->>'output_tokens')::bigint, 0)), 0) AS output_tokens,
             MAX(started_at) AS latest_decision_at
      FROM engine_runs
      WHERE experiment_id = ${experimentId}
      GROUP BY engine_id
    `,
  ]);
  const equity: EngineComparisonPoint[] = equityRows.map((row) => ({
    engineId: String(row.engine_id) as StrategyEngineId,
    capturedAt: new Date(String(row.captured_at)).toISOString(),
    totalEquityUsdt: Number(row.total_equity_usdt),
    cashUsdt: Number(row.cash_usdt),
    drawdownPct: Number(row.drawdown_pct),
  }));
  const orders: ExperimentOrderItem[] = orderRows.map((row) => ({
    orderId: String(row.order_id), engineId: String(row.engine_id) as StrategyEngineId,
    engineVersion: String(row.engine_version), asset: String(row.asset) as TradeAsset,
    symbol: String(row.symbol), side: String(row.side) as "Buy" | "Sell", quantity: Number(row.quantity),
    referencePrice: Number(row.reference_price), simulatedFillPrice: Number(row.simulated_fill_price),
    grossValueUsdt: Number(row.gross_value_usdt), feeUsdt: Number(row.fee_usdt), slippagePct: Number(row.slippage_pct),
    simulationStatus: String(row.simulation_status), routingStatus: String(row.routing_status), reason: String(row.reason),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
  const runs: ExperimentRunItem[] = runRows.map((row) => ({
    engineId: String(row.engine_id) as StrategyEngineId, engineVersion: String(row.engine_version),
    cycleKey: String(row.cycle_key), status: String(row.status) as ExperimentRunItem["status"],
    jevModel: row.jev_model ? String(row.jev_model) : null,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    decisions: parseJson<JevDecision[]>(row.decisions, []),
    executions: parseJson<BotExecutionResult[]>(row.executions, []), error: row.error ? String(row.error) : null,
    startedAt: new Date(String(row.started_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
  }));
  const engineVersions = parseJson<Record<StrategyEngineId, string>>(experimentRow.engine_versions, {});
  const initialCapital = Number(experimentRow.initial_capital_usdt);
  const latestPricesRow = await sql`SELECT prices FROM shared_market_snapshots ORDER BY captured_at DESC LIMIT 1`;
  const latestPrices = parseJson<TickerPrices>(latestPricesRow[0]?.prices, { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 });
  const configuration = parseJson<{ engineIds?: StrategyEngineId[]; minimumFilledOrdersPerEngine?: number }>(experimentRow.configuration, {});
  const engineIds = configuration.engineIds?.length ? configuration.engineIds : Object.keys(engineVersions);
  const engines: EngineComparisonSummary[] = engineIds.map((engineId) => {
    const points = equity.filter((point) => point.engineId === engineId);
    const orderStats = orderStatsRows.find((row) => String(row.engine_id) === engineId);
    const runStats = runStatsRows.find((row) => String(row.engine_id) === engineId);
    const latest = points.at(-1);
    const quantities = new Map(portfolioRows.filter((row) => String(row.engine_id) === engineId).map((row) => [String(row.asset) as AssetId, Number(row.quantity)]));
    const balances = ASSET_IDS.map((asset) => ({ coin: asset, free: quantities.get(asset) ?? 0, locked: 0, total: quantities.get(asset) ?? 0, usdtValue: (quantities.get(asset) ?? 0) * latestPrices[asset] } satisfies SpotBalance));
    const completedRuns = Number(runStats?.completed_runs ?? 0);
    const abstentionRuns = Number(runStats?.abstention_runs ?? 0);
    return {
      engineId,
      engineVersion: engineVersions[engineId],
      totalEquityUsdt: latest?.totalEquityUsdt ?? initialCapital,
      cashUsdt: latest?.cashUsdt ?? initialCapital,
      returnPct: initialCapital > 0 ? ((latest?.totalEquityUsdt ?? initialCapital) / initialCapital - 1) * 100 : 0,
      maxDrawdownPct: points.length ? Math.max(...points.map((point) => point.drawdownPct)) : 0,
      filledOrders: Number(orderStats?.filled_orders ?? 0),
      turnoverUsdt: Number(orderStats?.turnover_usdt ?? 0),
      feesUsdt: Number(orderStats?.fees_usdt ?? 0),
      latestDecisionAt: runStats?.latest_decision_at ? new Date(String(runStats.latest_decision_at)).toISOString() : null,
      jevFailures: Number(runStats?.failures ?? 0),
      averageLatencyMs: runStats?.average_latency_ms === null || runStats?.average_latency_ms === undefined ? null : Number(runStats.average_latency_ms),
      inputTokens: Number(runStats?.input_tokens ?? 0),
      outputTokens: Number(runStats?.output_tokens ?? 0),
      completedRuns,
      abstentionRuns,
      abstentionRatePct: completedRuns > 0 ? abstentionRuns / completedRuns * 100 : 0,
      balances,
    };
  });
  return {
    experiment: {
      experimentId,
      status: String(experimentRow.status),
      initialCapitalUsdt: initialCapital,
      startedAt: new Date(String(experimentRow.started_at)).toISOString(),
      plannedEndAt: new Date(String(experimentRow.planned_end_at)).toISOString(),
      minimumFilledOrdersPerEngine: Number(configuration.minimumFilledOrdersPerEngine ?? 30),
      engineVersions,
    },
    engines,
    equity,
    orders,
    runs,
  };
}
