import type { getTradingConfig } from "../config";
import type {
  EntryReadiness,
  JevAssetJudgments,
  JevDecision,
  JevPortfolioJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAction,
  TradeAsset,
  TradingSetup,
} from "../types";
import { TRADE_ASSETS } from "../types";

type TradingConfig = ReturnType<typeof getTradingConfig>;

export type RotationRegime = "bull" | "bear" | "range" | "accumulation" | "uncertain";
export type RotationAction = "enter" | "increase" | "hold" | "reduce" | "exit";

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

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function riskFraction(choice: JevPortfolioJudgments["gross_risk_budget"]["choice"]) {
  return { zero: 0, low: 0.3, medium: 0.65, high: 1 }[choice];
}

function selectedSetup(judgment: RotationAssetJudgment, market: MarketIndicatorState): TradingSetup {
  if (judgment.action.choice === "reduce" || judgment.action.choice === "exit") return "reduce";
  if (judgment.regime.choice === "range") return "range_reversion";
  if (judgment.regime.choice === "bear") return "bear_rebound";
  if (market.channel_24h_position >= 0.9) return "upside_breakout";
  if (judgment.regime.choice === "bull" || judgment.regime.choice === "accumulation") return "trend_pullback";
  return "none";
}

function entryIsStructurallyAllowed(
  judgment: RotationAssetJudgment,
  market: MarketIndicatorState,
  config: TradingConfig,
) {
  if (judgment.timing.choice !== "enter_now" || judgment.direction.choice !== "up") return false;
  if (judgment.invalidationRisk >= 0.55 || judgment.liquidityOk < config.minLiquidityProbability) return false;
  if (judgment.planQuality.score < config.minSetupScore || judgment.action.confidence < config.minPolicyConfidence) return false;
  if (judgment.regime.choice === "bull") {
    const pullback = market.last_price > market.ema_200
      && market.channel_24h_position >= 0.15
      && market.channel_24h_position <= 0.82;
    const breakout = market.channel_24h_position >= 0.9
      && market.volume_ratio_20 >= 0.9
      && market.upper_wick_atr < 0.75;
    return pullback || breakout;
  }
  if (judgment.regime.choice === "range") {
    const lowerRangeEntry = market.channel_24h_position <= 0.35 && market.price_zscore_20 <= -0.35;
    const confirmedBreakout = market.channel_24h_position > 1
      && market.breakout_24h_pct > 0
      && market.volume_ratio_20 >= 1;
    return lowerRangeEntry || confirmedBreakout;
  }
  if (judgment.regime.choice === "accumulation") {
    return market.channel_3d_position <= 0.55
      && market.ema_50_slope_3h_pct >= -0.15
      && market.minus_di_14 <= market.plus_di_14 * 1.25;
  }
  if (judgment.regime.choice === "bear") {
    return market.countertrend_rebound_score >= config.minBearReboundScore
      && market.return_15m_pct > 0
      && market.return_1h_pct > 0;
  }
  return false;
}

function evidenceProbabilities(judgment: RotationAssetJudgment, held: boolean): Record<TradeAction, number> {
  const buy = (judgment.action.probabilities.enter + judgment.action.probabilities.increase)
    * judgment.direction.probabilities.up * judgment.liquidityOk;
  const sell = held
    ? judgment.action.probabilities.reduce + judgment.action.probabilities.exit + judgment.invalidationRisk
    : 0;
  const hold = judgment.action.probabilities.hold
    + judgment.timing.probabilities.wait_close
    + judgment.timing.probabilities.wait_retest
    + judgment.timing.probabilities.no_entry;
  const total = buy + sell + hold || 1;
  return { buy: buy / total, sell: sell / total, hold: hold / total };
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
    best_setup: { choice: setup, confidence: judgment.action.confidence, probabilities: setupProbabilities },
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
      judgment.action.probabilities.exit,
      judgment.action.probabilities.reduce,
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
    const setup = selectedSetup(judgment, indicators[asset]);
    return [asset, toJevAssetJudgments(judgment, setup)];
  })) as Record<TradeAsset, JevAssetJudgments>;
}

