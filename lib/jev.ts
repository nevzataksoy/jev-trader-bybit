import type {
  FeeRate,
  MacroState,
  MarketIndicatorState,
  OrderHistoryItem,
  PortfolioRiskContext,
  PositionContext,
  SpotBalance,
  TickerPrices,
  TradeAsset,
} from "./types";

/**
 * Model-agnostic runtime input shared by isolated strategy versions.
 * Jev questions and interpretation live inside each models/<family>/<version> directory.
 */
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
