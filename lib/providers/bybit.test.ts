import { describe, expect, it } from "vitest";
import { calculatePortfolioTotal, formatToIncrement } from "./bybit";

describe("Bybit execution helpers", () => {
  it("rounds quantities down to exchange precision", () => {
    expect(formatToIncrement(1.234567, "0.0001")).toBe("1.2345");
    expect(formatToIncrement(12.99, "1")).toBe("12");
  });

  it("adds only the supplied USDT valuations", () => {
    expect(calculatePortfolioTotal([
      { coin: "USDT", free: 20, locked: 0, total: 20, usdtValue: 20 },
      { coin: "BTC", free: 0.01, locked: 0, total: 0.01, usdtValue: 700 },
    ])).toBe(720);
  });
});
