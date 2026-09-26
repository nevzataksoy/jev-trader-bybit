import { describe, expect, it } from "vitest";
import type { MarketIndicatorState } from "../../types";
import { buildCandidateTradePlan } from "./candidate-plan";

function market(overrides: Partial<MarketIndicatorState> = {}) {
  return {
    last_price: 100,
    atr_14_pct: 1,
    support_zone_low: 98,
    support_zone_high: 99.5,
    support_strength: 0.8,
    resistance_zone_low: 103,
    resistance_zone_high: 104,
    resistance_strength: 0.9,
    ...overrides,
  } as MarketIndicatorState;
}

describe("candidate trade plan", () => {
  it("builds support-to-resistance geometry before model judgment", () => {
    const plan = buildCandidateTradePlan(market(), 0.25);

    expect(plan.status).toBe("available");
    expect(plan.location).toBe("near_support");
    expect(plan.supportDistancePct).toBeCloseTo(0.5);
    expect(plan.target1DistancePct).toBeCloseTo(3);
    expect(plan.target1AfterCostRoomPct).toBeCloseTo(2.75);
    expect(plan.invalidationDistancePct).toBeCloseTo(2);
    expect(plan.target1RewardRiskRatio).toBeCloseTo(1.5);
  });

  it("classifies price inside support independently from entry readiness", () => {
    const plan = buildCandidateTradePlan(market({ last_price: 99 }), 0.25);

    expect(plan.status).toBe("available");
    expect(plan.location).toBe("inside_support");
  });

  it("does not manufacture a plan from directionally invalid structure", () => {
    const plan = buildCandidateTradePlan(market({
      last_price: 100,
      support_zone_low: 101,
      support_zone_high: 102,
    }), 0.25);

    expect(plan.status).toBe("unavailable");
    expect(plan.location).toBe("unstructured");
    expect(plan.target1DistancePct).toBe(0);
    expect(plan.target1AfterCostRoomPct).toBeLessThan(0);
  });

  it("marks price inside resistance so policy can avoid treating the first obstacle as fresh room", () => {
    const plan = buildCandidateTradePlan(market({
      last_price: 103.5,
      resistance_zone_low: 103,
      resistance_zone_high: 104,
    }), 0.25);

    expect(plan.status).toBe("available");
    expect(plan.location).toBe("inside_resistance");
    expect(plan.target1DistancePct).toBe(0);
    expect(plan.target1AfterCostRoomPct).toBeLessThan(0);
  });
});
