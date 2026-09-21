import type {
  AssetId,
  JevAssetJudgments,
  JevChoiceJudgment,
  JevPortfolioJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAsset,
} from "../types";
import { TRADE_ASSETS } from "../types";
import type { RotationAssetJudgment, RotationAction } from "./model2-policy";

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function choiceJudgment<T extends string>(choice: T, choices: readonly T[], confidence: number): JevChoiceJudgment<T> {
  const bounded = clamp(confidence);
  const remainder = choices.length > 1 ? (1 - bounded) / (choices.length - 1) : 0;
  return {
    choice,
    confidence: bounded,
    probabilities: Object.fromEntries(choices.map((item) => [item, item === choice ? bounded : remainder])) as Record<T, number>,
  };
}

export function buildDeterministicPortfolioJudgments(
  judgments: Record<TradeAsset, JevAssetJudgments>,
): JevPortfolioJudgments {
  const ranked = TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const directionEdge = judgment.direction.probabilities.up - judgment.direction.probabilities.down;
    const score = clamp(
      judgment.direction.probabilities.up * 0.3
      + judgment.setup_quality.score / 4 * 0.25
      + judgment.entry_readiness.probabilities.enter_now * 0.15
      + judgment.liquidity_ok * 0.15
      + judgment.follow_through.probabilities.continuation * 0.15
      - judgment.false_breakout * 0.1
      - judgment.disorderly * 0.2
      - judgment.cut_position * 0.25,
    );
    const qualified = judgment.best_setup.choice !== "none"
      && judgment.entry_readiness.choice === "enter_now"
      && directionEdge >= 0.08
      && judgment.setup_quality.score >= 2
      && judgment.liquidity_ok >= 0.55
      && judgment.disorderly < 0.55
      && judgment.cut_position < 0.55;
    return { asset, score, qualified };
  }).sort((left, right) => right.score - left.score);
  const qualified = ranked.filter((item) => item.qualified);
  const preferred: AssetId = qualified.length ? qualified[0].asset : "USDT";
  const best = qualified[0]?.score ?? 0;
  const second = qualified[1]?.score ?? 0;
  const gap = Math.max(0, best - second);
  const separationScore = preferred === "USDT" ? 0 : gap >= 0.25 ? 3 : gap >= 0.12 ? 2 : 1;
  const riskBudget = preferred === "USDT"
    ? "zero"
    : best >= 0.78 && qualified.length >= 2 ? "high"
      : best >= 0.62 ? "medium" : "low";
  return {
    preferred_destination: choiceJudgment(preferred, ["USDT", ...TRADE_ASSETS] as const, preferred === "USDT" ? 0.8 : clamp(0.55 + gap)),
    gross_risk_budget: choiceJudgment(riskBudget, ["zero", "low", "medium", "high"] as const, clamp(0.6 + best * 0.3)),
    opportunity_separation: {
      score: separationScore,
      confidence: clamp(0.55 + gap),
      probabilities: {
        "0": separationScore === 0 ? 0.7 : 0.1,
        "1": separationScore === 1 ? 0.7 : 0.1,
        "2": separationScore === 2 ? 0.7 : 0.1,
        "3": separationScore === 3 ? 0.7 : 0.1,
      },
    },
  };
}

export type BlindSuitability = "strong" | "moderate" | "watch" | "reject";
export type BlindThesisHealth = "healthy" | "weakening" | "invalid" | "uncertain";

export interface BlindRotationEvidence extends Omit<RotationAssetJudgment, "action"> {
  suitability: JevChoiceJudgment<BlindSuitability>;
  thesisHealth: JevChoiceJudgment<BlindThesisHealth>;
}

function deterministicRotationAction(
  evidence: BlindRotationEvidence,
  market: MarketIndicatorState,
  position: PositionContext,
): RotationAction {
  if (position.status === "held" && (evidence.thesisHealth.choice === "invalid" || evidence.invalidationRisk >= 0.65)) return "exit";
  if (position.status === "held" && (evidence.thesisHealth.choice === "weakening" || evidence.direction.choice === "down")) return "reduce";
  if (position.status === "flat" && evidence.suitability.choice === "strong" && evidence.timing.choice === "enter_now") return "enter";
  const progressing = position.unrealized_pnl_pct !== null && position.unrealized_pnl_pct >= 0;
  if (position.status === "held" && progressing && evidence.suitability.choice === "strong" && evidence.timing.choice === "enter_now" && market.return_1h_pct >= 0) return "increase";
  return "hold";
}

export function finalizeBlindRotationEvidence(
  evidence: Record<TradeAsset, BlindRotationEvidence>,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
) {
  const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const item = evidence[asset];
    const action = deterministicRotationAction(item, indicators[asset], positions[asset]);
    const actionConfidence = action === "exit"
      ? Math.max(item.invalidationRisk, item.thesisHealth.confidence)
      : action === "reduce" ? item.thesisHealth.confidence : item.suitability.confidence;
    return [asset, {
      regime: item.regime,
      action: choiceJudgment(action, ["enter", "increase", "hold", "reduce", "exit"] as const, actionConfidence),
      timing: item.timing,
      direction: item.direction,
      planQuality: item.planQuality,
      invalidationRisk: item.invalidationRisk,
      liquidityOk: item.liquidityOk,
    } satisfies RotationAssetJudgment];
  })) as Record<TradeAsset, RotationAssetJudgment>;

  const portfolioInputs = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const item = evidence[asset];
    const setup = item.regime.choice === "range" ? "range_reversion"
      : item.regime.choice === "bear" ? "bear_rebound"
        : item.regime.choice === "bull" || item.regime.choice === "accumulation" ? "trend_pullback" : "none";
    return [asset, {
      regime: choiceJudgment(
        item.regime.choice === "bull" ? "uptrend" : item.regime.choice === "bear" ? "downtrend" : item.regime.choice === "range" ? "range" : "transition",
        ["uptrend", "downtrend", "range", "compression", "transition"] as const,
        item.regime.confidence,
      ),
      best_setup: choiceJudgment(setup, ["trend_pullback", "upside_breakout", "range_reversion", "bear_rebound", "reduce", "none"] as const, item.suitability.confidence),
      entry_readiness: item.timing,
      direction: item.direction,
      follow_through: choiceJudgment(
        item.direction.choice === "up" ? "continuation" : item.direction.choice === "down" ? "reversal" : "no_pattern",
        ["continuation", "reversal", "no_pattern"] as const,
        item.direction.confidence,
      ),
      setup_quality: item.planQuality,
      false_breakout: item.regime.choice === "range" && indicators[asset].channel_24h_position >= 0.85 ? 0.6 : 0.25,
      reversal_confirmation: item.regime.choice === "bear" && item.direction.choice === "up" ? item.direction.probabilities.up : 0.25,
      liquidity_ok: item.liquidityOk,
      disorderly: item.invalidationRisk,
      cut_position: item.thesisHealth.probabilities.invalid,
    } satisfies JevAssetJudgments];
  })) as Record<TradeAsset, JevAssetJudgments>;

  return { judgments, portfolioJudgments: buildDeterministicPortfolioJudgments(portfolioInputs) };
}
