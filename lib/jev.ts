import { choice, noul, score, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import { getTradingConfig } from "./config";
import { buildPortfolioDecisions } from "./policy";
import type {
  FeeRate,
  JevAssetJudgments,
  JevPortfolioJudgments,
  JevResponse,
  MacroState,
  MarketIndicatorState,
  OrderHistoryItem,
  PortfolioRiskContext,
  PositionContext,
  SpotBalance,
  TickerPrices,
  TradeAsset,
} from "./types";

export interface JevTradingState {
  observedAt: string;
  blindEpisodeKey?: string;
  executionEnvironment: "testnet" | "demo" | "mainnet";
  marketSource: "bybit-mainnet";
  balances: SpotBalance[];
  prices: TickerPrices;
  openOrders: OrderHistoryItem[];
  indicators: Record<TradeAsset, MarketIndicatorState>;
  positions: Record<TradeAsset, PositionContext>;
  fees: Record<TradeAsset, FeeRate>;
  portfolioRisk: PortfolioRiskContext;
  macro: MacroState | null;
}

function movementPhrase(value: number, atrPct: number) {
  const normalized = value / Math.max(atrPct, 0.01);
  if (normalized >= 1.5) return "rising strongly relative to a typical recent range";
  if (normalized >= 0.45) return "rising moderately relative to a typical recent range";
  if (normalized <= -1.5) return "falling strongly relative to a typical recent range";
  if (normalized <= -0.45) return "falling moderately relative to a typical recent range";
  return "moving little relative to a typical recent range";
}

function momentumPhrase(market: MarketIndicatorState) {
  if (market.rsi_14 >= 70) return "momentum is statistically stretched on the upside";
  if (market.rsi_14 <= 30) return "momentum is statistically stretched on the downside";
  if (market.rsi_14 >= 55) return "momentum leans positive without being extreme";
  if (market.rsi_14 <= 45) return "momentum leans negative without being extreme";
  return "momentum is neutral";
}

function participationPhrase(market: MarketIndicatorState) {
  if (market.volume_zscore_20 >= 1.5) return "traded activity is exceptionally high";
  if (market.volume_zscore_20 >= 0.5) return "traded activity is above normal";
  if (market.volume_zscore_20 <= -1) return "traded activity is unusually light";
  return "traded activity is near normal";
}

function orderFlowPhrase(market: MarketIndicatorState) {
  const hasUsableTradeWindow = market.trade_flow_imbalance !== null
    && market.trade_flow_window_seconds !== null
    && market.trade_flow_window_seconds >= 60;
  const flow = hasUsableTradeWindow ? market.trade_flow_imbalance! : market.orderbook_imbalance;
  const source = hasUsableTradeWindow
    ? "time-covered executable flow"
    : "a single resting-liquidity snapshot, which is secondary evidence";
  if (flow >= 0.2) return `${source} leans strongly toward buyers`;
  if (flow >= 0.07) return `${source} leans toward buyers`;
  if (flow <= -0.2) return `${source} leans strongly toward sellers`;
  if (flow <= -0.07) return `${source} leans toward sellers`;
  return `${source} is balanced`;
}

function costPhrase(market: MarketIndicatorState, fee: FeeRate, estimatedSlippagePct: number) {
  const cost = fee.taker_fee_pct * 2 + market.bid_ask_spread_pct + estimatedSlippagePct * 2;
  const ratio = market.atr_14_pct / Math.max(cost, 0.0001);
  if (ratio >= 5) return "a typical recent range is large relative to estimated round-trip costs";
  if (ratio >= 2.5) return "a typical recent range appears adequate relative to estimated round-trip costs";
  return "estimated round-trip costs are large relative to a typical recent range";
}

function positionPhrase(position: PositionContext) {
  if (position.status === "flat") return "no meaningful asset inventory; staying unchanged means remaining in USDT";
  const size = position.allocation_pct >= 35 ? "large" : position.allocation_pct >= 15 ? "moderate" : "small";
  if (position.unrealized_pnl_pct === null) return `${size} existing exposure with unavailable or incomplete cost basis`;
  if (position.unrealized_pnl_pct >= 3) return `${size} existing exposure with a material unrealized gain`;
  if (position.unrealized_pnl_pct <= -3) return `${size} existing exposure with a material unrealized loss`;
  return `${size} existing exposure trading near its reconstructed cost basis`;
}

function derivativesPhrase(market: MarketIndicatorState) {
  if (market.open_interest_change_4h_pct === null || market.funding_rate_latest_pct === null) {
    return "derivatives context unavailable; judge this asset from spot evidence only";
  }
  const positioning = market.open_interest_change_4h_pct >= 2
    ? "open interest is expanding"
    : market.open_interest_change_4h_pct <= -2
      ? "open interest is contracting"
      : "open interest is broadly stable";
  const funding = market.funding_rate_latest_pct > 0.02
    ? "long positioning is relatively crowded"
    : market.funding_rate_latest_pct < -0.02
      ? "short positioning is relatively crowded"
      : "funding is not extreme";
  return `${positioning}; ${funding}`;
}

function channelPhrase(position: number) {
  if (position > 1) return "above the prior channel high";
  if (position >= 0.85) return "near the upper edge of the prior channel";
  if (position >= 0.6) return "in the upper half of the prior channel";
  if (position >= 0.4) return "near the middle of the prior channel";
  if (position >= 0.15) return "in the lower half of the prior channel";
  if (position >= 0) return "near the lower edge of the prior channel";
  return "below the prior channel low";
}

function volatilityStructurePhrase(market: MarketIndicatorState) {
  if (market.bb_width_percentile_7d <= 0.2) return "volatility is compressed versus the last week";
  if (market.bb_width_percentile_7d >= 0.8) return "volatility is expanded versus the last week";
  return "volatility is near its weekly middle range";
}

export function buildSemanticState(state: JevTradingState) {
  const risk = getTradingConfig();
  return {
    observed_at_utc: state.observedAt,
    mandate: "Rotate a long-only spot portfolio among BTC, ETH, XAUT and residual USDT on a fifteen-minute cadence. Activity is not an objective.",
    execution: state.executionEnvironment === "mainnet"
      ? "real-mainnet account behind deterministic application locks"
      : "isolated demo execution using live mainnet market observations",
    portfolio: {
      drawdown: state.portfolioRisk.current_drawdown_pct >= risk.maxPortfolioDrawdownPct
        ? "the portfolio drawdown buy circuit breaker is active"
        : state.portfolioRisk.current_drawdown_pct >= risk.maxPortfolioDrawdownPct * 0.6
          ? "the portfolio is approaching its drawdown limit"
          : "portfolio drawdown is inside the normal risk budget",
      recent_activity: state.portfolioRisk.completed_orders_24h >= risk.maxCompletedOrders24h
        ? "the completed-order limit is exhausted"
        : "the completed-order limit has remaining capacity",
      reserve_policy: "USDT is the residual risk-free allocation; portfolio targets must preserve the configured cash reserve.",
    },
    macro: state.macro ? {
      quality: state.macro.data_quality,
      policy_regime: state.macro.policy_regime,
      gold_real_yield_regime: state.macro.gold_real_yield_regime,
      ...state.macro.semantic,
      timing: "Daily macro observations are slow regime context, not a new fifteen-minute signal.",
    } : {
      quality: "unavailable",
      timing: "Do not infer a macro view from missing data.",
    },
    assets: Object.fromEntries((Object.keys(state.indicators) as TradeAsset[]).map((asset) => {
      const market = state.indicators[asset];
      const position = state.positions[asset];
      return [asset, {
        instrument: `${asset}/USDT spot`,
        trend: market.regime.replaceAll("_", " "),
        sentiment_cycle: {
          phase: market.mamis_phase.replaceAll("_", " "),
          reliability: market.mamis_confidence >= 0.75 ? "high" : market.mamis_confidence >= 0.6 ? "moderate" : "low",
          evidence: market.mamis_evidence,
        },
        price_action: {
          last_fifteen_minutes: movementPhrase(market.return_15m_pct, market.atr_14_pct),
          last_hour: movementPhrase(market.return_1h_pct, market.atr_14_pct),
          last_four_hours: movementPhrase(market.return_4h_pct, market.atr_14_pct),
          last_day: movementPhrase(market.return_24h_pct, market.atr_14_pct),
          momentum: momentumPhrase(market),
          character: market.trend_efficiency_4h >= 0.65
            ? "the four-hour move is orderly and one-directional"
            : market.trend_efficiency_4h <= 0.3
              ? "the four-hour path is noisy and mean-reverting"
              : "the four-hour path has mixed directional efficiency",
          versus_session_vwap: market.distance_vwap_24h_pct >= market.atr_14_pct
            ? "well above the recent volume-weighted price"
            : market.distance_vwap_24h_pct <= -market.atr_14_pct
              ? "well below the recent volume-weighted price"
              : "near the recent volume-weighted price",
          market_structure: {
            prior_24h_channel: channelPhrase(market.channel_24h_position),
            prior_3d_channel: channelPhrase(market.channel_3d_position),
            prior_7d_channel: channelPhrase(market.channel_7d_position),
            twelve_hour_swings: market.structure_12h,
            volatility_state: volatilityStructurePhrase(market),
            breakout_participation: market.channel_24h_position >= 0.9 && market.volume_ratio_20 >= 1
              ? "an upper-edge test has at least normal participation"
              : market.channel_24h_position >= 0.9
                ? "an upper-edge test lacks normal participation"
                : "price is not testing the upper edge",
            rejection_shape: market.upper_wick_atr > 0.6
              ? "the latest closed candle shows material upper rejection"
              : market.lower_wick_atr > 0.6
                ? "the latest closed candle shows material lower rejection"
                : "the latest closed candle has no dominant rejection wick",
          },
        },
        activity: {
          participation: participationPhrase(market),
          volatility: market.downside_volatility_24h_pct > market.realized_volatility_24h_pct * 0.8
            ? "downside volatility dominates the recent distribution"
            : "downside volatility is not dominant",
        },
        liquidity: {
          order_flow: market.data_provenance?.trade_flow === "unavailable"
            ? "historical trade-flow data is unavailable and must not be inferred"
            : orderFlowPhrase(market),
          depth: market.data_provenance?.orderbook === "historical_proxy"
            ? "historical order-book depth is unavailable; a conservative neutral proxy is used"
            : market.depth_ratio >= 1.4
            ? "visible depth is weighted toward bids"
            : market.depth_ratio <= 0.7
              ? "visible depth is weighted toward asks"
              : "visible bid and ask depth are balanced",
          transaction_cost: costPhrase(market, state.fees[asset], risk.estimatedSlippagePct),
        },
        derivatives: derivativesPhrase(market),
        our_book: {
          position: positionPhrase(position),
          recent_trade: position.minutes_since_last_trade === null
            ? "no recent persisted trade"
            : "a prior persisted trade exists; no time-based cooldown is imposed",
          open_order: state.openOrders.some((order) => order.symbol === market.symbol)
            ? "an open order already exists"
            : "no open order exists",
        },
      }];
    })),
  };
}

function directionQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Judge the most likely executable price direction for ${asset}/USDT over the next one to four fifteen-minute cycles.`, constraints: ["Use only the supplied semantic state.", "Choose unclear when material evidence conflicts.", "Do not treat a sentiment-cycle label as a standalone forecast."] },
    { up: "Evidence coherently favors a higher executable spot price.", down: "Evidence coherently favors a lower executable spot price.", unclear: "The directional evidence is weak, balanced or conflicting." },
  );
}

function regimeQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Classify the executable market regime for ${asset}/USDT now.`, constraints: ["Use multi-timeframe channel, swing, trend-strength and volatility evidence together.", "Treat the deterministic regime label as evidence, not an instruction."] },
    { uptrend: "Persistent higher structure favors trend-following long exposure.", downtrend: "Persistent lower structure favors USDT or a strictly confirmed tactical rebound.", range: "Price is rotating between stable boundaries without persistent direction.", compression: "Volatility is unusually compressed and direction needs breakout confirmation.", transition: "The structure is changing or materially conflicted." },
  );
}

function bestSetupQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Select the single best spot-trading setup for ${asset}/USDT at this decision boundary.`, constraints: ["Select none when no setup has positive, executable evidence.", "Range reversion belongs near a statistically supported lower boundary, not near the upper boundary.", "An upside breakout requires participation and acceptable false-breakout risk.", "Bear rebound is tactical and requires reversal confirmation.", "Select reduce only for held exposure that should move toward USDT."] },
    { trend_pullback: "Buy an orderly pullback inside an intact uptrend.", upside_breakout: "Buy a confirmed break or acceptance above resistance.", range_reversion: "Buy near a supported range low for a move back toward the mean.", bear_rebound: "Buy a confirmed tactical rebound inside a broader downtrend.", reduce: "Reduce existing exposure toward USDT.", none: "No setup is executable now." },
  );
}

function entryReadinessQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Judge entry readiness for the best available ${asset}/USDT setup.`, constraints: ["enter_now requires the currently closed candles to supply confirmation.", "Do not use enter_now merely because price moved."] },
    { enter_now: "The setup is confirmed at this closed-candle boundary.", wait_close: "Another candle close is needed for confirmation.", wait_retest: "A breakout or reversal needs a retest before entry.", no_entry: "There is no acceptable entry." },
  );
}

function followThroughQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Judge whether the currently visible move in ${asset}/USDT is likely to persist.`, constraints: ["Separate persistence from direction.", "Use no_pattern when there is no coherent move to extend or reverse."] },
    { continuation: "The visible move has participation and structure consistent with follow-through.", reversal: "The visible move is extended, exhausted or contradicted and is more likely to reverse.", no_pattern: "There is no sufficiently stable continuation or reversal pattern." },
  );
}

function setupQualityQuestion(asset: TradeAsset) {
  return score(
    { objective: `Score the quality of the directional setup for ${asset}/USDT.`, constraints: ["Score agreement and tradability, not excitement.", "Missing optional derivatives data alone does not make XAUT untradeable.", "In explicitly labeled historical simulation state, missing historical microstructure alone is uncertainty rather than proof of a bad setup; use the supplied conservative cost proxy and participation evidence."] },
    ["No usable setup: evidence conflicts, is stale in meaning, or costs dominate.", "Weak setup: a directional idea exists but lacks confirmation or clean execution conditions.", "Developing setup: structure exists but timing or participation still needs confirmation.", "Coherent setup: independent structure, timing and execution evidence agree.", "Exceptional setup: structure, follow-through, participation and liquidity align without material contradiction."],
  );
}

function falseBreakoutQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Is an upside break or upper-channel test in ${asset}/USDT likely to be a false breakout?`, constraints: ["Use closed-candle acceptance, participation, wick rejection and broader structure.", "Return uncertainty rather than inventing a breakout when price is not testing resistance."] },
    { true: "Breakout failure risk is material.", false: "There is adequate evidence against an immediate false breakout." },
  );
}

function reversalConfirmationQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Is an upward reversal in ${asset}/USDT sufficiently confirmed for a tactical long entry?`, constraints: ["Require more than oversold status.", "Use momentum turn, structure, participation and lower-bound reaction together."] },
    { true: "The reversal has multi-factor confirmation.", false: "The reversal is absent or not confirmed." },
  );
}

function liquidityQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Is ${asset}/USDT liquid enough to change spot exposure now?`, constraints: ["Consider spread, depth, recent flow and cost relative to a typical move.", "When historical provenance explicitly says order-book or trade-flow history is unavailable, do not treat absence alone as illiquidity; judge the conservative spread, turnover, volatility and cost proxy that is supplied."] },
    { true: "Normal-size execution appears feasible.", false: "New exposure should be blocked because execution quality is poor." },
  );
}

function disorderlyQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Is ${asset}/USDT currently disorderly enough that new exposure is unsafe?`, constraints: ["Look for abrupt one-sided movement, abnormal participation, unstable liquidity and conflicting price discovery."] },
    { true: "The market is dislocated or disorderly.", false: "The market is orderly enough for normal deterministic controls." },
  );
}

function cutPositionQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Should an existing ${asset} spot position be materially reduced for capital preservation?`, constraints: ["Return false when the asset is not held.", "A normal pullback alone is not sufficient; require coherent downside or portfolio-risk evidence."] },
    { true: "Existing exposure should be reduced toward USDT.", false: "There is no strong independent need for an immediate material reduction." },
  );
}

