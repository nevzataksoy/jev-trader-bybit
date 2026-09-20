import type { AssetId, TradeAsset } from "./types";

export const SYMBOLS: Record<TradeAsset, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  XAUT: "XAUTUSDT",
};

export const SYMBOL_TO_ASSET = Object.fromEntries(
  Object.entries(SYMBOLS).map(([asset, symbol]) => [symbol, asset]),
) as Record<string, TradeAsset>;

export const TARGET_ASSETS: AssetId[] = ["USDT", "BTC", "ETH", "XAUT"];

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getTradingConfig() {
  return {
    enabled: process.env.TRADING_ENABLED === "true",
    minConfidence: numberFromEnv("MIN_CONFIDENCE_THRESHOLD", 0.72, 0, 1),
    buyPctOfUsdt: numberFromEnv("BUY_PCT_OF_USDT", 0.2, 0.01, 1),
    sellPctOfHolding: numberFromEnv("SELL_PCT_OF_HOLDING", 0.25, 0.01, 1),
    minTradeUsdt: numberFromEnv("MIN_TRADE_USDT", 5, 1, 10_000),
    minUsdtReservePct: numberFromEnv("MIN_USDT_RESERVE_PCT", 0.2, 0, 0.95),
    maxAssetAllocationPct: numberFromEnv("MAX_ASSET_ALLOCATION_PCT", 0.5, 0.05, 1),
    targetDailyVolatilityPct: numberFromEnv("TARGET_DAILY_VOLATILITY_PCT", 3, 0.1, 50),
    maxDailyVolatilityPct: numberFromEnv("MAX_DAILY_VOLATILITY_PCT", 10, 0.5, 100),
    maxSpreadPct: numberFromEnv("MAX_SPREAD_PCT", 0.25, 0.001, 5),
    minBearReboundScore: numberFromEnv("MIN_BEAR_REBOUND_SCORE", 0.62, 0, 1),
    estimatedSlippagePct: numberFromEnv("ESTIMATED_SLIPPAGE_PCT", 0.03, 0, 2),
    maxMarketSlippagePct: numberFromEnv("MAX_MARKET_SLIPPAGE_PCT", 0.2, 0.01, 10),
    minTradableRangeToCostRatio: numberFromEnv("MIN_TRADABLE_RANGE_TO_COST_RATIO", 2.5, 1, 20),
    maxPortfolioDrawdownPct: numberFromEnv("MAX_PORTFOLIO_DRAWDOWN_PCT", 3, 0.1, 50),
    assetCooldownMinutes: numberFromEnv("ASSET_COOLDOWN_MINUTES", 60, 0, 10_080),
    maxCompletedOrders24h: numberFromEnv("MAX_COMPLETED_ORDERS_24H", 8, 1, 100),
    maxBuysPerCycle: Math.round(numberFromEnv("MAX_BUYS_PER_CYCLE", 1, 1, 3)),
    allocationDeadbandPct: numberFromEnv("ALLOCATION_DEADBAND_PCT", 3, 0.25, 25),
    minPolicyConfidence: numberFromEnv("MIN_POLICY_CONFIDENCE", 0.58, 0, 1),
    minSellConfidence: numberFromEnv("MIN_SELL_CONFIDENCE", 0.60, 0, 1),
    minDirectionalEdge: numberFromEnv("MIN_DIRECTIONAL_EDGE", 0.15, 0, 0.9),
    minSetupScore: numberFromEnv("MIN_SETUP_SCORE", 1.5, 0, 3),
    minLiquidityProbability: numberFromEnv("MIN_LIQUIDITY_PROBABILITY", 0.55, 0, 1),
    disorderlyProbability: numberFromEnv("DISORDERLY_PROBABILITY", 0.70, 0, 1),
    cutPositionProbability: numberFromEnv("CUT_POSITION_PROBABILITY", 0.72, 0, 1),
    macroCacheHours: numberFromEnv("MACRO_CACHE_HOURS", 6, 1, 24),
  };
}

export type AccountEnvironment = "testnet" | "demo" | "mainnet";

export function getAccountEnvironment(): AccountEnvironment {
  const value = process.env.BYBIT_ACCOUNT_ENV?.toLowerCase();
  if (value === "demo" || value === "mainnet") return value;
  return "demo";
}

export function assertLiveTradingAllowed(environment: AccountEnvironment) {
  if (environment === "mainnet" && process.env.ALLOW_LIVE_TRADING !== "true") {
    throw new Error(
      "Mainnet trading is locked. Set ALLOW_LIVE_TRADING=true only after a separate production risk review.",
    );
  }
}
