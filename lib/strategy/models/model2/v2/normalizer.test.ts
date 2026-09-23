import { describe, expect, it } from "vitest";
import type { MarketIndicatorState, TradeAsset } from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import { buildRotationJevJudgments, type RotationAssetJudgment } from "./normalizer";

function rotation(action: RotationAssetJudgment["action"]["choice"]): RotationAssetJudgment {
  return {
    regime: { choice: "bull", confidence: 0.8, probabilities: { bull: 0.8, bear: 0.05, range: 0.05, accumulation: 0.05, uncertain: 0.05 } },
    action: { choice: action, confidence: 0.8, probabilities: { enter: 0.04, increase: 0.04, watch: action === "watch" ? 0.8 : 0.04, hold: action === "hold" ? 0.8 : 0.04, reduce: 0.04, exit: 0.04 } },
    suitability: { choice: "watch", confidence: 0.75, probabilities: { strong: 0.1, moderate: 0.1, watch: 0.75, reject: 0.05 } },
    thesisHealth: { choice: "healthy", confidence: 0.8, probabilities: { healthy: 0.8, weakening: 0.05, invalid: 0.05, uncertain: 0.1 } },
    timing: { choice: "wait_retest", confidence: 0.75, probabilities: { enter_now: 0.05, wait_close: 0.1, wait_retest: 0.8, no_entry: 0.05 } },
    direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.8, down: 0.05, unclear: 0.15 } },
    planQuality: { score: 3, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.03, "2": 0.15, "3": 0.7, "4": 0.1 } },
    invalidationRisk: 0.2,
    liquidityOk: 0.9,
  };
}

function judgments(action: RotationAssetJudgment["action"]["choice"]) {
  return Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, rotation(action)])) as Record<TradeAsset, RotationAssetJudgment>;
}

const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, {
  channel_24h_position: 0.5,
  atr_14_pct: 1,
  atr_14_1h_pct: 1.5,
  support_distance_pct: 0.2,
  support_strength: 0.7,
  resistance_zone_high: 110,
  last_price: 100,
} as MarketIndicatorState])) as Record<TradeAsset, MarketIndicatorState>;

describe("Model2 V2 rotation normalization", () => {
  it("does not turn a deterministic hold into a tradable setup", () => {
    const normalized = buildRotationJevJudgments(judgments("hold"), indicators);
    expect(normalized.BTC.best_setup.choice).toBe("none");
  });

  it("keeps a watch state eligible for a setup that must still confirm", () => {
    const normalized = buildRotationJevJudgments(judgments("watch"), indicators);
    expect(normalized.BTC.best_setup.choice).toBe("trend_pullback");
    expect(normalized.BTC.entry_readiness.choice).toBe("wait_retest");
  });
});
