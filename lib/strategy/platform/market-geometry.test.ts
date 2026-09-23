import { describe, expect, it } from "vitest";
import type { MarketIndicatorState } from "../../types";
import { buildStructuralGeometry, normalizedWallSupport } from "./market-geometry";

function market(overrides: Partial<MarketIndicatorState> = {}) {
  return {
    last_price: 100,
    atr_14_pct: 0.1,
    atr_14_1h_pct: 0.3,
    atr_14_4h_pct: 0.8,
    bid_ask_spread_pct: 0.001,
    support_zone_low: 99.4,
    support_zone_high: 99.7,
    support_distance_pct: 0.3,
    resistance_zone_low: 101.2,
    resistance_zone_high: 101.5,
    resistance_distance_pct: 1.2,
    secondary_resistance_price: 103,
    return_15m_pct: 0.1,
    volume_ratio_20: 1.1,
    trade_flow_imbalance: 0.1,
    orderbook_wall_bias: 0.2,
    orderbook_imbalance: 0.1,
    bid_wall_persistence: 0.75,
    ask_wall_persistence: 0.25,
    ...overrides,
  } as MarketIndicatorState;
}

describe("structural market geometry", () => {
  it("uses structural target room instead of requiring a fixed ATR-to-cost ratio", () => {
    const result = buildStructuralGeometry(market(), 0.1, 0.03);
    expect(result.atrToCostRatio).toBeLessThan(1);
    expect(result.targetDistancePct).toBeGreaterThan(1);
    expect(result.targetToCostRatio).toBeGreaterThan(4);
    expect(result.targetPrice).toBeCloseTo(101.2);
  });

  it("extends the target to the next resistance after an accepted breakout", () => {
    const result = buildStructuralGeometry(market({
      last_price: 101.7,
      support_zone_low: 100.8,
      support_zone_high: 101.1,
      support_distance_pct: 0.6,
      resistance_zone_low: 101.2,
      resistance_zone_high: 101.5,
      resistance_distance_pct: 0,
      secondary_resistance_price: 103,
    }), 0.1, 0.03);
    expect(result.breakoutAccepted).toBe(true);
    expect(result.targetPrice).toBe(103);
  });

  it("rewards persistent bid-side liquidity without treating it as identity", () => {
    expect(normalizedWallSupport(market())).toBeGreaterThan(0);
    expect(normalizedWallSupport(market({
      orderbook_wall_bias: -0.3,
      orderbook_imbalance: -0.2,
      bid_wall_persistence: 0.25,
      ask_wall_persistence: 1,
      trade_flow_imbalance: -0.3,
    }))).toBeLessThan(0);
  });
});
