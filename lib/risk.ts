import type { getTradingConfig } from "./config";
import type { StrategyExecutionIntent } from "./strategy/types";
import type {
  FeeRate,
  JevDecision,
  MarketIndicatorState,
  PortfolioRiskContext,
  PositionContext,
  SpotBalance,
} from "./types";

type TradingConfig = ReturnType<typeof getTradingConfig>;

export interface ExecutionPlan {
  allowed: boolean;
  reason: string;
  buyPctOfUsdt: number;
  sellPctOfHolding: number;
}

export interface ExecutionContext {
  position: PositionContext;
  fee: FeeRate;
  portfolioRisk: PortfolioRiskContext;
  strategyIntent?: StrategyExecutionIntent;
}

function deny(reason: string): ExecutionPlan {
  return { allowed: false, reason, buyPctOfUsdt: 0, sellPctOfHolding: 0 };
}

export function createExecutionPlan(
  decision: JevDecision,
  market: MarketIndicatorState,
  balances: SpotBalance[],
  totalPortfolioUsdt: number,
  config: TradingConfig,
  context: ExecutionContext,
  now = Date.now(),
): ExecutionPlan {
  if (decision.action === "hold") return deny("Jev selected hold for this cycle.");
  if (context.strategyIntent && !context.strategyIntent.allowed) return deny(context.strategyIntent.reason);
  const requiredConfidence = decision.action === "sell" ? config.minSellConfidence : config.minConfidence;
  if (decision.confidence < requiredConfidence) {
    return deny(`Confidence ${decision.confidence.toFixed(3)} is below ${requiredConfidence.toFixed(3)}.`);
  }
  const ageMs = now - new Date(market.observed_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > 5 * 60 * 1_000) return deny("Ticker or order-book state is stale.");
  const candleAgeMs = now - new Date(market.last_closed_15m_at).getTime();
  if (!Number.isFinite(candleAgeMs) || candleAgeMs < -60_000 || candleAgeMs > 20 * 60 * 1_000) {
    return deny("The latest closed 15-minute candle is stale.");
  }
  if (market.bid_ask_spread_pct > config.maxSpreadPct) {
    return deny(`Spread ${market.bid_ask_spread_pct.toFixed(4)}% exceeds the configured limit.`);
  }

  const assetBalance = balances.find((balance) => balance.coin === decision.asset);
  if (decision.action === "sell") {
    if (!assetBalance || assetBalance.usdtValue < config.minTradeUsdt) {
      return deny(`Available ${decision.asset} value is below the minimum trade amount.`);
    }
    const currentAllocation = Math.max(decision.currentAllocationPct, context.position.allocation_pct, 0.0001);
    const targetReductionFraction = Math.max(0, -decision.rebalanceDeltaPct) / currentAllocation;
    const requestedSellPct = context.strategyIntent?.sellPctOfHolding ?? targetReductionFraction;
    const sellPctOfHolding = Math.min(1, targetReductionFraction, Math.max(0, requestedSellPct));
    if (sellPctOfHolding * assetBalance.usdtValue < config.minTradeUsdt) {
      return deny("Target allocation delta is below the minimum executable sale amount.");
    }
    return {
      allowed: true,
      reason: `Risk-reduction sale passed deterministic gates; moving ${(sellPctOfHolding * 100).toFixed(1)}% of the holding toward USDT.`,
      buyPctOfUsdt: 0,
      sellPctOfHolding,
    };
  }

  if (context.portfolioRisk.current_drawdown_pct >= config.maxPortfolioDrawdownPct) {
    return deny(`Portfolio drawdown ${context.portfolioRisk.current_drawdown_pct.toFixed(2)}% reached the buy circuit breaker.`);
  }
  if (context.portfolioRisk.completed_orders_24h >= config.maxCompletedOrders24h) {
    return deny("The 24-hour completed-order limit has been reached.");
  }
  if (market.realized_volatility_24h_pct > config.maxDailyVolatilityPct) {
    return deny(`Daily realized volatility ${market.realized_volatility_24h_pct.toFixed(2)}% is above the risk ceiling.`);
  }
  const roundTripCostPct = context.fee.taker_fee_pct * 2
    + market.bid_ask_spread_pct
    + config.estimatedSlippagePct * 2;
  const rangeToCostRatio = market.atr_14_pct / Math.max(roundTripCostPct, 0.0001);
  if (rangeToCostRatio < config.minTradableRangeToCostRatio) {
    return deny(`ATR-to-cost ratio ${rangeToCostRatio.toFixed(2)} is below ${config.minTradableRangeToCostRatio.toFixed(2)}.`);
  }

  const usdtBalance = balances.find((balance) => balance.coin === "USDT");
  const freeUsdt = usdtBalance?.free ?? 0;
  if (freeUsdt < config.minTradeUsdt || totalPortfolioUsdt <= 0) return deny("Available USDT is below the minimum trade amount.");
  const reserve = totalPortfolioUsdt * config.minUsdtReservePct;
  const spendableAfterReserve = Math.max(0, freeUsdt - reserve);
  const allocationCapacity = Math.max(0, totalPortfolioUsdt * config.maxAssetAllocationPct - (assetBalance?.usdtValue ?? 0));
  const targetDeltaSpend = Math.max(0, decision.rebalanceDeltaPct) / 100 * totalPortfolioUsdt;
  const requestedSpend = context.strategyIntent
    ? freeUsdt * Math.min(1, Math.max(0, context.strategyIntent.buyPctOfUsdt))
    : targetDeltaSpend;
  const approvedSpend = Math.min(requestedSpend, targetDeltaSpend, spendableAfterReserve, allocationCapacity);
  if (approvedSpend < config.minTradeUsdt) {
    return deny("USDT reserve or per-asset allocation limit leaves no valid buy budget.");
  }
  return {
    allowed: true,
    reason: context.strategyIntent
      ? `${context.strategyIntent.reason} Platform safety gates passed.`
      : "Buy passed platform safety gates; execution follows the model version's target allocation delta.",
    buyPctOfUsdt: approvedSpend / freeUsdt,
    sellPctOfHolding: 0,
  };
}
