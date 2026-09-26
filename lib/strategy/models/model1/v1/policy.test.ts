import { describe, expect, it } from "vitest";
import type {
  JevAssetJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAsset,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import type { ModelConfig } from "./config";
import { buildDecisions, buildPortfolioJudgments } from "./policy";

const config: ModelConfig = {
  initialEntryPctOfPortfolio: 0.15,
  buyPctOfUsdt: 0.20,
  sellPctOfHolding: 0.25,
  targetDailyVolatilityPct: 3,
  minUsdtReservePct: 0.20,
  maxAssetAllocationPct: 0.50,
  minBearReboundScore: 0.62,
  estimatedSlippagePct: 0.03,
  allocationDeadbandPct: 3,
  minDirectionalEdge: 0.15,
  minSetupScore: 2,
  minExpectedNetEdgePct: 0.05,
  minLiquidityProbability: 0.55,
  disorderlyProbability: 0.70,
  cutPositionProbability: 0.72,
  waitCloseTtlMinutes: 30,
  waitRetestTtlMinutes: 120,
};

function rangeJudgment(overrides: Partial<JevAssetJudgments> = {}): JevAssetJudgments {
  return {
    regime: { choice: "range", confidence: 0.8, probabilities: { uptrend: 0.05, downtrend: 0.05, range: 0.8, compression: 0.05, transition: 0.05 } },
    best_setup: { choice: "range_reversion", confidence: 0.8, probabilities: { trend_pullback: 0, upside_breakout: 0, range_reversion: 0.8, bear_rebound: 0.05, reduce: 0, none: 0.15 } },
    entry_readiness: { choice: "wait_retest", confidence: 0.8, probabilities: { enter_now: 0.05, wait_close: 0.1, wait_retest: 0.8, no_entry: 0.05 } },
    direction: { choice: "down", confidence: 0.75, probabilities: { up: 0.15, down: 0.55, unclear: 0.3 } },
    follow_through: { choice: "reversal", confidence: 0.7, probabilities: { continuation: 0.15, reversal: 0.65, no_pattern: 0.2 } },
    setup_quality: { score: 3, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.08, "2": 0.2, "3": 0.6, "4": 0.1 } },
    false_breakout: 0.3,
    reversal_confirmation: 0.2,
    liquidity_ok: 0.9,
    disorderly: 0.2,
    cut_position: 0.2,
    ...overrides,
  };
}

const market = {
  regime: "range",
  last_price: 100,
  ema_9: 99.5,
  ema_21: 99,
  ema_200: 95,
  price_zscore_20: -0.5,
  channel_24h_position: 0.3,
  channel_24h_low: 98,
  channel_24h_high: 102,
  distance_to_24h_high_atr: 2,
  atr_14_pct: 1,
  bid_ask_spread_pct: 0.1,
  realized_volatility_24h_pct: 2,
  volume_ratio_20: 1,
  countertrend_rebound_score: 0.8,
  support_zone_low: 98.5,
  support_zone_high: 99.5,
  support_strength: 0.8,
  resistance_zone_low: 101.5,
  resistance_zone_high: 102.5,
  resistance_strength: 0.8,
  distance_to_support_pct: 0.1,
  distance_to_resistance_pct: 1.5,
  bid_wall_strength: 0.7,
  ask_wall_strength: 0.2,
  trade_flow_imbalance: 0.15,
  upper_wick_atr: 0.1,
  macd_hist: 0.1,
  breakout_24h_pct: 0,
  return_15m_pct: 0,
} as MarketIndicatorState;

const flatPosition = {
  asset: "BTC",
  status: "flat",
  quantity: 0,
  value_usdt: 0,
  allocation_pct: 0,
  average_entry_price: null,
  unrealized_pnl_pct: null,
  cost_basis_quality: "unavailable",
  last_trade_action: null,
  last_trade_at: null,
  minutes_since_last_trade: null,
} as PositionContext;

function maps(judgment: JevAssetJudgments, feePct = 0.4) {
  const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, judgment])) as Record<TradeAsset, JevAssetJudgments>;
  const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, market])) as Record<TradeAsset, MarketIndicatorState>;
  const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, { ...flatPosition, asset }])) as Record<TradeAsset, PositionContext>;
  const fees = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, feePct])) as Record<TradeAsset, number>;
  return { judgments, indicators, positions, fees };
}

describe("Model1 V1 r4 semantics", () => {
  it("treats countertrend direction and heuristic net edge as diagnostics while waiting for a retest", () => {
    const { judgments, indicators, positions, fees } = maps(rangeJudgment());
    const portfolio = buildPortfolioJudgments(judgments, config);

    const [decision] = buildDecisions(judgments, portfolio, indicators, positions, fees, config);

    expect(decision.expectedNetEdgePct).toBeLessThan(config.minExpectedNetEdgePct);
    expect(decision.diagnostics).toContain("DIRECTIONAL_EDGE_LOW");
    expect(decision.diagnostics).toContain("NET_EDGE_LOW");
    expect(decision.blockedBy).toEqual(["PENDING_RETEST"]);
    expect(decision.signalState).toBe("pending");
    expect(decision.targetAllocationPct).toBeGreaterThan(0);
  });

  it("does not reduce a flat position when the long thesis is invalidated", () => {
    const judgment = rangeJudgment({ cut_position: 0.9 });
    const { judgments, indicators, positions, fees } = maps(judgment, 0.01);
    const portfolio = buildPortfolioJudgments(judgments, config);

    const [decision] = buildDecisions(judgments, portfolio, indicators, positions, fees, config);

    expect(decision.action).toBe("hold");
    expect(decision.successProbability).toBeGreaterThan(0);
    expect(decision.blockedBy).toContain("THESIS_INVALIDATED");
    expect(decision.blockedBy).not.toEqual(["NO_ALLOCATION_INTENT"]);
  });

  it("still reduces a held position when thesis invalidation crosses the exit threshold", () => {
    const judgment = rangeJudgment({ cut_position: 0.9 });
    const { judgments, indicators, positions, fees } = maps(judgment, 0.01);
    positions.BTC = {
      ...flatPosition,
      asset: "BTC",
      status: "held",
      quantity: 1,
      value_usdt: 100,
      allocation_pct: 20,
      average_entry_price: 95,
      unrealized_pnl_pct: 5,
      cost_basis_quality: "exact",
    } as PositionContext;
    const portfolio = buildPortfolioJudgments(judgments, config);

    const [decision] = buildDecisions(judgments, portfolio, indicators, positions, fees, config);

    expect(decision.action).toBe("sell");
    expect(decision.successProbability).toBe(0);
    expect(decision.targetAllocationPct).toBeLessThan(decision.currentAllocationPct);
  });
});