function preferredDestinationQuestion() {
  return choice(
    { objective: "Select the best destination for marginal portfolio capital over the next one to four fifteen-minute cycles.", constraints: ["Compare BTC, ETH and XAUT after costs.", "Select USDT when no asset has a sufficiently separated executable opportunity."] },
    { BTC: "BTC has the best executable risk-adjusted setup.", ETH: "ETH has the best executable risk-adjusted setup.", XAUT: "XAUT has the best executable risk-adjusted setup.", USDT: "Cash preservation is preferable to all available asset setups." },
  );
}

function grossRiskBudgetQuestion() {
  return choice(
    { objective: "Choose the appropriate gross long-only spot risk budget for the portfolio now.", constraints: ["This controls total BTC, ETH and XAUT exposure, not trade frequency.", "Use zero in disorderly conditions or when all setups are unqualified."] },
    { zero: "Hold risk capital in USDT.", low: "Use a small tactical exposure budget.", medium: "Use a normal but selective exposure budget.", high: "Use most of the allowed exposure budget because opportunities are broad and coherent." },
  );
}

function opportunitySeparationQuestion() {
  return score(
    { objective: "Score how clearly the best asset opportunity exceeds the alternatives after execution costs.", constraints: ["Score relative separation, not absolute excitement.", "A high score should be rare and supported by independent evidence."] },
    ["No qualified asset opportunity.", "Opportunities are weak or nearly tied.", "One asset has a meaningful advantage.", "One asset has a large, unusually coherent advantage."],
  );
}

