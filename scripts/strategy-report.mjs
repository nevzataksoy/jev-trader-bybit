import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const sql = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
const slippagePct = Number.isFinite(Number(process.env.ESTIMATED_SLIPPAGE_PCT))
  ? Number(process.env.ESTIMATED_SLIPPAGE_PCT)
  : 0.03;

function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function forwardReturn(currentPrices, futurePrices, asset) {
  const current = Number(currentPrices?.[asset]);
  const future = Number(futurePrices?.[asset]);
  return Number.isFinite(current) && Number.isFinite(future) && current > 0
    ? ((future / current) - 1) * 100
    : null;
}

try {
  const [rows, equityRows, orderRows] = await Promise.all([
    sql`
      SELECT
        run.cycle_key, run.decisions, run.decision_context, run.market_state,
        current_snapshot.prices AS current_prices,
        next_15.prices AS prices_15m,
        next_60.prices AS prices_60m,
        next_240.prices AS prices_240m
      FROM bot_runs run
      JOIN portfolio_snapshots current_snapshot ON current_snapshot.cycle_key = run.cycle_key
      LEFT JOIN LATERAL (
        SELECT prices FROM portfolio_snapshots candidate
        WHERE candidate.captured_at > current_snapshot.captured_at
          AND candidate.captured_at <= current_snapshot.captured_at + INTERVAL '30 minutes'
        ORDER BY candidate.captured_at ASC LIMIT 1
      ) next_15 ON TRUE
      LEFT JOIN LATERAL (
        SELECT prices FROM portfolio_snapshots candidate
        WHERE candidate.captured_at >= current_snapshot.captured_at + INTERVAL '45 minutes'
          AND candidate.captured_at <= current_snapshot.captured_at + INTERVAL '75 minutes'
        ORDER BY ABS(EXTRACT(EPOCH FROM (candidate.captured_at - current_snapshot.captured_at - INTERVAL '60 minutes'))) ASC LIMIT 1
      ) next_60 ON TRUE
      LEFT JOIN LATERAL (
        SELECT prices FROM portfolio_snapshots candidate
        WHERE candidate.captured_at >= current_snapshot.captured_at + INTERVAL '210 minutes'
          AND candidate.captured_at <= current_snapshot.captured_at + INTERVAL '270 minutes'
        ORDER BY ABS(EXTRACT(EPOCH FROM (candidate.captured_at - current_snapshot.captured_at - INTERVAL '240 minutes'))) ASC LIMIT 1
      ) next_240 ON TRUE
      WHERE run.status = 'completed'
      ORDER BY run.started_at ASC
    `,
    sql`SELECT captured_at, total_portfolio_usdt FROM portfolio_snapshots ORDER BY captured_at ASC`,
    sql`
      SELECT COUNT(*)::int AS fills,
             COALESCE(SUM(cum_exec_value), 0) AS turnover_usdt,
             COALESCE(SUM(CASE WHEN fee_currency = 'USDT' THEN fee ELSE 0 END), 0) AS known_fees_usdt
      FROM spot_orders WHERE cum_exec_qty > 0
    `,
  ]);

  const samples = [];
  const horizons = [["15m", "prices_15m"], ["60m", "prices_60m"], ["240m", "prices_240m"]];
  for (const row of rows) {
    const decisions = json(row.decisions, []);
    const context = json(row.decision_context, {});
    const marketState = json(row.market_state, {});
    const currentPrices = json(row.current_prices, {});
    for (const decision of decisions) {
      const market = marketState?.[decision.asset] ?? {};
      const position = context?.positions?.[decision.asset];
      const feePct = Number(context?.fees?.[decision.asset]?.taker_fee_pct ?? 0);
      const estimatedCostPct = feePct * 2 + Number(market.bid_ask_spread_pct ?? 0) + slippagePct * 2;
      for (const [horizon, column] of horizons) {
        const futurePrices = json(row[column], null);
        const assetReturnPct = forwardReturn(currentPrices, futurePrices, decision.asset);
        if (assetReturnPct === null) continue;
        const strategyReturnPct = decision.action === "buy"
          ? assetReturnPct - estimatedCostPct
          : decision.action === "sell"
            ? -assetReturnPct - estimatedCostPct
            : position?.status === "held" ? assetReturnPct : 0;
        const pUp = Number(decision.judgments?.direction?.probabilities?.up);
        samples.push({
          horizon,
          asset: decision.asset,
          action: decision.action,
          regime: market.regime ?? "unknown",
          mamis: market.mamis_phase ?? "unknown",
          macro: context?.macro?.policy_regime ?? "unknown",
          strategyReturnPct,
          correct: strategyReturnPct > 0,
          pUp: Number.isFinite(pUp) ? pUp : null,
          brier: Number.isFinite(pUp) ? (pUp - (assetReturnPct > 0 ? 1 : 0)) ** 2 : null,
        });
      }
    }
  }

  const grouped = new Map();
  for (const sample of samples) {
    const key = `${sample.horizon}:${sample.asset}:${sample.action}`;
    const item = grouped.get(key) ?? { horizon: sample.horizon, asset: sample.asset, action: sample.action, samples: 0, wins: 0, net: 0, brier: 0, calibrated: 0 };
    item.samples += 1;
    item.wins += sample.correct ? 1 : 0;
    item.net += sample.strategyReturnPct;
    if (sample.brier !== null) { item.brier += sample.brier; item.calibrated += 1; }
    grouped.set(key, item);
  }
  console.log("\nCost-aware forward outcomes");
  console.table([...grouped.values()].map((item) => ({
    horizon: item.horizon,
    asset: item.asset,
    action: item.action,
    samples: item.samples,
    net_win_rate_pct: Number((item.wins / item.samples * 100).toFixed(2)),
    average_estimated_net_pct: Number((item.net / item.samples).toFixed(5)),
    direction_brier: item.calibrated ? Number((item.brier / item.calibrated).toFixed(4)) : null,
  })));

  const regimeGroups = new Map();
  for (const sample of samples.filter((item) => item.horizon === "60m")) {
    const key = `${sample.asset}:${sample.regime}:${sample.mamis}:${sample.macro}`;
    const item = regimeGroups.get(key) ?? { asset: sample.asset, regime: sample.regime, mamis: sample.mamis, macro: sample.macro, samples: 0, net: 0 };
    item.samples += 1;
    item.net += sample.strategyReturnPct;
    regimeGroups.set(key, item);
  }
  console.log("\nOne-hour outcomes by deterministic context");
  console.table([...regimeGroups.values()].map((item) => ({
    ...item,
    average_estimated_net_pct: Number((item.net / item.samples).toFixed(5)),
  })));

  let peak = null;
  let maximumDrawdownPct = 0;
  for (const row of equityRows) {
    const equity = Number(row.total_portfolio_usdt);
    if (!Number.isFinite(equity)) continue;
    peak = peak === null ? equity : Math.max(peak, equity);
    if (peak > 0) maximumDrawdownPct = Math.max(maximumDrawdownPct, (peak - equity) / peak * 100);
  }
  console.log("\nExecution and portfolio diagnostics");
  console.table([{
    portfolio_snapshots: equityRows.length,
    asset_horizon_samples: samples.length,
    completed_fills: Number(orderRows[0]?.fills ?? 0),
    turnover_usdt: Number(Number(orderRows[0]?.turnover_usdt ?? 0).toFixed(2)),
    known_usdt_fees: Number(Number(orderRows[0]?.known_fees_usdt ?? 0).toFixed(4)),
    observed_max_drawdown_pct: Number(maximumDrawdownPct.toFixed(3)),
  }]);

  const oneHourSamples = samples.filter((sample) => sample.horizon === "60m").length;
  if (oneHourSamples < 500) {
    console.warn("INSUFFICIENT SAMPLE: collect at least 500 one-hour asset outcomes and inspect every regime separately before treating this as strategy evidence.");
  }
  console.warn("This report is an observational diagnostic, not a causal backtest or proof of profitability.");
} finally {
  await sql.end({ timeout: 5 });
}
