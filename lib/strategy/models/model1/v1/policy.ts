import type { ModelConfig } from "./config";
import type {
  AssetId,
  DecisionBlocker,
  EntryReadiness,
  JevAssetJudgments,
  JevChoiceJudgment,
  JevDecision,
  JevPortfolioJudgments,
  MacroState,
  MarketIndicatorState,
  PositionContext,
  TradeAction,
  TradeAsset,
  TradingSetup,
} from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import { buildStructuralGeometry, normalizedWallSupport } from "../../../platform/market-geometry";

type TradingConfig = ModelConfig;

interface StatefulOpportunity {
  setup: TradingSetup;
  readiness: EntryReadiness;
  readinessScore: number;
  confidence: number;
  expectedNetEdgePct: number;
  grossExpectedEdgePct: number;
  opportunityScore: number;
  candidate: boolean;
  readyNow: boolean;
  reduce: boolean;
  blockers: DecisionBlocker[];
  diagnostics: NonNullable<JevDecision["diagnostics"]>;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
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

function macroBias(asset: TradeAsset, macro: MacroState | null) {
  if (!macro || macro.data_quality === "unavailable") return 0;
  if (asset === "XAUT") {
    const realYield = macro.series.DFII10?.change_5d_bps ?? 0;
    const inflation = macro.series.T10YIE?.change_5d_bps ?? 0;
    return clamp(
      (macro.gold_real_yield_regime === "supportive" ? 0.45 : macro.gold_real_yield_regime === "restrictive" ? -0.45 : 0)
      + clamp(-realYield / 20, -0.35, 0.35)
      + clamp(inflation / 20, -0.2, 0.2),
      -1,
      1,
    );
  }
  const policy = macro.policy_regime === "easing_shock" ? 0.5
    : macro.policy_regime === "easing" ? 0.25
      : macro.policy_regime === "tightening_shock" ? -0.5
        : macro.policy_regime === "tightening" ? -0.25
          : 0;
  const realYield = macro.series.DFII10?.change_5d_bps ?? 0;
  return clamp(policy + clamp(-realYield / 30, -0.25, 0.25), -1, 1);
}

function leverageBias(market: MarketIndicatorState) {
  if (market.open_interest_change_1h_pct === null && market.funding_rate_latest_pct === null) return 0;
  const oi = market.open_interest_change_1h_pct ?? 0;
  const flowDirection = market.return_1h_pct >= 0 ? 1 : -1;
  const alignedOi = clamp((oi * flowDirection) / 4, -0.5, 0.5);
  const fundingPenalty = market.funding_rate_latest_pct === null
    ? 0
    : clamp(-Math.abs(market.funding_rate_latest_pct) / 0.05, -0.25, 0);
  return clamp(alignedOi + fundingPenalty, -1, 1);
}

function microstructureBias(market: MarketIndicatorState) {
  return clamp(
    normalizedWallSupport(market) * 0.55
      + (market.trade_flow_imbalance ?? 0) * 0.3
      + clamp((market.depth_ratio - 1) / 2, -0.15, 0.15),
    -1,
    1,
  );
}

function setupIsViable(
  setup: TradingSetup,
  market: MarketIndicatorState,
  judgments: JevAssetJudgments,
  nearSupport: boolean,
  breakoutAccepted: boolean,
  config: TradingConfig,
) {
  if (setup === "trend_pullback") {
    return (market.regime === "bull_trend" || judgments.regime.choice === "uptrend")
      && market.last_price > market.ema_200
      && (nearSupport || supportStrength >= 0.45)
      && market.price_zscore_20 <= 1.1;
  }
  if (setup === "upside_breakout") {
    return (breakoutAccepted || market.channel_24h_position >= 0.86)
      && market.volume_ratio_20 >= 0.8
      && judgments.false_breakout < 0.65;
  }
  if (setup === "range_reversion") {
    return (market.regime === "range" || market.regime === "compression" || judgments.regime.choice === "range")
      && nearSupport
      && judgments.reversal_confirmation >= 0.45;
  }
  if (setup === "bear_rebound") {
    return (market.regime === "bear_trend" || judgments.regime.choice === "downtrend")
      && nearSupport
      && market.countertrend_rebound_score >= Math.max(0, config.minBearReboundScore - 0.08)
      && judgments.reversal_confirmation >= 0.5;
  }
  return false;
}

function evaluateOpportunity(
  asset: TradeAsset,
  judgments: JevAssetJudgments,
  market: MarketIndicatorState,
  position: PositionContext,
  feePct: number,
  config: TradingConfig,
  macro: MacroState | null,
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
  const geometry = buildStructuralGeometry(market, feePct, config.estimatedSlippagePct);
  const supportLow = market.support_zone_low ?? market.channel_24h_low;
  const supportHigh = market.support_zone_high ?? market.channel_24h_low;
  const supportStrength = market.support_strength ?? 0.25;
  const resistanceLow = market.resistance_zone_low ?? market.channel_24h_high;
  const resistanceHigh = market.resistance_zone_high ?? market.channel_24h_high;
  const resistanceStrength = market.resistance_strength ?? 0.25;
  const macroScore = macroBias(asset, macro);
  const microScore = microstructureBias(market);
  const leverageScore = leverageBias(market);
  const supportInvalidated = market.last_price < supportLow;
  const resistanceRejection = position.status === "held"
    && geometry.nearResistance
    && !geometry.breakoutAccepted
    && (market.upper_wick_atr >= 0.5 || microScore <= -0.12 || market.macd_hist < 0)
    && (position.unrealized_pnl_pct ?? 0) > geometry.roundTripCostPct;
  const reduce = judgments.cut_position >= config.cutPositionProbability
    || judgments.disorderly >= config.disorderlyProbability
    || setup === "reduce"
    || supportInvalidated
    || resistanceRejection
    || (position.status === "held" && directionEdge <= -config.minDirectionalEdge);

  const diagnosticsBase = {
    roundTripCostPct: geometry.roundTripCostPct,
    atrToCostRatio: geometry.atrToCostRatio,
    targetPrice: geometry.targetPrice,
    invalidationPrice: geometry.invalidationPrice,
    targetDistancePct: geometry.targetDistancePct,
    invalidationDistancePct: geometry.invalidationDistancePct,
    targetToCostRatio: geometry.targetToCostRatio,
    supportZoneLow: supportLow,
    supportZoneHigh: supportHigh,
    supportStrength,
    resistanceZoneLow: resistanceLow,
    resistanceZoneHigh: resistanceHigh,
    resistanceStrength,
    macroBias: macroScore,
    microstructureBias: microScore,
    leverageBias: leverageScore,
  };

  if (reduce) {
    const blockers: DecisionBlocker[] = [];
    if (position.status === "flat") blockers.push("NO_ALLOCATION_INTENT");
    if (judgments.disorderly >= config.disorderlyProbability) blockers.push("DISORDERLY_MARKET");
    if (supportInvalidated || judgments.cut_position >= config.cutPositionProbability) blockers.push("STRUCTURE_REJECTED");
    return {
      setup,
      readiness,
      readinessScore,
      confidence: Math.max(confidence, judgments.cut_position, judgments.disorderly),
      expectedNetEdgePct: 0,
      grossExpectedEdgePct: 0,
      opportunityScore: 0,
      candidate: false,
      readyNow: false,
      reduce: true,
      blockers,
      diagnostics: { ...diagnosticsBase, successProbability: 0, grossExpectedEdgePct: 0 },
    };
  }

  const setupQuality = clamp(judgments.setup_quality.score / 4);
  const patternProbability = setup === "range_reversion" || setup === "bear_rebound"
    ? judgments.reversal_confirmation
    : judgments.follow_through.probabilities.continuation;
  const successProbability = clamp(
    judgments.direction.probabilities.up * 0.42
      + setupQuality * 0.18
      + patternProbability * 0.12
      + judgments.liquidity_ok * 0.08
      + readinessScore * 0.08
      + supportStrength * 0.05
      + microScore * 0.035
      + leverageScore * 0.025
      + macroScore * 0.02
      - (setup === "upside_breakout" ? judgments.false_breakout * 0.1 : 0),
    0.05,
    0.92,
  );
  const reward = geometry.targetDistancePct;
  const risk = geometry.invalidationDistancePct;
  const grossExpectedEdgePct = successProbability * reward - (1 - successProbability) * risk;
  const expectedNetEdgePct = grossExpectedEdgePct - geometry.roundTripCostPct;
  const viableStructure = setupIsViable(setup, market, judgments, geometry.nearSupport, geometry.breakoutAccepted, config);
  const blockers: DecisionBlocker[] = [];
  if (readiness === "no_entry") blockers.push("JEV_NO_ENTRY");
  if (setup === "none" || !viableStructure) blockers.push("STRUCTURE_REJECTED");
  if (directionEdge < config.minDirectionalEdge) blockers.push("DIRECTIONAL_EDGE_LOW");
  if (judgments.setup_quality.score < config.minSetupScore) blockers.push("SETUP_QUALITY_LOW");
  if (geometry.targetDistancePct <= geometry.roundTripCostPct + config.minExpectedNetEdgePct) blockers.push("TARGET_ROOM_LOW");
  if (expectedNetEdgePct < config.minExpectedNetEdgePct) blockers.push("NET_EDGE_LOW");
  if (judgments.liquidity_ok < config.minLiquidityProbability) blockers.push("LIQUIDITY_LOW");
  if (judgments.disorderly >= config.disorderlyProbability) blockers.push("DISORDERLY_MARKET");
  if (microScore <= -0.65 && !geometry.breakoutAccepted) blockers.push("MICROSTRUCTURE_WEAK");
  const fatalBlockers = blockers.length > 0;
  const pendingBlocker = readiness === "wait_close"
    ? "PENDING_CLOSE"
    : readiness === "wait_retest" ? "PENDING_RETEST" : null;
  if (!fatalBlockers && pendingBlocker) blockers.push(pendingBlocker);
  const candidate = !fatalBlockers && readiness !== "no_entry";
  const readyNow = candidate && pendingBlocker === null && readinessScore >= 0.2;
  const opportunityScore = candidate
    ? Math.max(0.0001, successProbability * setupQuality * judgments.liquidity_ok
      * (0.5 + readinessScore) * (1 + Math.max(expectedNetEdgePct, 0) / Math.max(risk, 0.1)))
    : 0;
  return {
    setup,
    readiness,
    readinessScore,
    confidence,
    expectedNetEdgePct,
    grossExpectedEdgePct,
    opportunityScore,
    candidate,
    readyNow,
    reduce: false,
    blockers,
    diagnostics: { ...diagnosticsBase, successProbability, grossExpectedEdgePct },
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
  macro: MacroState | null = null,
): JevDecision[] {
  const availableCashPct = Math.max(0, 100 - TRADE_ASSETS.reduce((sum, asset) => sum + positions[asset].allocation_pct, 0));
  const opportunities = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, evaluateOpportunity(
    asset, judgments[asset], indicators[asset], positions[asset], feePctByAsset[asset], config, macro,
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
    if (action === "hold" && blockers.length === 0) {
      blockers.push(opportunity.reduce || !opportunity.candidate ? "NO_ALLOCATION_INTENT" : "ALLOCATION_DEADBAND");
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
      diagnostics: opportunity.diagnostics,
      policyReason: `Model1 V1 structural policy; target room ${opportunity.diagnostics.targetDistancePct.toFixed(3)}%, `
        + `invalidation risk ${opportunity.diagnostics.invalidationDistancePct.toFixed(3)}%, `
        + `cost ${opportunity.diagnostics.roundTripCostPct.toFixed(3)}%, net edge ${opportunity.expectedNetEdgePct.toFixed(3)}%; `
        + `support ${opportunity.diagnostics.supportStrength.toFixed(2)}, resistance ${opportunity.diagnostics.resistanceStrength.toFixed(2)}, `
        + `micro ${opportunity.diagnostics.microstructureBias.toFixed(2)}, macro ${opportunity.diagnostics.macroBias.toFixed(2)}; `
        + `risk budget ${grossRiskBudgetPct.toFixed(2)}%, target allocation ${target.toFixed(2)}%; `
        + (uniqueBlockers.length ? `blocked by ${uniqueBlockers.join(", ")}.` : "eligible for deterministic execution."),
      judgments: judgments[asset],
    };
  });
}
