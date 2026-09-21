import { describe, expect, it } from "vitest";
import { buildPositionContexts, rankDecisionsForExecution } from "./portfolio";
import type { JevDecision, OrderHistoryItem, SpotBalance } from "./types";

const balances: SpotBalance[] = [
  { coin: "USDT", free: 800, locked: 0, total: 800, usdtValue: 800 },
  { coin: "BTC", free: 0.002, locked: 0, total: 0.002, usdtValue: 200 },
  { coin: "ETH", free: 0, locked: 0, total: 0, usdtValue: 0 },
  { coin: "XAUT", free: 0, locked: 0, total: 0, usdtValue: 0 },
];

function order(overrides: Partial<OrderHistoryItem> = {}): OrderHistoryItem {
  return {
    orderId: "1", orderLinkId: "jev-1", symbol: "BTCUSDT", side: "Buy", orderType: "Market",
    qty: "0.002", price: "0", avgPrice: "100000", cumExecQty: "0.002", cumExecValue: "200",
    fee: "0.2", feeCurrency: "USDT", orderStatus: "Filled", createdTime: "1000", updatedTime: "2000",
    executedTime: "2000", isOpen: false, ...overrides,
  };
}

describe("portfolio decision context", () => {
  it("reconstructs a complete average entry price and labels flat assets", () => {
    const contexts = buildPositionContexts(balances, [order()], 1_000, 62_000);
    expect(contexts.BTC.cost_basis_quality).toBe("complete");
    expect(contexts.BTC.average_entry_price).toBeCloseTo(100100);
    expect(contexts.BTC.minutes_since_last_trade).toBe(1);
    expect(contexts.ETH.status).toBe("flat");
  });

  it("marks cost basis partial when recent order history does not cover the wallet", () => {
    const contexts = buildPositionContexts(balances, [order({ cumExecQty: "0.001", cumExecValue: "100" })], 1_000);
    expect(contexts.BTC.cost_basis_quality).toBe("partial");
    expect(contexts.BTC.average_entry_price).toBeNull();
  });

  it("runs risk-reduction sells before the strongest buy", () => {
    const judgments = {
      regime: { choice: "uptrend" as const, confidence: 0.8, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
      best_setup: { choice: "trend_pullback" as const, confidence: 0.8, probabilities: { trend_pullback: 0.8, upside_breakout: 0.05, range_reversion: 0.03, bear_rebound: 0.02, reduce: 0.05, none: 0.05 } },
      entry_readiness: { choice: "enter_now" as const, confidence: 0.8, probabilities: { enter_now: 0.8, wait_close: 0.05, wait_retest: 0.1, no_entry: 0.05 } },
      direction: { choice: "up" as const, confidence: 0.8, probabilities: { up: 0.8, down: 0.1, unclear: 0.1 } },
      follow_through: { choice: "continuation" as const, confidence: 0.8, probabilities: { continuation: 0.8, reversal: 0.1, no_pattern: 0.1 } },
      setup_quality: { score: 2.5, confidence: 0.8, probabilities: { 0: 0.05, 1: 0.1, 2: 0.25, 3: 0.6 } },
      false_breakout: 0.1, reversal_confirmation: 0.7,
      liquidity_ok: 0.9, disorderly: 0.1, cut_position: 0.1,
    };
    const decisions: JevDecision[] = [
      { asset: "BTC", action: "buy", confidence: 0.9, probabilities: { buy: 0.9, hold: 0.08, sell: 0.02 }, currentAllocationPct: 20, targetAllocationPct: 30, rebalanceDeltaPct: 10, selectedSetup: "trend_pullback", entryReadiness: "enter_now", expectedNetEdgePct: 0.5, opportunityScore: 0.7, grossRiskBudgetPct: 80, policyReason: "test", judgments },
      { asset: "ETH", action: "sell", confidence: 0.75, probabilities: { buy: 0.05, hold: 0.1, sell: 0.85 }, currentAllocationPct: 20, targetAllocationPct: 10, rebalanceDeltaPct: -10, selectedSetup: "reduce", entryReadiness: "no_entry", expectedNetEdgePct: 0, opportunityScore: 0, grossRiskBudgetPct: 80, policyReason: "test", judgments },
      { asset: "XAUT", action: "hold", confidence: 0.95, probabilities: { buy: 0.02, hold: 0.96, sell: 0.02 }, currentAllocationPct: 0, targetAllocationPct: 0, rebalanceDeltaPct: 0, selectedSetup: "none", entryReadiness: "no_entry", expectedNetEdgePct: 0, opportunityScore: 0, grossRiskBudgetPct: 80, policyReason: "test", judgments },
    ];
    expect(rankDecisionsForExecution(decisions).map((item) => item.action)).toEqual(["sell", "buy", "hold"]);
  });
});
