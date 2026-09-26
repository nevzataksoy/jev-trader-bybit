import { describe, expect, it } from "vitest";
import type { MarketIndicatorState, TradeAsset } from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import {
  buildRotationJevJudgments,
  type RotationAssetJudgment,
} from "./normalizer";

function rotation(overrides: Partial<RotationAssetJudgment> = {}): RotationAssetJudgment {
  return {
    regime: { choice: "range", confidence: 0.8, probabilities: { bull: 0.05, bear: 0.05, range: 0.8, accumulation: 0.05, uncertain: 0.05 } },
    action: { choice: "hold", confidence: 0.8, probabilities: { enter: 0.04, increase: 0.04, watch: 0.04, hold: 0.8, reduce: 0.04, exit: 0.04 } },
    suitability: { choice: "watch", confidence: 0.7, probabilities: { strong: 0.1, moderate: 0.15, watch: 0.7, reject: 0.05 } },
    thesisHealth: { choice: "weakening", confidence: 0.7, probabilities: { healthy: 0.1, weakening: 0.7, invalid: 0.1, uncertain: 0.1 } },
    timing: { choice: "wait_retest", confidence: 0.8, probabilities: { enter_now: 0.05, wait_close: 0.1, wait_retest: 0.8, no_entry: 0.05 } },
    direction: { choice: "down", confidence: 0.7, probabilities: { up: 0.1, down: 0.7, unclear: 0.2 } },
    planQuality: { score: 2, confidence: 0.7, probabilities: { "0": 0.05, "1": 0.15, "2": 0.65, "3": 0.1, "4": 0.05 } },
    invalidationRisk: 0.8,
    liquidityOk: 0.8,
    ...overrides,
  };
}

function judgmentsFor(item: RotationAssetJudgment) {
  return Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, item])) as Record<TradeAsset, RotationAssetJudgment>;
}

const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [
  asset,
  { channel_24h_position: 0.4 } as MarketIndicatorState,
])) as Record<TradeAsset, MarketIndicatorState>;

describe("Model2 V2 normalization semantics", () => {
  it("keeps a range candidate plan when rotation action is hold", () => {
    const normalized = buildRotationJevJudgments(judgmentsFor(rotation()), indicators);

    expect(normalized.BTC.best_setup.choice).toBe("range_reversion");
    expect(normalized.BTC.entry_readiness.choice).toBe("wait_retest");
  });

  it("does not alias thesis invalidation risk into disorderly or cut-position evidence", () => {
    const normalized = buildRotationJevJudgments(judgmentsFor(rotation({ invalidationRisk: 0.8 })), indicators);

    expect(normalized.BTC.disorderly).toBe(0);
    expect(normalized.BTC.cut_position).toBeCloseTo(0.1);
    expect(normalized.BTC.reversal_confirmation).toBe(0.5);
  });

  it("keeps the candidate setup independent from a held-position exit action", () => {
    const exit = rotation({
      action: { choice: "exit", confidence: 0.9, probabilities: { enter: 0.02, increase: 0.02, watch: 0.02, hold: 0.02, reduce: 0.02, exit: 0.9 } },
    });
    const normalized = buildRotationJevJudgments(judgmentsFor(exit), indicators);

    expect(normalized.BTC.best_setup.choice).toBe("range_reversion");
    expect(normalized.BTC.cut_position).toBeCloseTo(0.9);
  });
});
