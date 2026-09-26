export const ASSET_IDS = ["USDT", "BTC", "ETH", "XAUT"] as const;
export const TRADE_ASSETS = ["BTC", "ETH", "XAUT"] as const;

export type Language = "tr" | "en";
export type AssetId = (typeof ASSET_IDS)[number];
export type TradeAsset = (typeof TRADE_ASSETS)[number];
export type TradeAction = "buy" | "sell" | "hold";
export type MarketRegime = "bull_trend" | "bear_trend" | "range" | "compression" | "transition";
export type TradingSetup =
  | "trend_pullback"
  | "upside_breakout"
  | "range_reversion"
  | "bear_rebound"
  | "reduce"
  | "none";
export type EntryReadiness = "enter_now" | "wait_close" | "wait_retest" | "no_entry";
export type DecisionBlocker =
  | "JEV_NO_ENTRY"
  | "PENDING_CLOSE"
  | "PENDING_RETEST"
  | "STRUCTURE_REJECTED"
  | "DIRECTIONAL_EDGE_LOW"
  | "SETUP_QUALITY_LOW"
  | "NET_EDGE_LOW"
  | "LIQUIDITY_LOW"
  | "DISORDERLY_MARKET"
  | "THESIS_INVALIDATED"
  | "RISK_BUDGET_ZERO"
  | "CONFIDENCE_BELOW_EXECUTION"
  | "USDT_RESERVE"
  | "ASSET_ALLOCATION_CAP"
  | "ALLOCATION_DEADBAND"
  | "NO_ALLOCATION_INTENT"
  | "TARGET_ROOM_LOW"
  | "MAX_BUYS_PER_CYCLE"
  | "STALE_DATA";
export type DecisionSignalState = "none" | "pending" | "confirmed" | "expired" | "invalidated";
export type MamisPhase =
  | "returning_confidence"
  | "buy_the_dip"
  | "enthusiasm"
  | "disbelief"
  | "panic"
  | "discouragement"
  | "wall_of_worry"
  | "anxiety"
  | "aversion"
  | "denial"
  | "uncertain";
export type MacroSeriesId = "DGS1" | "DGS2" | "DGS10" | "DFII10" | "T10YIE";

export interface SpotBalance {
  coin: AssetId;
  free: number;
  locked: number;
  total: number;
  usdtValue: number;
}

export type TickerPrices = Record<AssetId, number>;

export interface MarketIndicatorState {
  symbol: string;
  source: "bybit-mainnet";
  collected_at: string;
  observed_at: string;
  ticker_at: string;
  orderbook_at: string;
  last_closed_15m_at: string;
  last_price: number;
  change_24h_pct: number;
  turnover_24h_usdt: number;
  return_15m_pct: number;
  return_1h_pct: number;
  return_4h_pct: number;
  return_24h_pct: number;
  return_7d_pct: number;
  return_30d_pct: number;
  relative_strength_vs_btc_24h_pct: number;
  ema_9: number;
  ema_21: number;
  ema_50: number;
  ema_200: number;
  ema_50_slope_3h_pct: number;
  rsi_14: number;
  atr_14: number;
  atr_14_pct: number;
  atr_15m_percentile?: number;
  atr_1h_pct?: number;
  atr_1h_percentile?: number;
  atr_4h_pct?: number;
  atr_4h_percentile?: number;
  bb_upper: number;
  bb_lower: number;
  bb_width_pct: number;
  bb_position: number;
  macd_hist: number;
  realized_volatility_24h_pct: number;
  downside_volatility_24h_pct: number;
  volume_ratio_20: number;
  volume_zscore_20: number;
  price_zscore_20: number;
  distance_vwap_24h_pct: number;
  trend_efficiency_4h: number;
  up_fraction_4h: number;
  return_streak_15m: number;
  drawdown_20d_pct: number;
  channel_24h_high: number;
  channel_24h_low: number;
  channel_24h_position: number;
  channel_3d_high: number;
  channel_3d_low: number;
  channel_3d_position: number;
  channel_7d_high: number;
  channel_7d_low: number;
  channel_7d_position: number;
  support_zone_low?: number;
  support_zone_high?: number;
  support_strength?: number;
  resistance_zone_low?: number;
  resistance_zone_high?: number;
  resistance_strength?: number;
  distance_to_support_pct?: number;
  distance_to_resistance_pct?: number;
  distance_to_24h_high_atr: number;
  distance_to_24h_low_atr: number;
  breakout_24h_pct: number;
  bb_width_percentile_7d: number;
  candle_body_atr: number;
  upper_wick_atr: number;
  lower_wick_atr: number;
  structure_12h: "higher" | "lower" | "mixed";
  adx_14: number;
  plus_di_14: number;
  minus_di_14: number;
  trend_score: number;
  regime: MarketRegime;
  countertrend_rebound_score: number;
  bid_ask_spread_pct: number;
  orderbook_imbalance: number;
  bid_depth_50_usdt: number;
  ask_depth_50_usdt: number;
  depth_ratio: number;
  bid_wall_price?: number;
  ask_wall_price?: number;
  bid_wall_distance_pct?: number;
  ask_wall_distance_pct?: number;
  bid_wall_strength?: number;
  ask_wall_strength?: number;
  bid_wall_persistence?: number;
  ask_wall_persistence?: number;
  taker_buy_ratio: number | null;
  trade_flow_imbalance: number | null;
  trade_flow_window_seconds: number | null;
  open_interest_usdt_estimate: number | null;
  open_interest_change_1h_pct: number | null;
  open_interest_change_4h_pct: number | null;
  funding_rate_latest_pct: number | null;
  long_squeeze_risk?: number;
  short_squeeze_risk?: number;
  data_quality: "complete" | "spot_only";
  mamis_phase: MamisPhase;
  mamis_confidence: number;
  mamis_evidence: string[];
  data_provenance?: {
    candles: "live" | "historical_exact";
    ticker: "live" | "historical_derived";
    orderbook: "live" | "historical_proxy";
    trade_flow: "live" | "historical_exact" | "unavailable";
    derivatives: "live" | "historical_derived" | "unavailable";
  };
}

