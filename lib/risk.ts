import type { getTradingConfig } from "./config";
import type { JevDecision, MarketIndicatorState, SpotBalance } from "./types";

type TradingConfig = ReturnType<typeof getTradingConfig>;

export interface ExecutionPlan {
  allowed: boolean;
  reason: string;
  buyPctOfUsdt: number;
}

function deny(reason: string): ExecutionPlan {
  return { allowed: false, reason, buyPctOfUsdt: 0 };
}

export function createExecutionPlan(
  decision: JevDecision,
  market: MarketIndicatorState,
  balances: SpotBalance[],
  totalPortfolioUsdt: number,
  config: TradingConfig,
  now = Date.now(),
): ExecutionPlan {
  if (decision.action === "hold") return deny("Jev selected hold for this cycle.");
  if (decision.confidence < config.minConfidence) {
    return deny(`Confidence ${decision.confidence.toFixed(3)} is below ${config.minConfidence.toFixed(3)}.`);
  }
  const ageMs = now - new Date(market.observed_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1_000) return deny("Market state is stale.");
  if (market.bid_ask_spread_pct > config.maxSpreadPct) {
    return deny(`Spread ${market.bid_ask_spread_pct.toFixed(4)}% exceeds the configured limit.`);
  }

  const assetBalance = balances.find((balance) => balance.coin === decision.asset);
  if (decision.action === "sell") {
    if (!assetBalance || assetBalance.usdtValue < config.minTradeUsdt) {
      return deny(`Available ${decision.asset} value is below the minimum trade amount.`);
    }
    return { allowed: true, reason: "Risk-reduction sale passed deterministic gates.", buyPctOfUsdt: 0 };
  }

  if (market.realized_volatility_24h_pct > config.maxDailyVolatilityPct) {
    return deny(`Daily realized volatility ${market.realized_volatility_24h_pct.toFixed(2)}% is above the risk ceiling.`);
  }
  if (market.regime === "bear_trend" && market.countertrend_rebound_score < config.minBearReboundScore) {
    return deny(`Bear-market rebound score ${market.countertrend_rebound_score.toFixed(2)} is too weak for a countertrend buy.`);
  }

  const usdtBalance = balances.find((balance) => balance.coin === "USDT");
  const freeUsdt = usdtBalance?.free ?? 0;
  if (freeUsdt < config.minTradeUsdt || totalPortfolioUsdt <= 0) return deny("Available USDT is below the minimum trade amount.");
  const reserve = totalPortfolioUsdt * config.minUsdtReservePct;
  const spendableAfterReserve = Math.max(0, freeUsdt - reserve);
  const allocationCapacity = Math.max(0, totalPortfolioUsdt * config.maxAssetAllocationPct - (assetBalance?.usdtValue ?? 0));
  const volatilityScale = Math.min(1, config.targetDailyVolatilityPct / Math.max(market.realized_volatility_24h_pct, 0.1));
  const desiredSpend = freeUsdt * config.buyPctOfUsdt * volatilityScale;
  const approvedSpend = Math.min(desiredSpend, spendableAfterReserve, allocationCapacity);
  if (approvedSpend < config.minTradeUsdt) {
    return deny("USDT reserve or per-asset allocation limit leaves no valid buy budget.");
  }
  return {
    allowed: true,
    reason: `Buy passed reserve, allocation, spread, regime and volatility gates; size scaled to ${(volatilityScale * 100).toFixed(0)}%.`,
    buyPctOfUsdt: approvedSpend / freeUsdt,
  };
}