export function buildRotationDecisions(
  judgments: Record<TradeAsset, RotationAssetJudgment>,
  portfolioJudgments: JevPortfolioJudgments,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
  config: TradingConfig,
): JevDecision[] {
  const preferred = portfolioJudgments.preferred_destination.choice;
  const maximumInvestedPct = (1 - config.minUsdtReservePct) * 100;
  const grossRiskBudgetPct = preferred === "USDT"
    ? 0
    : maximumInvestedPct * riskFraction(portfolioJudgments.gross_risk_budget.choice);
  const separation = portfolioJudgments.opportunity_separation.score;

  const scores = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const position = positions[asset];
    const requestedRiskIncrease = judgment.action.choice === "enter" || judgment.action.choice === "increase";
    const actionMatchesBook = judgment.action.choice === "enter"
      ? position.status === "flat"
      : judgment.action.choice === "increase"
        ? position.status === "held" && (position.unrealized_pnl_pct === null || position.unrealized_pnl_pct >= 0)
        : false;
    const entryAllowed = requestedRiskIncrease
      && actionMatchesBook
      && entryIsStructurallyAllowed(judgment, indicators[asset], config);
    const directionalEdge = judgment.direction.probabilities.up - judgment.direction.probabilities.down;
    const score = entryAllowed
      ? Math.max(0.0001, judgment.action.confidence * judgment.liquidityOk * clamp(judgment.planQuality.score / 4)
        * Math.max(0.05, directionalEdge + 0.25) * (asset === preferred ? 1.4 : separation >= 2 ? 0.65 : 1))
      : 0;
    return [asset, { entryAllowed, score }];
  })) as Record<TradeAsset, { entryAllowed: boolean; score: number }>;
  const scoreTotal = TRADE_ASSETS.reduce((sum, asset) => sum + scores[asset].score, 0);

  const targets = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const current = positions[asset].allocation_pct;
    if (judgment.action.choice === "exit" || judgment.invalidationRisk >= config.cutPositionProbability) return [asset, 0];
    if (judgment.action.choice === "reduce") return [asset, current * 0.5];
    if (!scores[asset].entryAllowed || scoreTotal <= 0) return [asset, Math.min(current, config.maxAssetAllocationPct * 100)];
    const proposed = grossRiskBudgetPct * scores[asset].score / scoreTotal;
    const trancheMultiplier = judgment.regime.choice === "accumulation" && positions[asset].status === "flat" ? 1 / 3 : 1;
    return [asset, Math.min(config.maxAssetAllocationPct * 100, Math.max(current, proposed * trancheMultiplier))];
  })) as Record<TradeAsset, number>;

  const targetTotal = TRADE_ASSETS.reduce((sum, asset) => sum + targets[asset], 0);
  if (targetTotal > grossRiskBudgetPct && targetTotal > 0) {
    const scale = grossRiskBudgetPct / targetTotal;
    for (const asset of TRADE_ASSETS) targets[asset] *= scale;
  }

  return TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const position = positions[asset];
    const current = position.allocation_pct;
    const target = targets[asset];
    const delta = target - current;
    const action: TradeAction = delta >= config.allocationDeadbandPct && scores[asset].entryAllowed
      ? "buy"
      : delta <= -config.allocationDeadbandPct && position.status === "held"
        ? "sell"
        : "hold";
    const setup = selectedSetup(judgment, indicators[asset]);
    const atr = Math.max(indicators[asset].atr_14_pct, 0.1);
    const expectedNetEdgePct = action === "buy"
      ? Math.max(0, judgment.direction.probabilities.up * atr * 1.8 - judgment.direction.probabilities.down * atr)
      : 0;
    return {
      asset,
      action,
      confidence: action === "sell"
        ? Math.max(judgment.action.confidence, judgment.invalidationRisk)
        : judgment.action.confidence,
      probabilities: evidenceProbabilities(judgment, position.status === "held"),
      currentAllocationPct: current,
      targetAllocationPct: target,
      rebalanceDeltaPct: delta,
      selectedSetup: setup,
      entryReadiness: judgment.timing.choice as EntryReadiness,
      expectedNetEdgePct,
      opportunityScore: scores[asset].score,
      grossRiskBudgetPct,
      policyReason: `Model2 rotation action ${judgment.action.choice}; regime ${judgment.regime.choice}; `
        + `plan quality ${judgment.planQuality.score}/4; target ${target.toFixed(2)}% versus current ${current.toFixed(2)}%.`,
      judgments: toJevAssetJudgments(judgment, setup),
    };
  });
}