export interface MacroSeriesObservation {
  value_pct: number;
  observed_at: string;
  change_1d_bps: number | null;
  change_5d_bps: number | null;
  change_zscore_60d: number | null;
}

export interface MacroState {
  source: "fred";
  collected_at: string;
  source_observed_at: string | null;
  data_quality: "complete" | "partial" | "stale" | "unavailable";
  series: Record<MacroSeriesId, MacroSeriesObservation | null>;
  curve: {
    slope_10y_2y_bps: number | null;
    slope_2y_1y_bps: number | null;
  };
  policy_regime: "tightening_shock" | "easing_shock" | "tightening" | "easing" | "stable" | "unknown";
  gold_real_yield_regime: "supportive" | "restrictive" | "neutral" | "unknown";
  semantic: {
    front_end: string;
    long_end: string;
    curve: string;
    real_yield: string;
    inflation_expectations: string;
  };
  error: string | null;
}

export interface PositionContext {
  asset: TradeAsset;
  status: "flat" | "held";
  quantity: number;
  value_usdt: number;
  allocation_pct: number;
  average_entry_price: number | null;
  unrealized_pnl_pct: number | null;
  cost_basis_quality: "complete" | "partial" | "unavailable";
  last_trade_action: "buy" | "sell" | null;
  last_trade_at: string | null;
  minutes_since_last_trade: number | null;
}

export interface FeeRate {
  symbol: string;
  maker_fee_pct: number;
  taker_fee_pct: number;
}

export interface PortfolioRiskContext {
  window_hours: 24;
  starting_equity_usdt: number | null;
  peak_equity_usdt: number | null;
  current_drawdown_pct: number;
  completed_orders_24h: number;
}

export interface DecisionContextSnapshot {
  positions: Record<TradeAsset, PositionContext>;
  fees: Record<TradeAsset, FeeRate>;
  portfolioRisk: PortfolioRiskContext;
  macro: MacroState | null;
  portfolioJudgments?: JevPortfolioJudgments;
}

export interface JevChoiceJudgment<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

export interface JevAssetJudgments {
  regime: JevChoiceJudgment<"uptrend" | "downtrend" | "range" | "compression" | "transition">;
  best_setup: JevChoiceJudgment<TradingSetup>;
  entry_readiness: JevChoiceJudgment<EntryReadiness>;
  direction: JevChoiceJudgment<"up" | "down" | "unclear">;
  follow_through: JevChoiceJudgment<"continuation" | "reversal" | "no_pattern">;
  setup_quality: {
    score: number;
    confidence: number;
    probabilities: Record<string, number>;
  };
  false_breakout: number;
  reversal_confirmation: number;
  liquidity_ok: number;
  disorderly: number;
  cut_position: number;
}

export interface JevPortfolioJudgments {
  preferred_destination: JevChoiceJudgment<AssetId>;
  gross_risk_budget: JevChoiceJudgment<"zero" | "low" | "medium" | "high">;
  opportunity_separation: {
    score: number;
    confidence: number;
    probabilities: Record<string, number>;
  };
}

