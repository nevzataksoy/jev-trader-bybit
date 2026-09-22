import { describe, expect, it } from "vitest";
import { buildPositionContexts } from "./portfolio";
import type { OrderHistoryItem, SpotBalance } from "./types";

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
});
