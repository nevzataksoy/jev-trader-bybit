import { describe, expect, it } from "vitest";
import type { JevDecision } from "../../../../types";
import { orderDecisions } from "./execution";

const judgments: JevDecision["judgments"] = {
  regime: { choice: "uptrend", confidence: 0.8, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
  best_setup: { choice: "trend_pullback", confidence: 0.8, probabilities: { trend_pullback: 0.8, upside_breakout: 0.05, range_reversion: 0.03, bear_rebound: 0.02, reduce: 0.05, none: 0.05 } },
  entry_readiness: { choice: "enter_now", confidence: 0.8, probabilities: { enter_now: 0.8, wait_close: 0.05, wait_retest: 0.1, no_entry: 0.05 } },
  direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.8, down: 0.1, unclear: 0.1 } },
  follow_through: { choice: "continuation", confidence: 0.8, probabilities: { continuation: 0.8, reversal: 0.1, no_pattern: 0.1 } },
  setup_quality: { score: 2.5, confidence: 0.8, probabilities: { 0: 0.05, 1: 0.1, 2: 0.25, 3: 0.6 } },
  false_breakout: 0.1,
  reversal_confirmation: 0.7,
  liquidity_ok: 0.9,
  disorderly: 0.1,
  cut_position: 0.1,
};

function decision(overrides: Partial<JevDecision>): JevDecision {
  return {
    asset: "BTC",
    action: "hold",
    confidence: 0.8,
    probabilities: { buy: 0.1, sell: 0.1, hold: 0.8 },
    currentAllocationPct: 0,
    targetAllocationPct: 0,
    rebalanceDeltaPct: 0,
    selectedSetup: "none",
    entryReadiness: "no_entry",
    expectedNetEdgePct: 0,
    opportunityScore: 0,
    grossRiskBudgetPct: 80,
    policyReason: "test",
    judgments,
    ...overrides,
  };
}

describe("version-owned execution ordering", () => {
  it("runs risk-reduction sells before buys and holds", () => {
    const decisions: JevDecision[] = [
      decision({ asset: "BTC", action: "buy", confidence: 0.9, probabilities: { buy: 0.9, hold: 0.08, sell: 0.02 }, rebalanceDeltaPct: 10 }),
      decision({ asset: "ETH", action: "sell", confidence: 0.75, probabilities: { buy: 0.05, hold: 0.1, sell: 0.85 }, currentAllocationPct: 20, targetAllocationPct: 10, rebalanceDeltaPct: -10, selectedSetup: "reduce" }),
      decision({ asset: "XAUT", action: "hold", confidence: 0.95, probabilities: { buy: 0.02, hold: 0.96, sell: 0.02 } }),
    ];

    expect(orderDecisions(decisions).map((item) => item.action)).toEqual(["sell", "buy", "hold"]);
  });
});