export async function evaluateTradingState(state: JevTradingState): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");
  const model = process.env.JEV_MODEL_NAME?.trim() || "jev-1.13.0";
  const client = new TypeSafeClient({ apiKey, defaultModel: model, timeout: 10_000, retry: { maxRetries: 1 }, logLevel: "warn" });
  const questions = {
    btc_regime: regimeQuestion("BTC"), btc_best_setup: bestSetupQuestion("BTC"), btc_entry_readiness: entryReadinessQuestion("BTC"), btc_direction: directionQuestion("BTC"), btc_follow_through: followThroughQuestion("BTC"), btc_setup_quality: setupQualityQuestion("BTC"), btc_false_breakout: falseBreakoutQuestion("BTC"), btc_reversal_confirmation: reversalConfirmationQuestion("BTC"), btc_liquidity_ok: liquidityQuestion("BTC"), btc_disorderly: disorderlyQuestion("BTC"), btc_cut_position: cutPositionQuestion("BTC"),
    eth_regime: regimeQuestion("ETH"), eth_best_setup: bestSetupQuestion("ETH"), eth_entry_readiness: entryReadinessQuestion("ETH"), eth_direction: directionQuestion("ETH"), eth_follow_through: followThroughQuestion("ETH"), eth_setup_quality: setupQualityQuestion("ETH"), eth_false_breakout: falseBreakoutQuestion("ETH"), eth_reversal_confirmation: reversalConfirmationQuestion("ETH"), eth_liquidity_ok: liquidityQuestion("ETH"), eth_disorderly: disorderlyQuestion("ETH"), eth_cut_position: cutPositionQuestion("ETH"),
    xaut_regime: regimeQuestion("XAUT"), xaut_best_setup: bestSetupQuestion("XAUT"), xaut_entry_readiness: entryReadinessQuestion("XAUT"), xaut_direction: directionQuestion("XAUT"), xaut_follow_through: followThroughQuestion("XAUT"), xaut_setup_quality: setupQualityQuestion("XAUT"), xaut_false_breakout: falseBreakoutQuestion("XAUT"), xaut_reversal_confirmation: reversalConfirmationQuestion("XAUT"), xaut_liquidity_ok: liquidityQuestion("XAUT"), xaut_disorderly: disorderlyQuestion("XAUT"), xaut_cut_position: cutPositionQuestion("XAUT"),
    preferred_destination: preferredDestinationQuestion(), gross_risk_budget: grossRiskBudgetQuestion(), opportunity_separation: opportunitySeparationQuestion(),
  } as const;
  const response = await client.systemOne({ model, state: buildSemanticState(state) as unknown as EntryType, questions });
  const answerMap: Record<TradeAsset, JevAssetJudgments> = {
    BTC: {
      regime: { choice: response.answers.btc_regime.choice, confidence: response.answers.btc_regime.confidence, probabilities: { ...response.answers.btc_regime.probabilities } },
      best_setup: { choice: response.answers.btc_best_setup.choice, confidence: response.answers.btc_best_setup.confidence, probabilities: { ...response.answers.btc_best_setup.probabilities } },
      entry_readiness: { choice: response.answers.btc_entry_readiness.choice, confidence: response.answers.btc_entry_readiness.confidence, probabilities: { ...response.answers.btc_entry_readiness.probabilities } },
      direction: { choice: response.answers.btc_direction.choice, confidence: response.answers.btc_direction.confidence, probabilities: { ...response.answers.btc_direction.probabilities } },
      follow_through: { choice: response.answers.btc_follow_through.choice, confidence: response.answers.btc_follow_through.confidence, probabilities: { ...response.answers.btc_follow_through.probabilities } },
      setup_quality: { score: response.answers.btc_setup_quality.score, confidence: response.answers.btc_setup_quality.confidence, probabilities: { ...response.answers.btc_setup_quality.probabilities } },
      false_breakout: response.answers.btc_false_breakout.noul, reversal_confirmation: response.answers.btc_reversal_confirmation.noul,
      liquidity_ok: response.answers.btc_liquidity_ok.noul, disorderly: response.answers.btc_disorderly.noul, cut_position: response.answers.btc_cut_position.noul,
    },
    ETH: {
      regime: { choice: response.answers.eth_regime.choice, confidence: response.answers.eth_regime.confidence, probabilities: { ...response.answers.eth_regime.probabilities } },
      best_setup: { choice: response.answers.eth_best_setup.choice, confidence: response.answers.eth_best_setup.confidence, probabilities: { ...response.answers.eth_best_setup.probabilities } },
      entry_readiness: { choice: response.answers.eth_entry_readiness.choice, confidence: response.answers.eth_entry_readiness.confidence, probabilities: { ...response.answers.eth_entry_readiness.probabilities } },
      direction: { choice: response.answers.eth_direction.choice, confidence: response.answers.eth_direction.confidence, probabilities: { ...response.answers.eth_direction.probabilities } },
      follow_through: { choice: response.answers.eth_follow_through.choice, confidence: response.answers.eth_follow_through.confidence, probabilities: { ...response.answers.eth_follow_through.probabilities } },
      setup_quality: { score: response.answers.eth_setup_quality.score, confidence: response.answers.eth_setup_quality.confidence, probabilities: { ...response.answers.eth_setup_quality.probabilities } },
      false_breakout: response.answers.eth_false_breakout.noul, reversal_confirmation: response.answers.eth_reversal_confirmation.noul,
      liquidity_ok: response.answers.eth_liquidity_ok.noul, disorderly: response.answers.eth_disorderly.noul, cut_position: response.answers.eth_cut_position.noul,
    },
    XAUT: {
      regime: { choice: response.answers.xaut_regime.choice, confidence: response.answers.xaut_regime.confidence, probabilities: { ...response.answers.xaut_regime.probabilities } },
      best_setup: { choice: response.answers.xaut_best_setup.choice, confidence: response.answers.xaut_best_setup.confidence, probabilities: { ...response.answers.xaut_best_setup.probabilities } },
      entry_readiness: { choice: response.answers.xaut_entry_readiness.choice, confidence: response.answers.xaut_entry_readiness.confidence, probabilities: { ...response.answers.xaut_entry_readiness.probabilities } },
      direction: { choice: response.answers.xaut_direction.choice, confidence: response.answers.xaut_direction.confidence, probabilities: { ...response.answers.xaut_direction.probabilities } },
      follow_through: { choice: response.answers.xaut_follow_through.choice, confidence: response.answers.xaut_follow_through.confidence, probabilities: { ...response.answers.xaut_follow_through.probabilities } },
      setup_quality: { score: response.answers.xaut_setup_quality.score, confidence: response.answers.xaut_setup_quality.confidence, probabilities: { ...response.answers.xaut_setup_quality.probabilities } },
      false_breakout: response.answers.xaut_false_breakout.noul, reversal_confirmation: response.answers.xaut_reversal_confirmation.noul,
      liquidity_ok: response.answers.xaut_liquidity_ok.noul, disorderly: response.answers.xaut_disorderly.noul, cut_position: response.answers.xaut_cut_position.noul,
    },
  };
  const portfolioJudgments: JevPortfolioJudgments = {
    preferred_destination: { choice: response.answers.preferred_destination.choice, confidence: response.answers.preferred_destination.confidence, probabilities: { ...response.answers.preferred_destination.probabilities } },
    gross_risk_budget: { choice: response.answers.gross_risk_budget.choice, confidence: response.answers.gross_risk_budget.confidence, probabilities: { ...response.answers.gross_risk_budget.probabilities } },
    opportunity_separation: { score: response.answers.opportunity_separation.score, confidence: response.answers.opportunity_separation.confidence, probabilities: { ...response.answers.opportunity_separation.probabilities } },
  };
  const feePctByAsset = Object.fromEntries((Object.keys(state.fees) as TradeAsset[]).map((asset) => [asset, state.fees[asset].taker_fee_pct])) as Record<TradeAsset, number>;
  const decisions = buildPortfolioDecisions(answerMap, portfolioJudgments, state.indicators, state.positions, state.macro, feePctByAsset, getTradingConfig());
  return { model: response.model, decisions, portfolioJudgments, usage: response.usage };
}
