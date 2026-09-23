import type { MarketIndicatorState } from "../../types";

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export interface StructuralGeometry {
  roundTripCostPct: number;
  atrToCostRatio: number;
  targetPrice: number;
  invalidationPrice: number;
  targetDistancePct: number;
  invalidationDistancePct: number;
  targetToCostRatio: number;
  nearSupport: boolean;
  nearResistance: boolean;
  breakoutAccepted: boolean;
}

export function buildStructuralGeometry(
  market: MarketIndicatorState,
  takerFeePct: number,
  estimatedSlippagePct: number,
): StructuralGeometry {
  const price = Math.max(market.last_price, 0.0001);
  const roundTripCostPct = Math.max(
    0,
    takerFeePct * 2 + market.bid_ask_spread_pct + estimatedSlippagePct * 2,
  );
  const breakoutAccepted = price > market.resistance_zone_high
    && market.return_15m_pct >= 0
    && market.volume_ratio_20 >= 0.9
    && (market.trade_flow_imbalance === null || market.trade_flow_imbalance >= -0.05);
  const fallbackTargetPct = Math.max(
    market.atr_14_1h_pct * 0.9,
    market.atr_14_pct * 2,
    roundTripCostPct * 1.25,
  );
  const primaryTarget = market.resistance_zone_low > price
    ? market.resistance_zone_low
    : market.resistance_zone_high > price
      ? market.resistance_zone_high
      : price * (1 + fallbackTargetPct / 100);
  const secondaryTarget = market.secondary_resistance_price > price
    ? market.secondary_resistance_price
    : price * (1 + Math.max(fallbackTargetPct, market.atr_14_4h_pct * 0.35) / 100);
  const targetPrice = breakoutAccepted ? Math.max(primaryTarget, secondaryTarget) : primaryTarget;
  const fallbackInvalidationPct = Math.max(market.atr_14_1h_pct * 0.45, market.atr_14_pct * 1.1, 0.08);
  const invalidationPrice = market.support_zone_low > 0 && market.support_zone_low < price
    ? market.support_zone_low
    : price * (1 - fallbackInvalidationPct / 100);
  const targetDistancePct = Math.max(0, (targetPrice / price - 1) * 100);
  const invalidationDistancePct = Math.max(0.01, (1 - invalidationPrice / price) * 100);
  const supportDistance = Math.max(0, market.support_distance_pct);
  const resistanceDistance = Math.max(0, market.resistance_distance_pct);
  const supportTolerance = Math.max(market.atr_14_pct * 1.25, market.atr_14_1h_pct * 0.25, 0.08);
  const resistanceTolerance = Math.max(market.atr_14_pct * 1.1, market.atr_14_1h_pct * 0.2, 0.08);
  return {
    roundTripCostPct,
    atrToCostRatio: market.atr_14_pct / Math.max(roundTripCostPct, 0.0001),
    targetPrice,
    invalidationPrice,
    targetDistancePct,
    invalidationDistancePct,
    targetToCostRatio: targetDistancePct / Math.max(roundTripCostPct, 0.0001),
    nearSupport: supportDistance <= supportTolerance,
    nearResistance: resistanceDistance <= resistanceTolerance,
    breakoutAccepted,
  };
}

export function normalizedWallSupport(market: MarketIndicatorState) {
  return clamp(
    market.orderbook_wall_bias * 0.45
      + market.orderbook_imbalance * 0.25
      + (market.bid_wall_persistence - market.ask_wall_persistence) * 0.2
      + ((market.trade_flow_imbalance ?? 0) * 0.1),
    -1,
    1,
  );
}
