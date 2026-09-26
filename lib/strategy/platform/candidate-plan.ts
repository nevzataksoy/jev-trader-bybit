import type { CandidateTradePlan, MarketIndicatorState } from "../../types";

function finite(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value) ? value! : fallback;
}

export function buildCandidateTradePlan(
  market: MarketIndicatorState,
  roundTripCostPct: number,
): CandidateTradePlan {
  const price = finite(market.last_price);
  const supportLow = finite(market.support_zone_low);
  const supportHigh = finite(market.support_zone_high);
  const resistanceLow = finite(market.resistance_zone_low);
  const resistanceHigh = finite(market.resistance_zone_high);
  const atrPct = Math.max(finite(market.atr_14_pct, 0.1), 0.05);
  const costPct = Math.max(0, finite(roundTripCostPct));

  const supportValid = price > 0
    && supportLow > 0
    && supportHigh >= supportLow
    && supportLow <= price;
  const resistanceValid = price > 0
    && resistanceLow > 0
    && resistanceHigh >= resistanceLow
    && resistanceHigh >= price;
  const structureValid = supportValid
    && resistanceValid
    && resistanceHigh > supportLow;

  if (!structureValid) {
    return {
      status: "unavailable",
      location: "unstructured",
      supportDistancePct: 0,
      supportStrength: finite(market.support_strength),
      resistanceDistancePct: 0,
      resistanceStrength: finite(market.resistance_strength),
      invalidationDistancePct: atrPct,
      target1DistancePct: 0,
      target1AfterCostRoomPct: -costPct,
      target1RewardRiskRatio: 0,
      roundTripCostPct: costPct,
    };
  }

  const supportDistancePct = Math.max(0, (price - supportHigh) / price * 100);
  const resistanceDistancePct = Math.max(0, (resistanceLow - price) / price * 100);
  const invalidationDistancePct = Math.max(
    atrPct * 0.55,
    Math.max(0, (price - supportLow) / price * 100),
  );
  const target1DistancePct = resistanceDistancePct;
  const target1AfterCostRoomPct = target1DistancePct - costPct;
  const target1RewardRiskRatio = target1DistancePct / Math.max(invalidationDistancePct, 0.0001);
  const supportProximityLimit = Math.max(atrPct * 1.5, 0.12);

  const insideSupport = price >= supportLow && price <= supportHigh;
  const insideResistance = price >= resistanceLow && price <= resistanceHigh;
  const location = insideSupport
    ? "inside_support"
    : insideResistance
      ? "inside_resistance"
      : supportDistancePct <= supportProximityLimit
        ? "near_support"
        : "between_levels";

  return {
    status: "available",
    location,
    supportDistancePct,
    supportStrength: finite(market.support_strength),
    resistanceDistancePct,
    resistanceStrength: finite(market.resistance_strength),
    invalidationDistancePct,
    target1DistancePct,
    target1AfterCostRoomPct,
    target1RewardRiskRatio,
    roundTripCostPct: costPct,
  };
}
