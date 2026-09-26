import type {
  AssetId,
  JevChoiceJudgment,
  JevPortfolioJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAsset,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import type {
  RotationAction,
  RotationAssetJudgment,
  RotationSuitability,
  RotationThesisHealth,
} from "./normalizer";

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
  judgments: Record<TradeAsset, RotationAssetJudgment>,
): JevPortfolioJudgments {
  const ranked = TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const suitability = judgment.suitability.probabilities;
    const timing = judgment.timing.probabilities;
    const score = clamp(
      judgment.direction.probabilities.up * 0.28
      + judgment.planQuality.score / 4 * 0.22
      + suitability.strong * 0.16
      + suitability.moderate * 0.08
      + timing.enter_now * 0.12
      + (timing.wait_close + timing.wait_retest) * 0.05
      + judgment.liquidityOk * 0.14
      - judgment.invalidationRisk * 0.22,
    );
    const qualified = judgment.action.choice === "enter"
      || judgment.action.choice === "increase"
      || judgment.action.choice === "watch";
    return { asset, score, qualified, action: judgment.action.choice };
  }).sort((left, right) => right.score - left.score);

  const qualified = ranked.filter((item) => item.qualified);
  const preferred: AssetId = qualified.length ? qualified[0].asset : "USDT";
  const best = qualified[0]?.score ?? 0;
  const second = qualified[1]?.score ?? 0;
  const gap = Math.max(0, best - second);
  const separationScore = preferred === "USDT" ? 0 : gap >= 0.25 ? 3 : gap >= 0.12 ? 2 : 1;
  const preferredAction = qualified[0]?.action;
  const riskBudget = preferred === "USDT"
    ? "zero"
    : preferredAction === "watch"
      ? "low"
      : best >= 0.78 && qualified.length >= 2
        ? "high"
        : best >= 0.6 ? "medium" : "low";

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

export interface BlindRotationEvidence extends Omit<RotationAssetJudgment, "action" | "suitability" | "thesisHealth"> {
  suitability: JevChoiceJudgment<RotationSuitability>;
  thesisHealth: JevChoiceJudgment<RotationThesisHealth>;
}

function deterministicRotationAction(
  evidence: BlindRotationEvidence,
  market: MarketIndicatorState,
  position: PositionContext,
): RotationAction {
  if (position.status === "held" && (evidence.thesisHealth.choice === "invalid" || evidence.invalidationRisk >= 0.65)) return "exit";
  if (position.status === "held" && (evidence.thesisHealth.choice === "weakening" || evidence.direction.choice === "down")) return "reduce";

  if (position.status === "flat" && evidence.suitability.choice === "strong" && evidence.timing.choice === "enter_now") {
    return "enter";
  }

  const progressing = position.unrealized_pnl_pct !== null && position.unrealized_pnl_pct >= 0;
  if (
    position.status === "held"
    && progressing
    && evidence.suitability.choice === "strong"
    && evidence.timing.choice === "enter_now"
    && market.return_1h_pct >= 0
  ) {
    return "increase";
  }

  const waitingForConfirmation = evidence.timing.choice === "wait_close" || evidence.timing.choice === "wait_retest";
  const watchableSuitability = evidence.suitability.choice === "strong"
    || evidence.suitability.choice === "moderate"
    || evidence.suitability.choice === "watch";
  const counterTrendContext = evidence.regime.choice === "range" || evidence.regime.choice === "bear";
  if (
    waitingForConfirmation
    && watchableSuitability
    && (evidence.direction.choice !== "down" || counterTrendContext)
    && evidence.invalidationRisk < 0.65
    && evidence.liquidityOk >= 0.5
  ) {
    return "watch";
  }

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
      : action === "reduce"
        ? item.thesisHealth.confidence
        : action === "watch"
          ? Math.max(item.suitability.confidence, item.timing.confidence)
          : item.suitability.confidence;
    return [asset, {
      regime: item.regime,
      action: choiceJudgment(action, ["enter", "increase", "watch", "hold", "reduce", "exit"] as const, actionConfidence),
      suitability: item.suitability,
      thesisHealth: item.thesisHealth,
      timing: item.timing,
      direction: item.direction,
      planQuality: item.planQuality,
      invalidationRisk: item.invalidationRisk,
      liquidityOk: item.liquidityOk,
    } satisfies RotationAssetJudgment];
  })) as Record<TradeAsset, RotationAssetJudgment>;

  return {
    judgments,
    portfolioJudgments: buildDeterministicPortfolioJudgments(judgments),
  };
}
