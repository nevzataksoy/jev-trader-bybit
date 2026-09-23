import type { MarketIndicatorState } from "../../types";

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function finite(value: number | undefined | null, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
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
  const price = Math.max(finite(market.last_price, 0.0001), 0.0001);
  const atr15mPct = Math.max(finite(market.atr_14_pct, 0.1), 0.01);
  const atr1hPct = Math.max(finite(market.atr_14_1h_pct, atr15mPct * 2), 0.01);
  const atr4hPct = Math.max(finite(market.atr_14_4h_pct, atr1hPct * 2), 0.01);
  const supportLow = finite(market.support_zone_low, Math.min(market.channel_24h_low || price, price * (1 - atr1hPct / 100)));
  const resistanceLow = finite(market.resistance_zone_low, Math.max(market.channel_24h_high || price, price));
  const resistanceHigh = finite(market.resistance_zone_high, resistanceLow);
  const secondaryResistance = finite(market.secondary_resistance_price, Math.max(market.channel_3d_high || resistanceHigh, resistanceHigh));
  const supportDistancePct = Math.max(0, finite(market.support_distance_pct, (price / Math.max(supportLow, 0.0001) - 1) * 100));
  const resistanceDistancePct = Math.max(0, finite(market.resistance_distance_pct, (resistanceLow / price - 1) * 100));
  const roundTripCostPct = Math.max(
    0,
    takerFeePct * 2 + market.bid_ask_spread_pct + estimatedSlippagePct * 2,
  );
  const breakoutAccepted = price > resistanceHigh
    && market.return_15m_pct >= 0
    && market.volume_ratio_20 >= 0.9
    && (market.trade_flow_imbalance === null || market.trade_flow_imbalance >= -0.05);
  const fallbackTargetPct = Math.max(
    atr1hPct * 0.9,
    atr15mPct * 2,
    roundTripCostPct * 1.25,
  );
  const primaryTarget = resistanceLow > price
    ? resistanceLow
    : resistanceHigh > price
      ? resistanceHigh
      : price * (1 + fallbackTargetPct / 100);
  const secondaryTarget = secondaryResistance > price
    ? secondaryResistance
    : price * (1 + Math.max(fallbackTargetPct, atr4hPct * 0.35) / 100);
  const targetPrice = breakoutAccepted ? Math.max(primaryTarget, secondaryTarget) : primaryTarget;
  const fallbackInvalidationPct = Math.max(atr1hPct * 0.45, atr15mPct * 1.1, 0.08);
  const invalidationPrice = supportLow > 0 && supportLow < price
    ? supportLow
    : price * (1 - fallbackInvalidationPct / 100);
  const targetDistancePct = Math.max(0, (targetPrice / price - 1) * 100);
  const invalidationDistancePct = Math.max(0.01, (1 - invalidationPrice / price) * 100);
  const supportDistance = supportDistancePct;
  const resistanceDistance = resistanceDistancePct;
  const supportTolerance = Math.max(atr15mPct * 1.25, atr1hPct * 0.25, 0.08);
  const resistanceTolerance = Math.max(atr15mPct * 1.1, atr1hPct * 0.2, 0.08);
  return {
    roundTripCostPct,
    atrToCostRatio: atr15mPct / Math.max(roundTripCostPct, 0.0001),
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
    finite(market.orderbook_wall_bias, 0) * 0.45
      + finite(market.orderbook_imbalance, 0) * 0.25
      + (finite(market.bid_wall_persistence, 0.25) - finite(market.ask_wall_persistence, 0.25)) * 0.2
      + (finite(market.trade_flow_imbalance, 0) * 0.1),
    -1,
    1,
  );
}