export type CandidatePlanLocation =
  | "inside_support"
  | "near_support"
  | "between_levels"
  | "inside_resistance"
  | "unstructured";

export interface CandidateTradePlan {
  status: "available" | "unavailable";
  location: CandidatePlanLocation;
  supportDistancePct: number;
  supportStrength: number;
  resistanceDistancePct: number;
  resistanceStrength: number;
  invalidationDistancePct: number;
  target1DistancePct: number;
  target1AfterCostRoomPct: number;
  target1RewardRiskRatio: number;
  roundTripCostPct: number;
}

export interface ShadowProbabilityForecast {
  status: "uncalibrated_shadow";
  methodRevision: "shadow-probability-r1";
  horizonMinutes: 240;
  target1BeforeInvalidation: number;
  invalidationBeforeTarget1: number;
  timeout: number;
  target1BreakConditional: number;
  expectedNetReturnPct: number;
  executionAuthoritative: false;
}

export interface JevDecision {
  asset: TradeAsset;
  action: TradeAction;
  confidence: number;
  probabilities: Record<TradeAction, number>;
  currentAllocationPct: number;
  targetAllocationPct: number;
  rebalanceDeltaPct: number;
  selectedSetup: TradingSetup;
  entryReadiness: EntryReadiness;
  expectedNetEdgePct: number;
  opportunityScore: number;
  grossRiskBudgetPct: number;
  policyReason: string;
  blockedBy?: DecisionBlocker[];
  diagnostics?: DecisionBlocker[];
  candidatePlan?: CandidateTradePlan;
  shadowForecast?: ShadowProbabilityForecast;
  readinessScore?: number;
  signalState?: DecisionSignalState;
  grossExpectedEdgePct?: number;
  successProbability?: number;
  roundTripCostPct?: number;
  targetDistancePct?: number;
  rewardDistancePct?: number;
  rewardSource?: "resistance" | "atr_projection";
  invalidationDistancePct?: number;
  rewardRiskRatio?: number;
  rotationAction?: string;
  rotationSuitability?: string;
  rotationThesisHealth?: string;
  judgments: JevAssetJudgments;
}

export interface JevResponse {
  model: string;
  decisions: JevDecision[];
  portfolioJudgments: JevPortfolioJudgments;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface PortfolioSnapshot {
  capturedAt: string;
  totalPortfolioUsdt: number;
  balances: SpotBalance[];
  prices: TickerPrices;
}

export interface DailyPortfolioPoint {
  date: string;
  capturedAt: string;
  totalPortfolioUsdt: number;
  prices: TickerPrices;
}

export interface OrderHistoryItem {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: "Buy" | "Sell";
  orderType: string;
  qty: string;
  price: string;
  avgPrice: string;
  cumExecQty: string;
  cumExecValue: string;
  fee: string;
  feeCurrency: string;
  orderStatus: string;
  createdTime: string;
  updatedTime: string;
  executedTime: string | null;
  isOpen: boolean;
}

export interface BotExecutionResult {
  engineId?: string;
  asset: TradeAsset;
  symbol: string;
  action: TradeAction;
  status: "submitted" | "confirmed" | "held" | "skipped" | "failed" | "disabled";
  reason: string;
  orderId?: string;
  orderLinkId?: string;
  filledQuantity?: number;
  filledValueUsdt?: number;
  riskMetrics?: {
    roundTripCostPct?: number;
    atrPct?: number;
    atrToCostRatio?: number;
    targetDistancePct?: number;
    expectedNetEdgePct?: number;
  };
}

export interface BotRunSummary {
  cycleKey: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed" | "skipped";
  model: string | null;
  marketState: Record<TradeAsset, MarketIndicatorState> | null;
  decisionContext: DecisionContextSnapshot | null;
  decisions: JevDecision[];
  executions: BotExecutionResult[];
  error: string | null;
}

export interface DashboardState {
  generatedAt: string;
  accountEnvironment: "testnet" | "demo" | "mainnet";
  marketSource: "bybit-mainnet";
  tradingEnabled: boolean;
  strategy: {
    runMode: string;
    activeEngines: string[];
    availableEngines: string[];
    executionEngine: string;
    exchangeRoutingAllowed: boolean;
    exchangeRoutingReason: string;
  };
  balances: SpotBalance[];
  prices: TickerPrices;
  openOrders: OrderHistoryItem[];
  orders: OrderHistoryItem[];
  history: DailyPortfolioPoint[];
  recentRuns: BotRunSummary[];
  connection: {
    bybit: "connected" | "not_configured" | "error";
    database: "connected" | "not_configured" | "error";
    message: string | null;
  };
}
