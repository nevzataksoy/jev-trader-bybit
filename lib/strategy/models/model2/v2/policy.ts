import type { ModelConfig } from "./config";
import type {
  AssetId,
  DecisionBlocker,
  EntryReadiness,
  JevAssetJudgments,
  JevChoiceJudgment,
  JevDecision,
  JevPortfolioJudgments,
  MarketIndicatorState,
  PositionContext,
  TradeAction,
  TradeAsset,
  TradingSetup,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import type { RotationAssetJudgment } from "./normalizer";

type TradingConfig = ModelConfig;

interface StatefulOpportunity {
  setup: TradingSetup;
  readiness: EntryReadiness;
  readinessScore: number;
  confidence: number;
  successProbability: number;
  roundTripCostPct: number;
  targetDistancePct: number;
  rewardDistancePct: number;
  rewardSource: "resistance" | "atr_projection";
  invalidationDistancePct: number;
  rewardRiskRatio: number;
  expectedNetEdgePct: number;
  grossExpectedEdgePct: number;
  opportunityScore: number;
  candidate: boolean;
  pendingEligible: boolean;
  readyNow: boolean;
  reduce: boolean;
  blockers: DecisionBlocker[];
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value) ? value! : fallback;
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

export function readinessProbabilityScore(judgment: JevAssetJudgments) {
  const probabilities = judgment.entry_readiness.probabilities;
  return clamp(
    probabilities.enter_now
      + probabilities.wait_close * 0.55
      + probabilities.wait_retest * 0.35
      - probabilities.no_entry * 0.75,
  );
}

export function unifiedRiskFraction(choice: JevPortfolioJudgments["gross_risk_budget"]["choice"]) {
  return { zero: 0, low: 0.25, medium: 0.5, high: 0.8 }[choice];
}

function supportProximityLimit(market: MarketIndicatorState) {
  const atr = Math.max(finite(market.atr_14_pct, 0.1), 0.05);
  return Math.max(atr * 1.5, 0.12);
}

function setupIsViable(
  setup: TradingSetup,
  market: MarketIndicatorState,
  judgments: JevAssetJudgments,
  config: TradingConfig,
) {
  const channelPosition = finite(market.channel_24h_position, 0.5);
  const supportDistance = finite(market.distance_to_support_pct, Number.POSITIVE_INFINITY);
  const supportStrength = finite(market.support_strength, 0.5);
  if (setup === "trend_pullback") {
    return (market.regime === "bull_trend" || judgments.regime.choice === "uptrend")
      && market.last_price > market.ema_200
      && channelPosition >= 0.08
      && channelPosition <= 0.92
      && market.price_zscore_20 <= 1
      && supportDistance <= supportProximityLimit(market)
      && supportStrength >= 0.15;
  }
  if (setup === "upside_breakout") {
    return channelPosition >= 0.82
      && market.volume_ratio_20 >= 0.75
      && judgments.false_breakout < 0.65
      && (market.trade_flow_imbalance ?? 0) >= -0.2;
  }
  if (setup === "range_reversion") {
    return (market.regime === "range" || judgments.regime.choice === "range")
      && channelPosition <= 0.55
      && market.price_zscore_20 <= -0.15
      && judgments.reversal_confirmation >= 0.45
      && supportDistance <= supportProximityLimit(market);
  }
  if (setup === "bear_rebound") {
    return (market.regime === "bear_trend" || judgments.regime.choice === "downtrend")
      && market.countertrend_rebound_score >= Math.max(0, config.minBearReboundScore - 0.08)
      && judgments.reversal_confirmation >= 0.5
      && supportDistance <= supportProximityLimit(market);
  }
  return false;
}

function structuralRewardRisk(market: MarketIndicatorState, setup: TradingSetup) {
  const atr = Math.max(finite(market.atr_14_pct, 0.1), 0.05);
  const targetDistance = finite(market.distance_to_resistance_pct, 0);
  const supportLow = finite(market.support_zone_low, 0);
  const invalidationDistance = supportLow > 0 && market.last_price > 0
    ? Math.max(atr * 0.55, (market.last_price - supportLow) / market.last_price * 100)
    : atr * (setup === "upside_breakout" ? 1.15 : 1.05);
  const projectedReward = atr * 2.2;
  const useAtrProjection = setup === "upside_breakout" && targetDistance <= 0;
  const reward = useAtrProjection ? projectedReward : targetDistance;
  return {
    reward,
    rewardSource: useAtrProjection ? "atr_projection" as const : "resistance" as const,
    risk: invalidationDistance,
    targetDistance,
    invalidationDistance,
    rewardRiskRatio: reward / Math.max(invalidationDistance, 0.0001),
  };
}

function microstructureAdjustment(market: MarketIndicatorState) {
  const wallBias = finite(market.bid_wall_strength) - finite(market.ask_wall_strength);
  const wallPersistence = clamp(
    (finite(market.bid_wall_persistence) - finite(market.ask_wall_persistence)) / 8,
    -1,
    1,
  );
  const flow = clamp(finite(market.trade_flow_imbalance), -1, 1);
  const squeeze = clamp(finite(market.short_squeeze_risk) - finite(market.long_squeeze_risk), -1, 1);
  return wallBias * 0.035 + wallPersistence * 0.02 + flow * 0.035 + squeeze * 0.025;
}

function resistanceExitSignal(market: MarketIndicatorState, position: PositionContext, exitCostPct: number) {
  if (position.status !== "held") return false;
  const profitableAfterExit = (position.unrealized_pnl_pct ?? Number.NEGATIVE_INFINITY) > exitCostPct;
  if (!profitableAfterExit) return false;
  const resistanceDistance = finite(market.distance_to_resistance_pct, Number.POSITIVE_INFINITY);
  const nearResistance = resistanceDistance <= Math.max(finite(market.atr_14_pct, 0.1) * 0.35, 0.08);
  const rejection = market.upper_wick_atr >= 0.35
    || (market.trade_flow_imbalance ?? 0) <= -0.12
    || finite(market.ask_wall_strength) - finite(market.bid_wall_strength) >= 0.18
    || market.macd_hist < 0;
  const acceptedBreakout = market.breakout_24h_pct > 0
    && market.return_15m_pct >= 0
    && market.volume_ratio_20 >= 1
    && (market.trade_flow_imbalance ?? 0) >= 0;
  return nearResistance && rejection && !acceptedBreakout;
}

function evaluateOpportunity(
  judgments: JevAssetJudgments,
  rotation: RotationAssetJudgment,
  market: MarketIndicatorState,
  position: PositionContext,
  feePct: number,
  config: TradingConfig,
): StatefulOpportunity {
  const setup = judgments.best_setup.choice;
  const readiness = judgments.entry_readiness.choice;
  const readinessScore = readinessProbabilityScore(judgments);
  const directionEdge = judgments.direction.probabilities.up - judgments.direction.probabilities.down;
  const confidence = clamp((
    judgments.direction.confidence
      + judgments.best_setup.confidence
      + judgments.entry_readiness.confidence
      + judgments.setup_quality.confidence
  ) / 4);
  const roundTripCostPct = feePct * 2 + market.bid_ask_spread_pct + config.estimatedSlippagePct * 2;
  const exitCostPct = feePct + market.bid_ask_spread_pct / 2 + config.estimatedSlippagePct;
  const structuralExit = resistanceExitSignal(market, position, exitCostPct);
  const reduce = rotation.action.choice === "reduce"
    || rotation.action.choice === "exit"
    || judgments.cut_position >= config.cutPositionProbability
    || judgments.disorderly >= config.disorderlyProbability
    || setup === "reduce"
    || structuralExit
    || (position.status === "held" && directionEdge <= -config.minDirectionalEdge);

  const { reward, rewardSource, risk, targetDistance, invalidationDistance, rewardRiskRatio } = structuralRewardRisk(market, setup);
  if (reduce) {
    return {
      setup,
      readiness,
      readinessScore,
      confidence: Math.max(confidence, judgments.cut_position, judgments.disorderly),
      successProbability: 0,
      roundTripCostPct,
      targetDistancePct: targetDistance,
      rewardDistancePct: reward,
      rewardSource,
      invalidationDistancePct: invalidationDistance,
      rewardRiskRatio,
      expectedNetEdgePct: 0,
      grossExpectedEdgePct: 0,
      opportunityScore: 0,
      candidate: false,
      pendingEligible: false,
      readyNow: false,
      reduce: true,
      blockers: [],
    };
  }

  const setupQuality = clamp(judgments.setup_quality.score / 4);
  const patternProbability = setup === "range_reversion" || setup === "bear_rebound"
    ? judgments.reversal_confirmation
    : judgments.follow_through.probabilities.continuation;
  const supportStrength = finite(market.support_strength, 0.5);
  const successProbability = clamp(
    judgments.direction.probabilities.up * 0.43
      + setupQuality * 0.18
      + patternProbability * 0.13
      + judgments.liquidity_ok * 0.09
      + readinessScore * 0.07
      + supportStrength * 0.05
      + microstructureAdjustment(market)
      - (setup === "upside_breakout" ? judgments.false_breakout * 0.10 : 0),
    0.05,
    0.92,
  );
  const grossExpectedEdgePct = successProbability * reward - (1 - successProbability) * risk;
  const expectedNetEdgePct = grossExpectedEdgePct - roundTripCostPct;
  const structuralNetRoomPct = reward - roundTripCostPct;
  const viableStructure = setupIsViable(setup, market, judgments, config);
  const blockers: DecisionBlocker[] = [];
  if (readiness === "no_entry") blockers.push("JEV_NO_ENTRY");
  if (setup === "none" || !viableStructure) blockers.push("STRUCTURE_REJECTED");
  if (directionEdge < config.minDirectionalEdge) blockers.push("DIRECTIONAL_EDGE_LOW");
  if (judgments.setup_quality.score < config.minSetupScore) blockers.push("SETUP_QUALITY_LOW");
  if (setup !== "none" && structuralNetRoomPct < config.minExpectedNetEdgePct) blockers.push("TARGET_ROOM_LOW");
  if (expectedNetEdgePct < config.minExpectedNetEdgePct) blockers.push("NET_EDGE_LOW");
  if (judgments.liquidity_ok < config.minLiquidityProbability) blockers.push("LIQUIDITY_LOW");
  if (judgments.disorderly >= config.disorderlyProbability) blockers.push("DISORDERLY_MARKET");

  const pendingBlocker: DecisionBlocker | null = readiness === "wait_close"
    ? "PENDING_CLOSE"
    : readiness === "wait_retest" ? "PENDING_RETEST" : null;
  const hardBlockers = blockers.filter((blocker) => blocker !== "NET_EDGE_LOW");
  const rotationCanAllocate = rotation.action.choice === "enter"
    || rotation.action.choice === "increase"
    || rotation.action.choice === "watch";
  const economicsExecutable = expectedNetEdgePct >= config.minExpectedNetEdgePct
    && structuralNetRoomPct >= config.minExpectedNetEdgePct;
  const pendingEligible = rotation.action.choice === "watch"
    && pendingBlocker !== null
    && hardBlockers.length === 0
    && grossExpectedEdgePct > 0;

  if (pendingEligible && pendingBlocker) blockers.push(pendingBlocker);

  const candidate = rotationCanAllocate
    && hardBlockers.length === 0
    && economicsExecutable
    && readiness !== "no_entry";
  const readyNow = candidate
    && (rotation.action.choice === "enter" || rotation.action.choice === "increase")
    && readiness === "enter_now"
    && readinessScore >= 0.2;
  const opportunityScore = candidate || pendingEligible
    ? Math.max(0.0001, successProbability * setupQuality * judgments.liquidity_ok
      * (0.5 + readinessScore) * Math.min(2, Math.max(0.5, rewardRiskRatio))
      * (1 + Math.max(expectedNetEdgePct, 0) / Math.max(risk, 0.1)))
    : 0;

  return {
    setup,
    readiness,
    readinessScore,
    confidence,
    successProbability,
    roundTripCostPct,
    targetDistancePct: targetDistance,
    rewardDistancePct: reward,
    rewardSource,
    invalidationDistancePct: invalidationDistance,
    rewardRiskRatio,
    expectedNetEdgePct,
    grossExpectedEdgePct,
    opportunityScore,
    candidate,
    pendingEligible,
    readyNow,
    reduce: false,
    blockers,
  };
}

function evidenceProbabilities(judgments: JevAssetJudgments, held: boolean): Record<TradeAction, number> {
  const setup = clamp(judgments.setup_quality.score / 4);
  const readiness = readinessProbabilityScore(judgments);
  const buyEvidence = judgments.direction.probabilities.up * (0.25 + setup * 0.5 + readiness * 0.25) * judgments.liquidity_ok;
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

export function buildDecisions(
  judgments: Record<TradeAsset, JevAssetJudgments>,
  rotationJudgments: Record<TradeAsset, RotationAssetJudgment>,
  portfolioJudgments: JevPortfolioJudgments,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
  feePctByAsset: Record<TradeAsset, number>,
  config: TradingConfig,
): JevDecision[] {
  const availableCashPct = Math.max(0, 100 - TRADE_ASSETS.reduce((sum, asset) => sum + positions[asset].allocation_pct, 0));
  const opportunities = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, evaluateOpportunity(
    judgments[asset], rotationJudgments[asset], indicators[asset], positions[asset], feePctByAsset[asset], config,
  )])) as Record<TradeAsset, StatefulOpportunity>;
  const maximumInvestedPct = (1 - config.minUsdtReservePct) * 100;
  const preferred = portfolioJudgments.preferred_destination.choice;
  const grossRiskBudgetPct = preferred === "USDT"
    ? 0
    : Math.min(maximumInvestedPct, unifiedRiskFraction(portfolioJudgments.gross_risk_budget.choice) * 100);
  const separation = portfolioJudgments.opportunity_separation.score;

  const targets = Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const opportunity = opportunities[asset];
    const current = Math.min(positions[asset].allocation_pct, config.maxAssetAllocationPct * 100);
    if (opportunity.reduce) return [asset, current * (1 - config.sellPctOfHolding)];
    if (!opportunity.candidate) return [asset, current];
    const strong = rotationJudgments[asset].suitability.choice === "strong"
      && judgments[asset].setup_quality.score >= 3
      && opportunity.confidence >= 0.75
      && judgments[asset].liquidity_ok >= 0.75
      && opportunity.rewardRiskRatio >= 1.5;
    const firstTranche = (strong
      ? config.strongInitialEntryPctOfPortfolio
      : config.initialEntryPctOfPortfolio) * 100;
    const preferenceMultiplier = asset === preferred ? 1 : separation >= 2 ? 0.75 : 0.9;
    const volatilityScale = Math.min(
      1,
      config.targetDailyVolatilityPct / Math.max(indicators[asset].realized_volatility_24h_pct, 0.1),
    );
    const cashCapPct = positions[asset].status === "held"
      ? availableCashPct * config.buyPctOfUsdt
      : firstTranche;
    const desiredIncrease = Math.min(firstTranche * preferenceMultiplier, cashCapPct) * volatilityScale;
    return [asset, Math.min(config.maxAssetAllocationPct * 100, Math.max(current, current + desiredIncrease))];
  })) as Record<TradeAsset, number>;

  const targetTotal = TRADE_ASSETS.reduce((sum, asset) => sum + targets[asset], 0);
  if (targetTotal > grossRiskBudgetPct && targetTotal > 0) {
    const scale = grossRiskBudgetPct / targetTotal;
    for (const asset of TRADE_ASSETS) targets[asset] *= scale;
  }

  return TRADE_ASSETS.map((asset) => {
    const opportunity = opportunities[asset];
    const rotation = rotationJudgments[asset];
    const position = positions[asset];
    const current = position.allocation_pct;
    const target = targets[asset];
    const delta = target - current;
    const blockers = [...opportunity.blockers];
    if (!opportunity.reduce && opportunity.candidate && grossRiskBudgetPct <= 0) blockers.push("RISK_BUDGET_ZERO");
    const action: TradeAction = opportunity.reduce && position.status === "held"
      ? "sell"
      : opportunity.readyNow && delta >= config.allocationDeadbandPct && grossRiskBudgetPct > 0
        ? "buy"
        : "hold";
    if (action === "hold" && blockers.length === 0) {
      blockers.push(
        opportunity.reduce || (rotation.action.choice === "hold" && !opportunity.candidate)
          ? "NO_ALLOCATION_INTENT"
          : "ALLOCATION_DEADBAND",
      );
    }
    const uniqueBlockers = [...new Set(blockers)];
    const state = uniqueBlockers.includes("PENDING_CLOSE") || uniqueBlockers.includes("PENDING_RETEST")
      ? "pending"
      : "none";
    return {
      asset,
      action,
      confidence: action === "sell"
        ? Math.max(opportunity.confidence, judgments[asset].cut_position)
        : opportunity.confidence,
      probabilities: evidenceProbabilities(judgments[asset], position.status === "held"),
      currentAllocationPct: current,
      targetAllocationPct: target,
      rebalanceDeltaPct: delta,
      selectedSetup: opportunity.setup,
      entryReadiness: opportunity.readiness,
      expectedNetEdgePct: opportunity.expectedNetEdgePct,
      opportunityScore: opportunity.opportunityScore,
      grossRiskBudgetPct,
      readinessScore: opportunity.readinessScore,
      signalState: state,
      blockedBy: uniqueBlockers,
      grossExpectedEdgePct: opportunity.grossExpectedEdgePct,
      successProbability: opportunity.successProbability,
      roundTripCostPct: opportunity.roundTripCostPct,
      targetDistancePct: opportunity.targetDistancePct,
      rewardDistancePct: opportunity.rewardDistancePct,
      rewardSource: opportunity.rewardSource,
      invalidationDistancePct: opportunity.invalidationDistancePct,
      rewardRiskRatio: opportunity.rewardRiskRatio,
      policyReason: `Model2 V2 rotation action ${rotation.action.choice}, suitability ${rotation.suitability.choice}; `
        + `support→resistance room ${opportunity.targetDistancePct.toFixed(3)}%, reward ${opportunity.rewardDistancePct.toFixed(3)}% via ${opportunity.rewardSource}, invalidation distance ${opportunity.invalidationDistancePct.toFixed(3)}%, R:R ${opportunity.rewardRiskRatio.toFixed(2)}; `
        + `gross edge ${opportunity.grossExpectedEdgePct.toFixed(3)}%, round-trip cost ${opportunity.roundTripCostPct.toFixed(3)}%, net edge ${opportunity.expectedNetEdgePct.toFixed(3)}%; `
        + `native ${portfolioJudgments.gross_risk_budget.choice} risk budget ${grossRiskBudgetPct.toFixed(2)}%; target ${target.toFixed(2)}% versus current ${current.toFixed(2)}%; `
        + (uniqueBlockers.length ? `blocked by ${uniqueBlockers.join(", ")}.` : "eligible for deterministic execution."),
      judgments: judgments[asset],
      rotationAction: rotation.action.choice,
      rotationSuitability: rotation.suitability.choice,
      rotationThesisHealth: rotation.thesisHealth.choice,
    };
  });
}
