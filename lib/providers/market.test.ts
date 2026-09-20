import { describe, expect, it } from "vitest";
import {
  calculateAtr,
  calculateBollinger,
  calculateEmaSeries,
  calculateMacdHistogram,
  calculateRsi,
} from "./market";

const rising = Array.from({ length: 200 }, (_, index) => 100 + index);

describe("market indicators", () => {
  it("calculates finite technical values from chronological candles", () => {
    const ema = calculateEmaSeries(rising, 21).at(-1);
    const rsi = calculateRsi(rising);
    const macd = calculateMacdHistogram(rising);
    const bands = calculateBollinger(rising);
    const atr = calculateAtr(rising.map((v) => v + 2), rising.map((v) => v - 2), rising);

    expect(ema).toBeTypeOf("number");
    expect(rsi).toBe(100);
    expect(macd).toBeGreaterThanOrEqual(0);
    expect(bands.upper).toBeGreaterThan(bands.lower);
    expect(atr).toBeGreaterThan(0);
  });

  it("rejects insufficient inputs instead of inventing indicators", () => {
    expect(() => calculateRsi([1, 2, 3])).toThrow();
    expect(() => calculateBollinger([1, 2, 3])).toThrow();
  });
});
