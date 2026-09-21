import type { getTradingConfig } from "./config";
import type {
  EntryReadiness,
  JevAssetJudgments,
  JevDecision,
  JevPortfolioJudgments,
  MacroState,
  MarketIndicatorState,
  PositionContext,
  TradeAction,
  TradeAsset,
  TradingSetup,
} from "./types";
import { TRADE_ASSETS } from "./types";

type TradingConfig = ReturnType<typeof getTradingConfig>;

type Opportunity = {
  setup: TradingSetup;
  readiness: EntryReadiness;
  confidence: number;
  expectedNetEdgePct: number;
  opportunityScore: number;
  eligible: boolean;
  reduce: boolean;
  reason: string;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? value! : fallback;
}

function grossRiskFraction(budget: JevPortfolioJudgments["gross_risk_budget"]["choice"]) {
  return { zero: 0, low: 0.35, medium: 0.7, high: 1 }[budget];
}

function setupStructureGate(
  setup: TradingSetup,
  market: MarketIndicatorState,
  judgments: JevAssetJudgments,
  config: TradingConfig,
) {
  const channelPosition = finite(market.channel_24h_position, 0.5);
  if (setup === "trend_pullback") {
    return (market.regime === "bull_trend" || judgments.regime.choice === "uptrend")
      && market.last_price > market.ema_200
      && channelPosition >= 0.15
      && channelPosition <= 0.82
      && market.price_zscore_20 <= 0.8;
  }
  if (setup === "upside_breakout") {
    return channelPosition >= 0.9
      && market.volume_ratio_20 >= 0.9
      && judgments.false_breakout < 0.5
      && judgments.follow_through.probabilities.continuation >= 0.45;
  }
  if (setup === "range_reversion") {
    return market.regime === "range"
      && channelPosition <= 0.35
      && market.price_zscore_20 <= -0.4
      && judgments.reversal_confirmation >= 0.5;
  }
  if (setup === "bear_rebound") {
    return (market.regime === "bear_trend" || judgments.regime.choice === "downtrend")
      && market.countertrend_rebound_score >= config.minBearReboundScore
      && judgments.reversal_confirmation >= 0.6
      && (market.return_15m_pct > 0 || market.return_1h_pct > 0);
  }
  return false;
}

function rewardAndRiskPct(setup: TradingSetup, market: MarketIndicatorState) {
  const atr = Math.max(finite(market.atr_14_pct, 0.1), 0.1);
  const upsideToPriorHigh = Math.max(0, finite(market.distance_to_24h_high_atr) * atr);
  if (setup === "upside_breakout") return { reward: atr * 2.2, risk: atr * 1.15 };
  if (setup === "range_reversion") return { reward: Math.max(atr, upsideToPriorHigh * 0.55), risk: atr };
  if (setup === "bear_rebound") return { reward: atr * 1.6, risk: atr * 1.1 };
  return { reward: Math.max(atr * 1.4, Math.min(upsideToPriorHigh, atr * 3)), risk: atr * 1.05 };
}

function evaluateOpportunity(
  judgments: JevAssetJudgments,
  market: MarketIndicatorState,
  position: PositionContext,
  feePct: number,
  config: TradingConfig,
): Opportunity {
  const setup = judgments.best_setup.choice;
  const readiness = judgments.entry_readiness.choice;
  const directionEdge = judgments.direction.probabilities.up - judgments.direction.probabilities.down;
  const confidence = clamp((
    judgments.direction.confidence
    + judgments.best_setup.confidence
    + judgments.entry_readiness.confidence
    + judgments.setup_quality.confidence
  ) / 4);
  const reduce = judgments.cut_position >= config.cutPositionProbability
    || judgments.disorderly >= config.disorderlyProbability
    || setup === "reduce"
    || (position.status === "held" && directionEdge <= -config.minDirectionalEdge);

  if (reduce) {
    return {
      setup,
      readiness,
      confidence: Math.max(confidence, judgments.cut_position, judgments.disorderly),
      expectedNetEdgePct: 0,
      opportunityScore: 0,
      eligible: false,
      reduce: true,
      reason: "risk-reduction evidence overrides new-exposure scoring",
    };
  }

  const setupQuality = clamp(judgments.setup_quality.score / 4);
  const patternProbability = setup === "range_reversion" || setup === "bear_rebound"
    ? judgments.reversal_confirmation
    : judgments.follow_through.probabilities.continuation;
  const successProbability = clamp(
    judgments.direction.probabilities.up * 0.5
      + setupQuality * 0.2
      + patternProbability * 0.15
      + judgments.liquidity_ok * 0.1
      + (readiness === "enter_now" ? 0.05 : 0)
      - (setup === "upside_breakout" ? judgments.false_breakout * 0.12 : 0),
    0.05,
    0.92,
  );
  const { reward, risk } = rewardAndRiskPct(setup, market);
  const roundTripCost = feePct * 2 + market.bid_ask_spread_pct + config.estimatedSlippagePct * 2;
  const expectedNetEdgePct = successProbability * reward - (1 - successProbability) * risk - roundTripCost;
  const structureOk = setupStructureGate(setup, market, judgments, config);
  const eligible = setup !== "none"
    && readiness === "enter_now"
    && confidence >= config.minPolicyConfidence
    && directionEdge >= config.minDirectionalEdge
    && judgments.setup_quality.score >= config.minSetupScore
    && judgments.liquidity_ok >= config.minLiquidityProbability
    && structureOk
    && expectedNetEdgePct >= config.minExpectedNetEdgePct;
  const opportunityScore = eligible
    ? Math.max(0.0001, successProbability * setupQuality * judgments.liquidity_ok * (1 + expectedNetEdgePct / Math.max(risk, 0.1)))
    : 0;
  const blockers = [
    readiness !== "enter_now" ? `entry is ${readiness}` : null,
    !structureOk ? "deterministic market-structure gate rejected the setup" : null,
    directionEdge < config.minDirectionalEdge ? "directional edge is too small" : null,
    judgments.setup_quality.score < config.minSetupScore ? "setup quality is too low" : null,
    expectedNetEdgePct < config.minExpectedNetEdgePct ? "estimated net expectancy is not positive enough" : null,
  ].filter(Boolean);
  return {
    setup,
    readiness,
    confidence,
    expectedNetEdgePct,
    opportunityScore,
    eligible,
    reduce: false,
    reason: eligible ? "setup passed structure, timing, liquidity and net-expectancy gates" : blockers.join(", ") || "setup is not executable",
  };
}

