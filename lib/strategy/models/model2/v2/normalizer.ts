import type {
  JevAssetJudgments,
  MarketIndicatorState,
  TradeAsset,
  TradingSetup,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";

export type RotationRegime = "bull" | "bear" | "range" | "accumulation" | "uncertain";
export type RotationAction = "enter" | "increase" | "watch" | "hold" | "reduce" | "exit";
export type RotationSuitability = "strong" | "moderate" | "watch" | "reject";
export type RotationThesisHealth = "healthy" | "weakening" | "invalid" | "uncertain";

export interface RotationAssetJudgment {
  regime: {
    choice: RotationRegime;
    confidence: number;
    probabilities: Record<RotationRegime, number>;
  };
  action: {
    choice: RotationAction;
    confidence: number;
    probabilities: Record<RotationAction, number>;
  };
  suitability: {
    choice: RotationSuitability;
    confidence: number;
    probabilities: Record<RotationSuitability, number>;
  };
  thesisHealth: {
    choice: RotationThesisHealth;
    confidence: number;
    probabilities: Record<RotationThesisHealth, number>;
  };
  timing: {
    choice: "enter_now" | "wait_close" | "wait_retest" | "no_entry";
    confidence: number;
    probabilities: Record<"enter_now" | "wait_close" | "wait_retest" | "no_entry", number>;
  };
  direction: {
    choice: "up" | "down" | "unclear";
    confidence: number;
    probabilities: Record<"up" | "down" | "unclear", number>;
  };
  planQuality: { score: number; confidence: number; probabilities: Record<string, number> };
  invalidationRisk: number;
  liquidityOk: number;
}

function selectedSetup(judgment: RotationAssetJudgment, market: MarketIndicatorState): TradingSetup {
  if (judgment.regime.choice === "range") return "range_reversion";
  if (judgment.regime.choice === "bear") return "bear_rebound";
  if (market.channel_24h_position >= 0.9) return "upside_breakout";
  if (judgment.regime.choice === "bull" || judgment.regime.choice === "accumulation") return "trend_pullback";
  if (market.regime === "range" || market.regime === "compression") return "range_reversion";
  if (market.regime === "bear_trend") return "bear_rebound";
  if (market.regime === "bull_trend") return "trend_pullback";
  return "none";
}

function toJevAssetJudgments(
  judgment: RotationAssetJudgment,
  setup: TradingSetup,
): JevAssetJudgments {
  const regimeChoice = judgment.regime.choice === "bull"
    ? "uptrend"
    : judgment.regime.choice === "bear"
      ? "downtrend"
      : judgment.regime.choice === "range"
        ? "range"
        : "transition";
  const setupProbabilities: Record<TradingSetup, number> = {
    trend_pullback: setup === "trend_pullback" ? 1 : 0,
    upside_breakout: setup === "upside_breakout" ? 1 : 0,
    range_reversion: setup === "range_reversion" ? 1 : 0,
    bear_rebound: setup === "bear_rebound" ? 1 : 0,
    reduce: setup === "reduce" ? 1 : 0,
    none: setup === "none" ? 1 : 0,
  };
  return {
    regime: {
      choice: regimeChoice,
      confidence: judgment.regime.confidence,
      probabilities: {
        uptrend: judgment.regime.probabilities.bull,
        downtrend: judgment.regime.probabilities.bear,
        range: judgment.regime.probabilities.range,
        compression: judgment.regime.probabilities.accumulation,
        transition: judgment.regime.probabilities.uncertain,
      },
    },
    best_setup: { choice: setup, confidence: judgment.suitability.confidence, probabilities: setupProbabilities },
    entry_readiness: judgment.timing,
    direction: judgment.direction,
    follow_through: {
      choice: judgment.direction.choice === "up" ? "continuation" : judgment.direction.choice === "down" ? "reversal" : "no_pattern",
      confidence: judgment.direction.confidence,
      probabilities: {
        continuation: judgment.direction.probabilities.up,
        reversal: judgment.direction.probabilities.down,
        no_pattern: judgment.direction.probabilities.unclear,
      },
    },
    setup_quality: judgment.planQuality,
    false_breakout: 0.5,
    reversal_confirmation: 0.5,
    liquidity_ok: judgment.liquidityOk,
    disorderly: 0,
    cut_position: Math.max(
      judgment.action.probabilities.exit ?? 0,
      judgment.action.probabilities.reduce ?? 0,
      judgment.thesisHealth.probabilities.invalid,
    ),
  };
}

export function buildRotationJevJudgments(
  judgments: Record<TradeAsset, RotationAssetJudgment>,
  indicators: Record<TradeAsset, MarketIndicatorState>,
): Record<TradeAsset, JevAssetJudgments> {
  return Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    return [asset, toJevAssetJudgments(judgment, selectedSetup(judgment, indicators[asset]))];
  })) as Record<TradeAsset, JevAssetJudgments>;
}
