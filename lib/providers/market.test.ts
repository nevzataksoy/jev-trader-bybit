import { describe, expect, it } from "vitest";
import {
  calculateAtr,
  calculateAdx,
  calculateBollinger,
  calculateEmaSeries,
  calculateMacdHistogram,
  calculateRsi,
  calculateRealizedVolatility,
  classifyRegime,
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

  it("detects directional strength and classifies bull, bear and range regimes", () => {
    const directional = calculateAdx(
      rising.map((value) => value + 2),
      rising.map((value) => value - 2),
      rising,
    );
    expect(directional.adx).toBeGreaterThan(20);
    expect(directional.plusDi).toBeGreaterThan(directional.minusDi);

    expect(classifyRegime({
      lastPrice: 120, ema9: 118, ema21: 116, ema50: 110, ema200: 100,
      return4h: 2, return24h: 5, adx: 30, plusDi: 35, minusDi: 12, priceZScore: 1,
    }).regime).toBe("bull_trend");
    expect(classifyRegime({
      lastPrice: 80, ema9: 82, ema21: 84, ema50: 90, ema200: 100,
      return4h: -2, return24h: -5, adx: 30, plusDi: 12, minusDi: 35, priceZScore: -1,
    }).regime).toBe("bear_trend");
    expect(classifyRegime({
      lastPrice: 100, ema9: 100, ema21: 100, ema50: 100, ema200: 100,
      return4h: 0, return24h: 0, adx: 12, plusDi: 15, minusDi: 15, priceZScore: 0,
    }).regime).toBe("range");
  });

  it("computes finite 24-hour realized volatility from 15-minute returns", () => {
    const prices = Array.from({ length: 120 }, (_, index) => 100 * (1 + Math.sin(index / 5) * 0.01));
    expect(calculateRealizedVolatility(prices)).toBeGreaterThan(0);
  });
});
