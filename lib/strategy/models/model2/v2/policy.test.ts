import { describe, expect, it } from "vitest";
import type {
  JevAssetJudgments,
  JevPortfolioJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAsset,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import { buildDecisions } from "./policy";
import type { RotationAssetJudgment } from "./normalizer";
import type { ModelConfig } from "./config";

const config: ModelConfig = {
  initialEntryPctOfPortfolio: 0.15,
  strongInitialEntryPctOfPortfolio: 0.20,
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

function jev(): JevAssetJudgments {
  return {
    regime: { choice: "uptrend", confidence: 0.8, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
    best_setup: { choice: "trend_pullback", confidence: 0.75, probabilities: { trend_pullback: 1, upside_breakout: 0, range_reversion: 0, bear_rebound: 0, reduce: 0, none: 0 } },
    entry_readiness: { choice: "wait_retest", confidence: 0.8, probabilities: { enter_now: 0.05, wait_close: 0.1, wait_retest: 0.8, no_entry: 0.05 } },
    direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.8, down: 0.05, unclear: 0.15 } },
    follow_through: { choice: "continuation", confidence: 0.8, probabilities: { continuation: 0.8, reversal: 0.05, no_pattern: 0.15 } },
    setup_quality: { score: 3, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.03, "2": 0.15, "3": 0.7, "4": 0.1 } },
    false_breakout: 0.5,
    reversal_confirmation: 0.5,
    liquidity_ok: 0.9,
    disorderly: 0.2,
    cut_position: 0.2,
  };
}

function rotation(): RotationAssetJudgment {
  return {
    regime: { choice: "bull", confidence: 0.8, probabilities: { bull: 0.8, bear: 0.05, range: 0.05, accumulation: 0.05, uncertain: 0.05 } },
    action: { choice: "watch", confidence: 0.8, probabilities: { enter: 0.04, increase: 0.04, watch: 0.8, hold: 0.04, reduce: 0.04, exit: 0.04 } },
    suitability: { choice: "watch", confidence: 0.75, probabilities: { strong: 0.1, moderate: 0.1, watch: 0.75, reject: 0.05 } },
    thesisHealth: { choice: "healthy", confidence: 0.8, probabilities: { healthy: 0.8, weakening: 0.05, invalid: 0.05, uncertain: 0.1 } },
    timing: { choice: "wait_retest", confidence: 0.8, probabilities: { enter_now: 0.05, wait_close: 0.1, wait_retest: 0.8, no_entry: 0.05 } },
    direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.8, down: 0.05, unclear: 0.15 } },
    planQuality: { score: 3, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.03, "2": 0.15, "3": 0.7, "4": 0.1 } },
    invalidationRisk: 0.2,
    liquidityOk: 0.9,
  };
}

