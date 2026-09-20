import { describe, expect, it } from "vitest";
import { reconcileExecutions } from "./execution";
import type { BotExecutionResult, OrderHistoryItem } from "./types";

const execution: BotExecutionResult = {
  asset: "BTC", symbol: "BTCUSDT", action: "buy", status: "submitted",
  reason: "Order accepted.", orderId: "order-1", orderLinkId: "jev-1",
};

function order(overrides: Partial<OrderHistoryItem> = {}): OrderHistoryItem {
  return {
    orderId: "order-1", orderLinkId: "jev-1", symbol: "BTCUSDT", side: "Buy", orderType: "Market",
    qty: "10", price: "0", avgPrice: "100000", cumExecQty: "0.0001", cumExecValue: "10",
    fee: "0.01", feeCurrency: "USDT", orderStatus: "Filled", createdTime: "1", updatedTime: "2",
    executedTime: "2", isOpen: false, ...overrides,
  };
}

describe("order reconciliation", () => {
  it("confirms an acknowledged order only after a recorded fill", () => {
    const result = reconcileExecutions([execution], [order()])[0];
    expect(result.status).toBe("confirmed");
    expect(result.filledValueUsdt).toBe(10);
  });

  it("marks a terminal unfilled rejection as failed", () => {
    const result = reconcileExecutions([execution], [order({ cumExecQty: "0", orderStatus: "Rejected" })])[0];
    expect(result.status).toBe("failed");
  });
});
