import type { getTradingConfig } from "./config";
import type {
  JevAssetJudgments,
  JevDecision,
  MacroState,
  MarketIndicatorState,
  PositionContext,
  TradeAction,
  TradeAsset,
} from "./types";
import { TRADE_ASSETS } from "./types";

type TradingConfig = ReturnType<typeof getTradingConfig>;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mamisMultiplier(phase: MarketIndicatorState["mamis_phase"], confidence: number) {
  if (confidence < 0.6) return 0.8;
  const multipliers: Record<MarketIndicatorState["mamis_phase"], number> = {
    returning_confidence: 1,
    wall_of_worry: 0.9,
    buy_the_dip: 0.75,
    enthusiasm: 0.65,
    disbelief: 0.5,
    anxiety: 0.55,
    denial: 0.4,
    panic: 0.25,
    discouragement: 0.35,
    aversion: 0.4,
    uncertain: 0.75,
  };
  return multipliers[phase];
}

function marketRegimeMultiplier(market: MarketIndicatorState) {
  if (market.regime === "bull_trend") return 1;
  if (market.regime === "range") return 0.65;
  if (market.regime === "transition") return 0.45;
  return market.countertrend_rebound_score >= 0.7 ? 0.3 : 0.1;
}

function macroMultiplier(asset: TradeAsset, macro: MacroState | null) {
  if (!macro || macro.data_quality === "unavailable" || macro.data_quality === "stale") return 0.85;
  if (asset === "XAUT") {
    if (macro.gold_real_yield_regime === "supportive") return 1;
    if (macro.gold_real_yield_regime === "restrictive") return 0.6;
    return 0.85;
  }
  if (macro.policy_regime === "tightening_shock") return 0.45;
  if (macro.policy_regime === "tightening") return 0.7;
  if (macro.policy_regime === "easing_shock") return 0.75;
  if (macro.policy_regime === "easing") return 1;
  return 0.9;
}

function evidenceProbabilities(judgments: JevAssetJudgments, held: boolean): Record<TradeAction, number> {
  const setup = clamp(judgments.setup_quality.score / 3);
  const buyEvidence = judgments.direction.probabilities.up * (0.35 + setup * 0.65) * judgments.liquidity_ok;
  const sellEvidence = held
    ? Math.max(judgments.direction.probabilities.down * (0.35 + setup * 0.65), judgments.cut_position)
    : 0;
  const holdEvidence = judgments.direction.probabilities.unclear
    + (1 - setup) * 0.5
    + (1 - judgments.liquidity_ok) * 0.5;
  const total = buyEvidence + sellEvidence + holdEvidence || 1;
  return {
    buy: buyEvidence / total,
    sell: sellEvidence / total,
    hold: holdEvidence / total,
  };
}

function calculateRawTarget(
  asset: TradeAsset,
  judgments: JevAssetJudgments,
  market: MarketIndicatorState,
  position: PositionContext,
  macro: MacroState | null,
  config: TradingConfig,
) {
  const current = position.allocation_pct;
  const setup = clamp(judgments.setup_quality.score / 3);
  const confidence = clamp((judgments.direction.confidence + judgments.setup_quality.confidence) / 2);
  const edge = judgments.direction.probabilities.up - judgments.direction.probabilities.down;
  const followMultiplier = clamp(
    0.65
      + judgments.follow_through.probabilities.continuation * 0.45
      - judgments.follow_through.probabilities.reversal * 0.2,
    0.4,
    1,
  );

  if (judgments.cut_position >= config.cutPositionProbability) {
    return { target: 0, confidence: Math.max(confidence, judgments.cut_position), reason: "cut-position gate selected full risk reduction" };
  }
  if (judgments.disorderly >= config.disorderlyProbability) {
    return {
      target: position.status === "held" ? current * 0.5 : 0,
      confidence: Math.max(confidence, judgments.disorderly),
      reason: "disorderly-market gate blocks new exposure and reduces existing risk",
    };
  }

  if (confidence < config.minPolicyConfidence) {
    return { target: current, confidence, reason: "atomic judgments lack sufficient combined confidence" };
  }

  if (edge >= config.minDirectionalEdge && judgments.setup_quality.score >= config.minSetupScore) {
    const directionalStrength = clamp((edge - config.minDirectionalEdge) / (1 - config.minDirectionalEdge));
    const volatilityScale = Math.min(1, config.targetDailyVolatilityPct / Math.max(market.realized_volatility_24h_pct, 0.1));
    const capPct = config.maxAssetAllocationPct * 100;
    let target = capPct
      * directionalStrength
      * (0.35 + setup * 0.65)
      * followMultiplier
      * confidence
      * volatilityScale
      * marketRegimeMultiplier(market)
      * mamisMultiplier(market.mamis_phase, market.mamis_confidence)
      * macroMultiplier(asset, macro);
    if (judgments.liquidity_ok < config.minLiquidityProbability) target = Math.min(target, current);
    return {
      target: clamp(target, 0, capPct),
      confidence,
      reason: "positive directional edge converted into a volatility, regime, sentiment and macro adjusted target",
    };
  }

  if (edge <= -config.minDirectionalEdge && position.status === "held") {
    const negativeStrength = clamp((-edge - config.minDirectionalEdge) / (1 - config.minDirectionalEdge));
    const regimeUrgency = market.regime === "bear_trend" ? 1 : market.regime === "transition" ? 0.8 : 0.6;
    const reduction = clamp(negativeStrength * (0.4 + setup * 0.6) * regimeUrgency);
    return {
      target: current * (1 - reduction),
      confidence,
      reason: "negative directional edge converted into a gradual USDT risk reduction target",
    };
  }

  return { target: current, confidence, reason: "edge or setup quality is inside the no-trade zone" };
}

export function buildPortfolioDecisions(
  judgments: Record<TradeAsset, JevAssetJudgments>,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
  macro: MacroState | null,
  config: TradingConfig,
): JevDecision[] {
  const raw = Object.fromEntries(TRADE_ASSETS.map((asset) => [
    asset,
    calculateRawTarget(asset, judgments[asset], indicators[asset], positions[asset], macro, config),
  ])) as Record<TradeAsset, ReturnType<typeof calculateRawTarget>>;
  const maximumInvestedPct = (1 - config.minUsdtReservePct) * 100;
  const rawTotal = TRADE_ASSETS.reduce((sum, asset) => sum + raw[asset].target, 0);
  const scale = rawTotal > maximumInvestedPct ? maximumInvestedPct / rawTotal : 1;

  return TRADE_ASSETS.map((asset) => {
    const current = positions[asset].allocation_pct;
    const target = raw[asset].target * scale;
    const delta = target - current;
    const action: TradeAction = delta >= config.allocationDeadbandPct
      ? "buy"
      : delta <= -config.allocationDeadbandPct && positions[asset].status === "held"
        ? "sell"
        : "hold";
    return {
      asset,
      action,
      confidence: action === "sell"
        ? Math.max(raw[asset].confidence, judgments[asset].cut_position)
        : raw[asset].confidence,
      probabilities: evidenceProbabilities(judgments[asset], positions[asset].status === "held"),
      currentAllocationPct: current,
      targetAllocationPct: target,
      rebalanceDeltaPct: delta,
      policyReason: `${raw[asset].reason}; portfolio target ${target.toFixed(2)}% versus current ${current.toFixed(2)}%.`,
      judgments: judgments[asset],
    };
  });
}