const market = {
  regime: "bull_trend",
  last_price: 100,
  ema_200: 90,
  price_zscore_20: 0,
  channel_24h_position: 0.5,
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
  distance_to_support_pct: 0.5,
  distance_to_resistance_pct: 1.5,
  bid_wall_strength: 0.7,
  ask_wall_strength: 0.2,
  bid_wall_persistence: 3,
  ask_wall_persistence: 1,
  trade_flow_imbalance: 0.15,
  long_squeeze_risk: 0.1,
  short_squeeze_risk: 0.2,
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

const portfolio: JevPortfolioJudgments = {
  preferred_destination: { choice: "BTC", confidence: 0.8, probabilities: { USDT: 0.05, BTC: 0.8, ETH: 0.1, XAUT: 0.05 } },
  gross_risk_budget: { choice: "low", confidence: 0.8, probabilities: { zero: 0.05, low: 0.8, medium: 0.1, high: 0.05 } },
  opportunity_separation: { score: 2, confidence: 0.8, probabilities: { "0": 0.05, "1": 0.1, "2": 0.8, "3": 0.05 } },
};

describe("Model2 V2 watch economics", () => {
  it("keeps a positive-gross-edge watch pending without authorizing a negative-net-edge buy", () => {
    const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, jev()])) as Record<TradeAsset, JevAssetJudgments>;
    const rotations = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, rotation()])) as Record<TradeAsset, RotationAssetJudgment>;
    const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, market])) as Record<TradeAsset, MarketIndicatorState>;
    const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, { ...flatPosition, asset }])) as Record<TradeAsset, PositionContext>;
    const fees = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, 0.4])) as Record<TradeAsset, number>;

    const [decision] = buildDecisions(judgments, rotations, portfolio, indicators, positions, fees, config);

    expect(decision.action).toBe("hold");
    expect(decision.expectedNetEdgePct).toBeLessThan(config.minExpectedNetEdgePct);
    expect(decision.blockedBy).toContain("NET_EDGE_LOW");
    expect(decision.blockedBy).toContain("PENDING_RETEST");
    expect(decision.signalState).toBe("pending");
    expect(decision.targetAllocationPct).toBe(0);
    expect(decision.targetDistancePct).toBeCloseTo(1.5);
    expect(decision.roundTripCostPct).toBeGreaterThan(0);
  });

  it("blocks an entry whose structural resistance room cannot cover costs", () => {
    const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, jev()])) as Record<TradeAsset, JevAssetJudgments>;
    const rotations = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, rotation()])) as Record<TradeAsset, RotationAssetJudgment>;
    const tightMarket = { ...market, distance_to_resistance_pct: 0.2, resistance_zone_low: 100.2 };
    const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, tightMarket])) as Record<TradeAsset, MarketIndicatorState>;
    const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, { ...flatPosition, asset }])) as Record<TradeAsset, PositionContext>;
    const fees = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, 0.1])) as Record<TradeAsset, number>;
    const [decision] = buildDecisions(judgments, rotations, portfolio, indicators, positions, fees, config);
    expect(decision.blockedBy).toContain("TARGET_ROOM_LOW");
    expect(decision.action).toBe("hold");
  });

  it("uses detected resistance as reward instead of inflating it with ATR", () => {
    const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, jev()])) as Record<TradeAsset, JevAssetJudgments>;
    const rotations = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, rotation()])) as Record<TradeAsset, RotationAssetJudgment>;
    const tightMarket = { ...market, distance_to_resistance_pct: 0.2, resistance_zone_low: 100.2 };
    const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, tightMarket])) as Record<TradeAsset, MarketIndicatorState>;
    const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, { ...flatPosition, asset }])) as Record<TradeAsset, PositionContext>;
    const fees = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, 0.01])) as Record<TradeAsset, number>;

    const [decision] = buildDecisions(judgments, rotations, portfolio, indicators, positions, fees, config);

    expect(decision.targetDistancePct).toBeCloseTo(0.2);
    expect(decision.rewardDistancePct).toBeCloseTo(0.2);
    expect(decision.rewardSource).toBe("resistance");
    expect(decision.rewardRiskRatio).toBeCloseTo(0.2 / 1.5);
  });

  it("uses ATR projection only for a breakout with no forward resistance room", () => {
    const breakoutJudgment = {
      ...jev(),
      best_setup: {
        choice: "upside_breakout",
        confidence: 0.8,
        probabilities: { trend_pullback: 0, upside_breakout: 1, range_reversion: 0, bear_rebound: 0, reduce: 0, none: 0 },
      },
      entry_readiness: {
        choice: "enter_now",
        confidence: 0.8,
        probabilities: { enter_now: 0.8, wait_close: 0.05, wait_retest: 0.05, no_entry: 0.1 },
      },
      false_breakout: 0.2,
    } satisfies JevAssetJudgments;
    const enterRotation = {
      ...rotation(),
      action: {
        choice: "enter",
        confidence: 0.8,
        probabilities: { enter: 0.8, increase: 0.04, watch: 0.04, hold: 0.04, reduce: 0.04, exit: 0.04 },
      },
    } satisfies RotationAssetJudgment;
    const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, breakoutJudgment])) as Record<TradeAsset, JevAssetJudgments>;
    const rotations = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, enterRotation])) as Record<TradeAsset, RotationAssetJudgment>;
    const breakoutMarket = { ...market, channel_24h_position: 0.9, distance_to_resistance_pct: 0, resistance_zone_low: 100 };
    const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, breakoutMarket])) as Record<TradeAsset, MarketIndicatorState>;
    const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, { ...flatPosition, asset }])) as Record<TradeAsset, PositionContext>;
    const fees = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, 0.01])) as Record<TradeAsset, number>;

    const [decision] = buildDecisions(judgments, rotations, portfolio, indicators, positions, fees, config);

    expect(decision.targetDistancePct).toBe(0);
    expect(decision.rewardDistancePct).toBeCloseTo(2.2);
    expect(decision.rewardSource).toBe("atr_projection");
    expect(decision.rewardRiskRatio).toBeCloseTo(2.2 / 1.5);
  });

});
