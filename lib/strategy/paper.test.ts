import { describe, expect, it } from "vitest";
import { calculatePaperFill } from "./paper";

describe("paper fills", () => {
  it("charges adverse spread, slippage and taker fee on buys without overspending cash", () => {
    const fill = calculatePaperFill({
      side: "Buy", cashUsdt: 1_000, assetQuantity: 0, averageEntryPrice: 0,
      referencePrice: 100, spreadPct: 0.1, slippagePct: 0.05, takerFeePct: 0.1,
      buyFraction: 0.5, sellFraction: 0,
    });
    expect(fill.fillPrice).toBeCloseTo(100.1, 8);
    expect(fill.grossValueUsdt).toBeCloseTo(500, 8);
    expect(fill.feeUsdt).toBeCloseTo(0.5, 8);
    expect(fill.newCashUsdt).toBeCloseTo(499.5, 8);
    expect(fill.newAverageEntryPrice).toBeGreaterThan(fill.fillPrice);
  });

  it("realizes PnL and keeps the original cost basis on partial sells", () => {
    const fill = calculatePaperFill({
      side: "Sell", cashUsdt: 100, assetQuantity: 10, averageEntryPrice: 90,
      referencePrice: 110, spreadPct: 0.1, slippagePct: 0.05, takerFeePct: 0.1,
      buyFraction: 0, sellFraction: 0.25,
    });
    expect(fill.quantity).toBeCloseTo(2.5, 8);
    expect(fill.newAssetQuantity).toBeCloseTo(7.5, 8);
    expect(fill.newAverageEntryPrice).toBe(90);
    expect(fill.realizedPnlUsdt).toBeGreaterThan(0);
    expect(fill.newCashUsdt).toBeGreaterThan(100);
  });
});
