import postgres from "postgres";
import { getTradingConfig } from "../lib/config";
import { assertLocalBacktestDatabase, closeSimulationDatabase } from "../lib/simulation/db";
import type { JevDecision, MarketIndicatorState, TradeAsset } from "../lib/types";

type DecisionRow = { cycle_at: string; decision: JevDecision };
type MarketRow = { cycle_at: string; asset: TradeAsset; state: MarketIndicatorState };
type CandleRow = { asset: TradeAsset; close_at: string; close: number };

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function parse<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function round(value: number) {
  return Number(value.toFixed(4));
}

async function main() {
  const connection = assertLocalBacktestDatabase(
    process.env.BACKTEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "",
  );
  const sql = postgres(connection, { max: 1, prepare: false });
  try {
    const requested = option("run-id");
    const runRows = requested
      ? await sql`SELECT * FROM simulation.runs WHERE id = ${requested} LIMIT 1`
      : await sql`SELECT * FROM simulation.runs ORDER BY created_at DESC LIMIT 1`;
    if (!runRows.length) throw new Error("No simulation run exists.");
    const runId = String(runRows[0].id);
    const [cycleRows, rawDecisionRows, rawMarketRows, orderRows, rawCandleRows, candleCounts, derivativeCounts, macroCounts] = await Promise.all([
      sql`SELECT cycle_at, model, input_tokens, output_tokens, equity_before_usdt, equity_after_usdt FROM simulation.cycles WHERE run_id = ${runId} ORDER BY cycle_at`,
      sql`SELECT cycle_at, decision FROM simulation.decisions WHERE run_id = ${runId} ORDER BY cycle_at, asset`,
      sql`SELECT cycle_at, asset, state FROM simulation.market_snapshots WHERE run_id = ${runId}`,
      sql`SELECT action, status, gross_value_usdt, fee_usdt, slippage_usdt FROM simulation.orders WHERE run_id = ${runId}`,
      sql`SELECT asset, close_at, close::float8 AS close FROM simulation.candles WHERE run_id = ${runId} AND interval_minutes = 15 ORDER BY close_at`,
      sql`SELECT asset, interval_minutes, COUNT(*)::int AS count FROM simulation.candles WHERE run_id = ${runId} GROUP BY asset, interval_minutes ORDER BY asset, interval_minutes`,
      sql`SELECT asset, kind, COUNT(*)::int AS count FROM simulation.derivative_points WHERE run_id = ${runId} GROUP BY asset, kind ORDER BY asset, kind`,
      sql`SELECT COUNT(*)::int AS count FROM simulation.macro_points WHERE run_id = ${runId}`,
    ]);
    const decisions = rawDecisionRows.map((row) => ({
      cycle_at: new Date(String(row.cycle_at)).toISOString(),
      decision: parse<JevDecision>(row.decision as JevDecision | string),
    })) as DecisionRow[];
    const markets = rawMarketRows.map((row) => ({
      cycle_at: new Date(String(row.cycle_at)).toISOString(),
      asset: String(row.asset) as TradeAsset,
      state: parse<MarketIndicatorState>(row.state as MarketIndicatorState | string),
    })) as MarketRow[];
    const candles = rawCandleRows.map((row) => ({
      asset: String(row.asset) as TradeAsset,
      close_at: new Date(String(row.close_at)).toISOString(),
      close: Number(row.close),
    })) as CandleRow[];
    const config = getTradingConfig();
    const byAsset = Object.fromEntries((["BTC", "ETH", "XAUT"] as TradeAsset[]).map((asset) => {
      const list = decisions.filter((row) => row.decision.asset === asset).map((row) => row.decision);
      const targets = list.map((item) => item.targetAllocationPct);
      const edges = list.map((item) => item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down);
      const combinedConfidence = list.map((item) => (
        item.judgments.direction.confidence + item.judgments.setup_quality.confidence
      ) / 2);
      const reasons = Object.entries(list.reduce<Record<string, number>>((counts, item) => {
        const reason = item.policyReason.split(";")[0];
        counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {})).sort((left, right) => right[1] - left[1]);
      return [asset, {
        decisions: list.length,
        actions: list.reduce<Record<string, number>>((counts, item) => {
          counts[item.action] = (counts[item.action] ?? 0) + 1;
          return counts;
        }, {}),
        directions: list.reduce<Record<string, number>>((counts, item) => {
          counts[item.judgments.direction.choice] = (counts[item.judgments.direction.choice] ?? 0) + 1;
          return counts;
        }, {}),
        averageTargetPct: round(targets.reduce((sum, value) => sum + value, 0) / Math.max(1, targets.length)),
        maximumTargetPct: round(Math.max(0, ...targets)),
        averageEdge: round(edges.reduce((sum, value) => sum + value, 0) / Math.max(1, edges.length)),
        maximumPositiveEdge: round(Math.max(0, ...edges)),
        minimumEdge: round(Math.min(0, ...edges)),
        averageCombinedConfidence: round(combinedConfidence.reduce((sum, value) => sum + value, 0) / Math.max(1, combinedConfidence.length)),
        setupScoreBands: list.reduce<Record<string, number>>((counts, item) => {
          const score = item.judgments.setup_quality.score;
          const key = score < 0.5 ? "under_0.5"
            : score < 1 ? "0.5_to_0.99"
              : score < 1.5 ? "1.0_to_1.49"
                : score < 2 ? "1.5_to_1.99"
                  : "2_or_more";
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {}),
        passes: {
          confidence: combinedConfidence.filter((value) => value >= config.minPolicyConfidence).length,
          positiveEdge: edges.filter((value) => value >= config.minDirectionalEdge).length,
          setup: list.filter((item) => item.judgments.setup_quality.score >= config.minSetupScore).length,
          edgeAndSetup: list.filter((item) => {
            const edge = item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down;
            return edge >= config.minDirectionalEdge && item.judgments.setup_quality.score >= config.minSetupScore;
          }).length,
        },
        policyEntryCandidates: list.filter((item) => {
          const edge = item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down;
          const confidence = (item.judgments.direction.confidence + item.judgments.setup_quality.confidence) / 2;
          return edge >= config.minDirectionalEdge
            && item.judgments.setup_quality.score >= config.minSetupScore
            && confidence >= config.minPolicyConfidence;
        }).length,
        targetAboveDeadband: targets.filter((value) => value >= config.allocationDeadbandPct).length,
        reasons,
        strongestPositiveSetups: decisions
          .filter((row) => row.decision.asset === asset)
          .map((row) => {
            const item = row.decision;
            const edge = item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down;
            const market = markets.find((candidate) => candidate.asset === asset && candidate.cycle_at === new Date(row.cycle_at).toISOString());
            return {
              cycleAt: row.cycle_at,
              edge: round(edge),
              directionConfidence: item.judgments.direction.confidence,
              setupScore: item.judgments.setup_quality.score,
              setupConfidence: item.judgments.setup_quality.confidence,
              liquidity: item.judgments.liquidity_ok,
              disorderly: item.judgments.disorderly,
              regime: market?.state.regime,
              mamis: market?.state.mamis_phase,
            };
          })
          .sort((left, right) => right.edge - left.edge)
          .slice(0, 5),
      }];
    }));
    const marketQuality = markets.reduce<Record<string, number>>((counts, item) => {
      const key = `${item.asset}:${item.state.data_quality}:${item.state.data_provenance?.derivatives ?? "legacy"}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const regimes = markets.reduce<Record<string, number>>((counts, item) => {
      const key = `${item.asset}:${item.state.regime}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const candleMap = new Map(candles.map((item) => [`${item.asset}:${item.close_at}`, item.close]));
    const marketMap = new Map(markets.map((item) => [`${item.asset}:${item.cycle_at}`, item.state]));
    const signalDefinitions = {
      jevUp: (item: JevDecision) => item.judgments.direction.choice === "up",
      edgeAtLeast050: (item: JevDecision) => item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down >= 0.5,
      researchCandidate: (item: JevDecision) => {
        const edge = item.judgments.direction.probabilities.up - item.judgments.direction.probabilities.down;
        const confidence = (item.judgments.direction.confidence + item.judgments.setup_quality.confidence) / 2;
        return edge >= 0.3 && item.judgments.setup_quality.score >= 1 && confidence >= 0.55;
      },
    };
    const forwardValidation = Object.fromEntries(Object.entries(signalDefinitions).map(([name, predicate]) => {
      const rows = decisions.filter((row) => predicate(row.decision));
      const horizons = Object.fromEntries([15, 60, 240].map((minutes) => {
        const outcomes = rows.flatMap((row) => {
          const timestamp = new Date(row.cycle_at).getTime();
          const asset = row.decision.asset;
          const current = marketMap.get(`${asset}:${new Date(timestamp).toISOString()}`)?.last_price;
          const future = candleMap.get(`${asset}:${new Date(timestamp + minutes * 60_000).toISOString()}`);
          if (!current || !future) return [];
          const raw = ((future / current) - 1) * 100;
          const spread = asset === "BTC"
            ? Number(process.env.BACKTEST_BTC_SPREAD_PCT ?? 0.02)
            : asset === "ETH"
              ? Number(process.env.BACKTEST_ETH_SPREAD_PCT ?? 0.03)
              : Number(process.env.BACKTEST_XAUT_SPREAD_PCT ?? 0.05);
          const roundTripCost = Number(process.env.BACKTEST_TAKER_FEE_PCT ?? 0.1) * 2
            + Number(process.env.BACKTEST_SLIPPAGE_PCT ?? 0.03) * 2
            + spread;
          return [{ asset, raw, net: raw - roundTripCost }];
        });
        const mean = (values: number[]) => values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0;
        return [`${minutes}m`, {
          samples: outcomes.length,
          rawAveragePct: round(mean(outcomes.map((item) => item.raw))),
          netAveragePct: round(mean(outcomes.map((item) => item.net))),
          rawHitRatePct: round(mean(outcomes.map((item) => item.raw > 0 ? 100 : 0))),
          netHitRatePct: round(mean(outcomes.map((item) => item.net > 0 ? 100 : 0))),
          byAsset: Object.fromEntries((["BTC", "ETH", "XAUT"] as TradeAsset[]).map((asset) => {
            const values = outcomes.filter((item) => item.asset === asset);
            return [asset, { samples: values.length, netAveragePct: round(mean(values.map((item) => item.net))) }];
          })),
        }];
      }));
      return [name, { signals: rows.length, horizons }];
    }));
    console.log(JSON.stringify({
      run: {
        id: runId,
        status: runRows[0].status,
        startedAt: runRows[0].started_at,
        completedAt: runRows[0].completed_at,
        periodStart: runRows[0].period_start,
        periodEnd: runRows[0].period_end,
        error: runRows[0].error,
      },
      persistence: {
        cycles: cycleRows.length,
        decisions: decisions.length,
        orders: orderRows.length,
        inputTokens: cycleRows.reduce((sum, row) => sum + Number(row.input_tokens), 0),
        outputTokens: cycleRows.reduce((sum, row) => sum + Number(row.output_tokens), 0),
        historicalCandles: candleCounts,
        derivativePoints: derivativeCounts,
        macroRows: Number(macroCounts[0]?.count ?? 0),
      },
      configuredThresholds: {
        minPolicyConfidence: config.minPolicyConfidence,
        minDirectionalEdge: config.minDirectionalEdge,
        minSetupScore: config.minSetupScore,
        allocationDeadbandPct: config.allocationDeadbandPct,
      },
      byAsset,
      marketQuality,
      regimes,
      forwardValidation,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
    await closeSimulationDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
