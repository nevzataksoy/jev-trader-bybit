import { describe, expect, it } from "vitest";
import type { JevDecision, MarketIndicatorState } from "../../types";
import {
  attachShadowProbabilityForecasts,
  buildShadowProbabilityForecast,
} from "./probabilistic-shadow";

function decision(overrides: Partial<JevDecision> = {}): JevDecision {
  return {
    asset: "BTC",
    action: "hold",
    confidence: 0.7,
    probabilities: { buy: 0.2, sell: 0, hold: 0.8 },
    currentAllocationPct: 0,
    targetAllocationPct: 0,
    rebalanceDeltaPct: 0,
    selectedSetup: "range_reversion",
    entryReadiness: "wait_retest",
    expectedNetEdgePct: -0.1,
    opportunityScore: 0,
    grossRiskBudgetPct: 0,
    policyReason: "test",
    candidatePlan: {
      status: "available",
      location: "inside_support",
      supportDistancePct: 0,
      supportStrength: 0.8,
      resistanceDistancePct: 1,
      resistanceStrength: 0.8,
      invalidationDistancePct: 0.5,
      target1DistancePct: 1,
      target1AfterCostRoomPct: 0.7,
      target1RewardRiskRatio: 2,
      roundTripCostPct: 0.3,
    },
    readinessScore: 0.55,
    judgments: {
      regime: { choice: "range", confidence: 0.7, probabilities: { uptrend: 0.05, downtrend: 0.05, range: 0.75, compression: 0.1, transition: 0.05 } },
      best_setup: { choice: "range_reversion", confidence: 0.7, probabilities: { trend_pullback: 0.05, upside_breakout: 0.05, range_reversion: 0.75, bear_rebound: 0.05, reduce: 0.05, none: 0.05 } },
      entry_readiness: { choice: "wait_retest", confidence: 0.7, probabilities: { enter_now: 0.1, wait_close: 0.1, wait_retest: 0.7, no_entry: 0.1 } },
      direction: { choice: "up", confidence: 0.7, probabilities: { up: 0.65, down: 0.15, unclear: 0.2 } },
      follow_through: { choice: "reversal", confidence: 0.7, probabilities: { continuation: 0.2, reversal: 0.65, no_pattern: 0.15 } },
      setup_quality: { score: 3, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.08, "2": 0.2, "3": 0.6, "4": 0.1 } },
      false_breakout: 0.3,
      reversal_confirmation: 0.65,
      liquidity_ok: 0.85,
      disorderly: 0.2,
      cut_position: 0.2,
    },
    ...overrides,
  };
}

function market(overrides: Partial<MarketIndicatorState> = {}) {
  return {
    trade_flow_imbalance: 0.2,
    bid_wall_strength: 0.8,
    ask_wall_strength: 0.3,
    short_squeeze_risk: 0.2,
    long_squeeze_risk: 0.1,
    open_interest_change_1h_pct: 0.5,
    trend_efficiency_4h: 0.5,
    volume_ratio_20: 1.1,
    breakout_24h_pct: 0,
    atr_14_pct: 1,
    ...overrides,
  } as MarketIndicatorState;
}

describe("probabilistic shadow forecast", () => {
  it("produces a coherent three-way probability distribution without authorizing execution", () => {
    const forecast = buildShadowProbabilityForecast(decision(), market());

    expect(forecast).not.toBeNull();
    const total = forecast!.target1BeforeInvalidation
      + forecast!.invalidationBeforeTarget1
      + forecast!.timeout;
    expect(total).toBeCloseTo(1, 10);
    expect(forecast!.target1BeforeInvalidation).toBeGreaterThan(0);
    expect(forecast!.invalidationBeforeTarget1).toBeGreaterThan(0);
    expect(forecast!.timeout).toBeGreaterThan(0);
    expect(forecast!.target1BreakConditional).toBeGreaterThan(0);
    expect(forecast!.target1BreakConditional).toBeLessThan(1);
    expect(forecast!.executionAuthoritative).toBe(false);
    expect(forecast!.status).toBe("uncalibrated_shadow");
  });

  it("raises target-first probability when directional and execution evidence improves", () => {
    const positive = buildShadowProbabilityForecast(decision(), market())!;
    const negativeDecision = decision({
      judgments: {
        ...decision().judgments,
        direction: { choice: "down", confidence: 0.8, probabilities: { up: 0.1, down: 0.75, unclear: 0.15 } },
        setup_quality: { score: 1, confidence: 0.8, probabilities: { "0": 0.1, "1": 0.7, "2": 0.1, "3": 0.05, "4": 0.05 } },
        liquidity_ok: 0.35,
        disorderly: 0.65,
        cut_position: 0.7,
      },
    });
    const negative = buildShadowProbabilityForecast(
      negativeDecision,
      market({ trade_flow_imbalance: -0.3, bid_wall_strength: 0.2, ask_wall_strength: 0.9 }),
    )!;

    expect(positive.target1BeforeInvalidation).toBeGreaterThan(negative.target1BeforeInvalidation);
    expect(positive.invalidationBeforeTarget1).toBeLessThan(negative.invalidationBeforeTarget1);
  });

  it("does not alter the action or allocation fields when forecasts are attached", () => {
    const original = decision({ action: "hold", targetAllocationPct: 0, rebalanceDeltaPct: 0 });
    const [attached] = attachShadowProbabilityForecasts(
      [original],
      { BTC: market(), ETH: market(), XAUT: market() },
    );

    expect(attached.action).toBe(original.action);
    expect(attached.targetAllocationPct).toBe(original.targetAllocationPct);
    expect(attached.rebalanceDeltaPct).toBe(original.rebalanceDeltaPct);
    expect(attached.shadowForecast?.executionAuthoritative).toBe(false);
  });

  it("omits a forecast when no deterministic candidate plan exists", () => {
    const unavailable = decision({
      candidatePlan: {
        ...decision().candidatePlan!,
        status: "unavailable",
        location: "unstructured",
      },
    });

    expect(buildShadowProbabilityForecast(unavailable, market())).toBeNull();
  });
});
