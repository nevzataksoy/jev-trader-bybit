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
  if (judgment.action.choice === "reduce" || judgment.action.choice === "exit") return "reduce";
  if (judgment.action.choice === "hold") return "none";
  const atr15m = Number.isFinite(market.atr_14_pct) ? market.atr_14_pct : 0.1;
  const atr1h = Number.isFinite(market.atr_14_1h_pct) ? market.atr_14_1h_pct : atr15m * 2;
  const supportDistance = Number.isFinite(market.support_distance_pct)
    ? Math.max(0, market.support_distance_pct)
    : Number.POSITIVE_INFINITY;
  const nearSupport = supportDistance <= Math.max(atr15m * 1.25, atr1h * 0.25, 0.08);
  const breakoutAccepted = Number.isFinite(market.resistance_zone_high)
    ? market.last_price > market.resistance_zone_high
    : market.channel_24h_position >= 0.9;
  if (breakoutAccepted || market.channel_24h_position >= 0.92) return "upside_breakout";
  if (judgment.regime.choice === "range") return nearSupport ? "range_reversion" : "none";
  if (judgment.regime.choice === "bear") return nearSupport ? "bear_rebound" : "none";
  if (judgment.regime.choice === "bull" || judgment.regime.choice === "accumulation") {
    const supportStrength = Number.isFinite(market.support_strength) ? market.support_strength : 0;
    return nearSupport || supportStrength >= 0.42 ? "trend_pullback" : "none";
  }
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
    false_breakout: setup === "upside_breakout" ? judgment.invalidationRisk : 0.5,
    reversal_confirmation: setup === "bear_rebound" || setup === "range_reversion"
      ? 1 - judgment.invalidationRisk
      : 0.5,
    liquidity_ok: judgment.liquidityOk,
    disorderly: judgment.invalidationRisk,
    cut_position: Math.max(
      judgment.action.probabilities.exit ?? 0,
      judgment.action.probabilities.reduce ?? 0,
      judgment.thesisHealth.probabilities.invalid,
      judgment.invalidationRisk,
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