function evidenceProbabilities(judgments: JevAssetJudgments, held: boolean): Record<TradeAction, number> {
  const setup = clamp(judgments.setup_quality.score / 4);
  const readiness = judgments.entry_readiness.probabilities.enter_now;
  const buyEvidence = judgments.direction.probabilities.up * (0.25 + setup * 0.55 + readiness * 0.2) * judgments.liquidity_ok;
  const sellEvidence = held
    ? Math.max(judgments.direction.probabilities.down * (0.35 + setup * 0.65), judgments.cut_position)
    : 0;
  const holdEvidence = judgments.direction.probabilities.unclear
    + judgments.entry_readiness.probabilities.wait_close
    + judgments.entry_readiness.probabilities.wait_retest
    + judgments.entry_readiness.probabilities.no_entry
    + (1 - judgments.liquidity_ok) * 0.5;
  const total = buyEvidence + sellEvidence + holdEvidence || 1;
  return { buy: buyEvidence / total, sell: sellEvidence / total, hold: holdEvidence / total };
}

export function buildPortfolioDecisions(
  judgments: Record<TradeAsset, JevAssetJudgments>,
  portfolioJudgments: JevPortfolioJudgments,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
  _macro: MacroState | null,
  feePctByAsset: Record<TradeAsset, number>,
  config: TradingConfig,
): JevDecision[] {
  const opportunities = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, evaluateOpportunity(
    judgments[asset], indicators[asset], positions[asset], feePctByAsset[asset], config,
  )])) as Record<TradeAsset, Opportunity>;
  const maximumInvestedPct = (1 - config.minUsdtReservePct) * 100;
  const preferred = portfolioJudgments.preferred_destination.choice;
  const grossRiskBudgetPct = preferred === "USDT"
    ? 0
    : maximumInvestedPct * grossRiskFraction(portfolioJudgments.gross_risk_budget.choice);
  const separation = portfolioJudgments.opportunity_separation.score;
  const preferredIsEligible = preferred !== "USDT" && opportunities[preferred].eligible;

  const targets = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const opportunity = opportunities[asset];
    let incumbent = opportunity.reduce ? 0 : Math.min(positions[asset].allocation_pct, config.maxAssetAllocationPct * 100);
    if (preferredIsEligible && asset !== preferred && separation >= 2) incumbent *= 0.5;
    return [asset, incumbent];
  })) as Record<TradeAsset, number>;
  const baselineTotal = TRADE_ASSETS.reduce((sum, asset) => sum + targets[asset], 0);
  if (baselineTotal > grossRiskBudgetPct && baselineTotal > 0) {
    const scale = grossRiskBudgetPct / baselineTotal;
    for (const asset of TRADE_ASSETS) targets[asset] *= scale;
  }

  const remainingBudget = Math.max(0, grossRiskBudgetPct - TRADE_ASSETS.reduce((sum, asset) => sum + targets[asset], 0));
  const weights = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const opportunity = opportunities[asset];
    const preferenceMultiplier = asset === preferred ? 1.35 : separation >= 2 ? 0.7 : 1;
    return [asset, opportunity.eligible ? opportunity.opportunityScore * preferenceMultiplier : 0];
  })) as Record<TradeAsset, number>;
  const weightTotal = TRADE_ASSETS.reduce((sum, asset) => sum + weights[asset], 0);
  if (remainingBudget > 0 && weightTotal > 0) {
    for (const asset of TRADE_ASSETS) {
      const cap = config.maxAssetAllocationPct * 100;
      targets[asset] = Math.min(cap, targets[asset] + remainingBudget * weights[asset] / weightTotal);
    }
  }

  return TRADE_ASSETS.map((asset) => {
    const opportunity = opportunities[asset];
    const current = positions[asset].allocation_pct;
    const target = targets[asset];
    const delta = target - current;
    const action: TradeAction = delta >= config.allocationDeadbandPct
      ? "buy"
      : delta <= -config.allocationDeadbandPct && positions[asset].status === "held"
        ? "sell"
        : "hold";
    return {
      asset,
      action,
      confidence: action === "sell" ? Math.max(opportunity.confidence, judgments[asset].cut_position) : opportunity.confidence,
      probabilities: evidenceProbabilities(judgments[asset], positions[asset].status === "held"),
      currentAllocationPct: current,
      targetAllocationPct: target,
      rebalanceDeltaPct: delta,
      selectedSetup: opportunity.setup,
      entryReadiness: opportunity.readiness,
      expectedNetEdgePct: opportunity.expectedNetEdgePct,
      opportunityScore: opportunity.opportunityScore,
      grossRiskBudgetPct,
      policyReason: `${opportunity.reason}; Jev portfolio budget ${portfolioJudgments.gross_risk_budget.choice} (${grossRiskBudgetPct.toFixed(2)}%), preferred destination ${preferred}; target ${target.toFixed(2)}% versus current ${current.toFixed(2)}%.`,
      judgments: judgments[asset],
    };
  });
}
