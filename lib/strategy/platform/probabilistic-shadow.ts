import type {
  JevDecision,
  MarketIndicatorState,
  ShadowProbabilityForecast,
} from "../../types";

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value) ? value! : fallback;
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function softmax(values: number[]) {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
}

function geometrySignal(targetDistancePct: number, invalidationDistancePct: number) {
  const epsilon = 0.02;
  return clamp(
    Math.log((invalidationDistancePct + epsilon) / (targetDistancePct + epsilon)) / 2,
    -1,
    1,
  );
}

function readinessScore(decision: JevDecision) {
  if (Number.isFinite(decision.readinessScore)) return clamp(decision.readinessScore!);
  const probabilities = decision.judgments.entry_readiness.probabilities;
  return clamp(
    probabilities.enter_now
      + probabilities.wait_close * 0.55
      + probabilities.wait_retest * 0.35
      - probabilities.no_entry * 0.75,
  );
}

export function buildShadowProbabilityForecast(
  decision: JevDecision,
  market: MarketIndicatorState,
): ShadowProbabilityForecast | null {
  const plan = decision.candidatePlan;
  if (!plan || plan.status !== "available") return null;

  const direction = decision.judgments.direction.probabilities;
  const directionEdge = clamp(finite(direction.up) - finite(direction.down), -1, 1);
  const directionUnclear = clamp(finite(direction.unclear));
  const quality = clamp(finite(decision.judgments.setup_quality.score) / 4);
  const liquidity = clamp(finite(decision.judgments.liquidity_ok));
  const supportStrength = clamp(finite(plan.supportStrength));
  const resistanceStrength = clamp(finite(plan.resistanceStrength));
  const readiness = readinessScore(decision);
  const geometry = geometrySignal(plan.target1DistancePct, plan.invalidationDistancePct);
  const flow = clamp(finite(market.trade_flow_imbalance), -1, 1);
  const wallBias = clamp(
    finite(market.bid_wall_strength) - finite(market.ask_wall_strength),
    -1,
    1,
  );
  const squeezeSpread = clamp(
    finite(market.short_squeeze_risk) - finite(market.long_squeeze_risk),
    -1,
    1,
  );
  const cutRisk = clamp(finite(decision.judgments.cut_position));
  const disorder = clamp(finite(decision.judgments.disorderly));

  const targetLogit =
    0.10
    + directionEdge * 1.10
    + (quality - 0.5) * 0.80
    + (readiness - 0.5) * 0.55
    + (liquidity - 0.5) * 0.45
    + (supportStrength - 0.5) * 0.50
    + geometry * 0.55
    + flow * 0.25
    + wallBias * 0.15
    + squeezeSpread * 0.10;

  const invalidationLogit =
    0.10
    - directionEdge * 1.00
    + (cutRisk - 0.5) * 0.85
    + (disorder - 0.5) * 0.35
    - geometry * 0.45
    - flow * 0.20
    - wallBias * 0.10;

  const timeoutLogit =
    0.35
    + directionUnclear * 0.75
    + (1 - readiness) * 0.60
    + (1 - Math.abs(directionEdge)) * 0.25
    - Math.abs(geometry) * 0.15;

  const [target1BeforeInvalidation, invalidationBeforeTarget1, timeout] = softmax([
    targetLogit,
    invalidationLogit,
    timeoutLogit,
  ]);

  const oi1h = clamp(finite(market.open_interest_change_1h_pct) / 3, -1, 1);
  const trendEfficiency = clamp(finite(market.trend_efficiency_4h));
  const volumeExpansion = clamp((finite(market.volume_ratio_20, 1) - 1) / 1.5, -1, 1);
  const breakoutMomentum = clamp(finite(market.breakout_24h_pct) / Math.max(finite(market.atr_14_pct, 0.1), 0.05), -1, 1);
  const target1BreakConditional = sigmoid(
    -0.35
      + directionEdge * 0.35
      + (trendEfficiency - 0.5) * 0.65
      + flow * 0.45
      + volumeExpansion * 0.40
      + oi1h * 0.25
      + squeezeSpread * 0.30
      + wallBias * 0.15
      + breakoutMomentum * 0.30
      - (resistanceStrength - 0.5) * 0.30,
  );

  const expectedNetReturnPct =
    target1BeforeInvalidation * plan.target1DistancePct
    - invalidationBeforeTarget1 * plan.invalidationDistancePct
    - plan.roundTripCostPct;

  return {
    status: "uncalibrated_shadow",
    methodRevision: "shadow-probability-r1",
    horizonMinutes: 240,
    target1BeforeInvalidation,
    invalidationBeforeTarget1,
    timeout,
    target1BreakConditional,
    expectedNetReturnPct,
    executionAuthoritative: false,
  };
}

export function attachShadowProbabilityForecasts(
  decisions: JevDecision[],
  indicators: Record<JevDecision["asset"], MarketIndicatorState>,
) {
  return decisions.map((decision) => {
    const forecast = buildShadowProbabilityForecast(decision, indicators[decision.asset]);
    return forecast ? { ...decision, shadowForecast: forecast } : decision;
  });
}
