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

type TradingConfig = ModelConfig;

interface StatefulOpportunity {
  setup: TradingSetup;
  readiness: EntryReadiness;
  readinessScore: number;
  confidence: number;
  expectedNetEdgePct: number;
  opportunityScore: number;
  candidate: boolean;
  readyNow: boolean;
  reduce: boolean;
  blockers: DecisionBlocker[];
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | undefined, fallback = 0) {
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

function setupIsViable(
  setup: TradingSetup,
  market: MarketIndicatorState,
  judgments: JevAssetJudgments,
  config: TradingConfig,
) {
  const channelPosition = finite(market.channel_24h_position, 0.5);
  if (setup === "trend_pullback") {
    return (market.regime === "bull_trend" || judgments.regime.choice === "uptrend")
      && market.last_price > market.ema_200
      && channelPosition >= 0.1
      && channelPosition <= 0.9
      && market.price_zscore_20 <= 1;
  }
  if (setup === "upside_breakout") {
    return channelPosition >= 0.82
      && market.volume_ratio_20 >= 0.75
      && judgments.false_breakout < 0.65;
  }
  if (setup === "range_reversion") {
    return (market.regime === "range" || judgments.regime.choice === "range")
      && channelPosition <= 0.5
      && market.price_zscore_20 <= -0.2
      && judgments.reversal_confirmation >= 0.45;
  }
  if (setup === "bear_rebound") {
    return (market.regime === "bear_trend" || judgments.regime.choice === "downtrend")
      && market.countertrend_rebound_score >= Math.max(0, config.minBearReboundScore - 0.08)
      && judgments.reversal_confirmation >= 0.5;
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
  const reduce = judgments.cut_position >= config.cutPositionProbability
    || judgments.disorderly >= config.disorderlyProbability
    || setup === "reduce"
    || (position.status === "held" && directionEdge <= -config.minDirectionalEdge);
  if (reduce) {
    return {
      setup,
      readiness,
      readinessScore,
      confidence: Math.max(confidence, judgments.cut_position, judgments.disorderly),
      expectedNetEdgePct: 0,
      opportunityScore: 0,
      candidate: false,
      readyNow: false,
      reduce: true,
      blockers: [],
    };
  }

  const setupQuality = clamp(judgments.setup_quality.score / 4);
  const patternProbability = setup === "range_reversion" || setup === "bear_rebound"
    ? judgments.reversal_confirmation
    : judgments.follow_through.probabilities.continuation;
  const successProbability = clamp(
    judgments.direction.probabilities.up * 0.48
      + setupQuality * 0.2
      + patternProbability * 0.14
      + judgments.liquidity_ok * 0.1
      + readinessScore * 0.08
      - (setup === "upside_breakout" ? judgments.false_breakout * 0.12 : 0),
    0.05,
    0.92,
  );
  const { reward, risk } = rewardAndRiskPct(setup, market);
  const roundTripCost = feePct * 2 + market.bid_ask_spread_pct + config.estimatedSlippagePct * 2;
  const expectedNetEdgePct = successProbability * reward - (1 - successProbability) * risk - roundTripCost;
  const viableStructure = setupIsViable(setup, market, judgments, config);
  const blockers: DecisionBlocker[] = [];
  if (readiness === "no_entry") blockers.push("JEV_NO_ENTRY");
  if (setup === "none" || !viableStructure) blockers.push("STRUCTURE_REJECTED");
  if (directionEdge < config.minDirectionalEdge) blockers.push("DIRECTIONAL_EDGE_LOW");
  if (judgments.setup_quality.score < config.minSetupScore) blockers.push("SETUP_QUALITY_LOW");
  if (expectedNetEdgePct < config.minExpectedNetEdgePct) blockers.push("NET_EDGE_LOW");
  if (judgments.liquidity_ok < config.minLiquidityProbability) blockers.push("LIQUIDITY_LOW");
  if (judgments.disorderly >= config.disorderlyProbability) blockers.push("DISORDERLY_MARKET");
  const fatalBlockers = blockers.length > 0;
  const pendingBlocker = readiness === "wait_close"
    ? "PENDING_CLOSE"
    : readiness === "wait_retest" ? "PENDING_RETEST" : null;
  if (!fatalBlockers && pendingBlocker) blockers.push(pendingBlocker);
  const candidate = !fatalBlockers && readiness !== "no_entry";
  const readyNow = candidate && pendingBlocker === null && readinessScore >= 0.2;
  const opportunityScore = candidate
    ? Math.max(0.0001, successProbability * setupQuality * judgments.liquidity_ok
      * (0.5 + readinessScore) * (1 + expectedNetEdgePct / Math.max(risk, 0.1)))
    : 0;
  return {
    setup,
    readiness,
    readinessScore,
    confidence,
    expectedNetEdgePct,
    opportunityScore,
    candidate,
    readyNow,
    reduce: false,
    blockers,
  };
}

export function buildPortfolioJudgments(
  judgments: Record<TradeAsset, JevAssetJudgments>,
  config: TradingConfig,
): JevPortfolioJudgments {
  const ranked = TRADE_ASSETS.map((asset) => {
    const judgment = judgments[asset];
    const directionEdge = judgment.direction.probabilities.up - judgment.direction.probabilities.down;
    const readinessScore = readinessProbabilityScore(judgment);
    const score = clamp(
      judgment.direction.probabilities.up * 0.28
        + judgment.setup_quality.score / 4 * 0.24
        + readinessScore * 0.2
        + judgment.liquidity_ok * 0.14
        + judgment.follow_through.probabilities.continuation * 0.14
        - judgment.false_breakout * 0.1
        - judgment.disorderly * 0.2
        - judgment.cut_position * 0.25,
    );
    const qualified = judgment.best_setup.choice !== "none"
      && judgment.entry_readiness.choice !== "no_entry"
      && directionEdge >= config.minDirectionalEdge
      && judgment.setup_quality.score >= config.minSetupScore
      && judgment.liquidity_ok >= config.minLiquidityProbability
      && judgment.disorderly < config.disorderlyProbability
      && judgment.cut_position < config.cutPositionProbability
      && readinessScore >= 0.12;
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
  portfolioJudgments: JevPortfolioJudgments,
  indicators: Record<TradeAsset, MarketIndicatorState>,
  positions: Record<TradeAsset, PositionContext>,
  feePctByAsset: Record<TradeAsset, number>,
  config: TradingConfig,
): JevDecision[] {
  const availableCashPct = Math.max(0, 100 - TRADE_ASSETS.reduce((sum, asset) => sum + positions[asset].allocation_pct, 0));
  const opportunities = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, evaluateOpportunity(
    judgments[asset], indicators[asset], positions[asset], feePctByAsset[asset], config,
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
    const firstTranche = config.initialEntryPctOfPortfolio * 100;
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
    if (action === "hold" && blockers.length === 0) blockers.push("ALLOCATION_DEADBAND");
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
      policyReason: `Model1 V1; readiness probability score ${opportunity.readinessScore.toFixed(3)}; `
        + `unified ${portfolioJudgments.gross_risk_budget.choice} risk budget ${grossRiskBudgetPct.toFixed(2)}%; `
        + `target ${target.toFixed(2)}% versus current ${current.toFixed(2)}%; `
        + (uniqueBlockers.length ? `blocked by ${uniqueBlockers.join(", ")}.` : "eligible for deterministic execution."),
      judgments: judgments[asset],
    };
  });
}
