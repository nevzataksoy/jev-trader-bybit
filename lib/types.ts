export const ASSET_IDS = ["USDT", "BTC", "ETH", "XAUT"] as const;
export const TRADE_ASSETS = ["BTC", "ETH", "XAUT"] as const;

export type Language = "tr" | "en";
export type AssetId = (typeof ASSET_IDS)[number];
export type TradeAsset = (typeof TRADE_ASSETS)[number];
export type TradeAction = "buy" | "sell" | "hold";
export type MarketRegime = "bull_trend" | "bear_trend" | "range" | "transition";

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
  observed_at: string;
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
  bb_upper: number;
  bb_lower: number;
  bb_width_pct: number;
  bb_position: number;
  macd_hist: number;
  realized_volatility_24h_pct: number;
  volume_ratio_20: number;
  price_zscore_20: number;
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
  open_interest_usdt_estimate: number | null;
  open_interest_change_1h_pct: number | null;
  open_interest_change_4h_pct: number | null;
  funding_rate_latest_pct: number | null;
  data_quality: "complete" | "spot_only";
}

export interface JevDecision {
  asset: TradeAsset;
  action: TradeAction;
  confidence: number;
  probabilities: Record<TradeAction, number>;
}

export interface JevResponse {
  model: string;
  decisions: JevDecision[];
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
  asset: TradeAsset;
  symbol: string;
  action: TradeAction;
  status: "submitted" | "held" | "skipped" | "failed" | "disabled";
  reason: string;
  orderId?: string;
  orderLinkId?: string;
}

export interface BotRunSummary {
  cycleKey: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed" | "skipped";
  model: string | null;
  marketState: Record<TradeAsset, MarketIndicatorState> | null;
  decisions: JevDecision[];
  executions: BotExecutionResult[];
  error: string | null;
}

export interface DashboardState {
  generatedAt: string;
  accountEnvironment: "testnet" | "demo" | "mainnet";
  marketSource: "bybit-mainnet";
  tradingEnabled: boolean;
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
