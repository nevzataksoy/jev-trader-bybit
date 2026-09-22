import type { JevDecision } from "../../../../types";
import type { StrategyExecutionContext, StrategyExecutionIntent } from "../../../types";
import type { ModelConfig } from "./config";

function deny(reason: string): StrategyExecutionIntent {
  return { allowed: false, reason, buyPctOfUsdt: 0, sellPctOfHolding: 0 };
}

export function orderDecisions(decisions: JevDecision[]) {
  const priority = { sell: 0, buy: 1, hold: 2 } as const;
  return [...decisions].sort((left, right) => {
    const actionOrder = priority[left.action] - priority[right.action];
    if (actionOrder !== 0) return actionOrder;
    const leftEdge = left.probabilities[left.action] - Math.max(...Object.entries(left.probabilities)
      .filter(([action]) => action !== left.action)
      .map(([, probability]) => probability));
    const rightEdge = right.probabilities[right.action] - Math.max(...Object.entries(right.probabilities)
      .filter(([action]) => action !== right.action)
      .map(([, probability]) => probability));
    return (right.confidence + rightEdge) - (left.confidence + leftEdge);
  });
}

export function planExecution(
  decision: JevDecision,
  context: StrategyExecutionContext,
  config: ModelConfig,
): StrategyExecutionIntent {
  if (decision.action === "hold") return deny("Model2 V1 selected hold for this cycle.");

  if (decision.action === "sell") {
    const currentAllocation = Math.max(decision.currentAllocationPct, context.position.allocation_pct, 0.0001);
    const targetReductionFraction = Math.max(0, -decision.rebalanceDeltaPct) / currentAllocation;
    const sellPctOfHolding = Math.min(config.sellPctOfHolding, targetReductionFraction);
    return {
      allowed: true,
      reason: `Model2 V1 risk-reduction sizing requests ${(sellPctOfHolding * 100).toFixed(1)}% of the holding.`,
      buyPctOfUsdt: 0,
      sellPctOfHolding,
    };
  }

  if (context.market.regime === "bear_trend" && context.market.countertrend_rebound_score < config.minBearReboundScore) {
    return deny(`Model2 V1 bear-market rebound score ${context.market.countertrend_rebound_score.toFixed(2)} is below ${config.minBearReboundScore.toFixed(2)}.`);
  }

  const freeUsdt = context.balances.find((balance) => balance.coin === "USDT")?.free ?? 0;
  const targetDeltaSpend = Math.max(0, decision.rebalanceDeltaPct) / 100 * context.totalPortfolioUsdt;
  const volatilityScale = Math.min(1, config.targetDailyVolatilityPct / Math.max(context.market.realized_volatility_24h_pct, 0.1));
  const isInitialEntry = context.position.status === "flat" || context.position.value_usdt < context.minTradeUsdt;
  const strongInitialEntry = decision.judgments.setup_quality.score >= 3
    && decision.confidence >= 0.75
    && decision.judgments.liquidity_ok >= 0.75;
  const initialTranchePct = strongInitialEntry
    ? config.strongInitialEntryPctOfPortfolio
    : config.initialEntryPctOfPortfolio;
  const requestedSpend = isInitialEntry
    ? context.totalPortfolioUsdt * initialTranchePct
    : freeUsdt * config.buyPctOfUsdt;
  const desiredSpend = Math.min(requestedSpend, targetDeltaSpend) * volatilityScale;
  return {
    allowed: true,
    reason: `Model2 V1 sizing requests ${desiredSpend.toFixed(2)} USDT after ${(volatilityScale * 100).toFixed(0)}% volatility scaling.`,
    buyPctOfUsdt: freeUsdt > 0 ? Math.min(1, desiredSpend / freeUsdt) : 0,
    sellPctOfHolding: 0,
  };
}
