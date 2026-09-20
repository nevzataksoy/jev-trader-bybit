import { describe, expect, it } from "vitest";
import {
  calculateAtr,
  assertFreshMarketTimestamps,
  calculateAdx,
  calculateBollinger,
  calculateEmaSeries,
  calculateMacdHistogram,
  calculateRsi,
  calculateRealizedVolatility,
  calculateDownsideVolatility,
  calculateReturnStreak,
  calculateTrendEfficiency,
  classifyMamisPhase,
  classifyRegime,
  parseClosedCandles,
  stabilizeMamisPhases,
} from "./market";
import type { MarketIndicatorState } from "../types";

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
    expect(calculateDownsideVolatility(prices)).toBeGreaterThan(0);
    expect(calculateTrendEfficiency(prices, 16)).toBeGreaterThanOrEqual(0);
  });

  it("measures return streaks and classifies evidence-backed sentiment phases", () => {
    expect(calculateReturnStreak([1, 2, 3, 4])).toBe(3);
    expect(calculateReturnStreak([4, 3, 2, 1])).toBe(-3);
    const phase = classifyMamisPhase({
      regime: "bull_trend", lastPrice: 120, ema50: 110, ema200: 100,
      rsi: 72, priceZScore: 1.8, volumeRatio: 1.5, volumeZScore: 1.7,
      adx: 30, plusDi: 35, minusDi: 12, return1h: 1, return4h: 3,
      return24h: 5, return7d: 9, return30d: 20, macdHistogram: 2,
    });
    expect(phase.phase).toBe("enthusiasm");
    expect(phase.confidence).toBeGreaterThan(0.5);
  });

  it("excludes an in-progress candle using the exchange response time", () => {
    const interval = 15 * 60 * 1_000;
    const start = Date.UTC(2026, 8, 20, 12, 0);
    const rows = [
      [String(start + interval), "101", "103", "100", "102", "2", "204"],
      [String(start), "100", "102", "99", "101", "2", "202"],
    ];

    const candles = parseClosedCandles(rows, 15, start + interval + 1);
    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(101);
    expect(candles[0].closeTime).toBe(start + interval);
  });

  it("rejects stale source timestamps before Jev evaluation", () => {
    const now = Date.UTC(2026, 8, 20, 12, 15);
    expect(() => assertFreshMarketTimestamps(now - 1_000, now - 2_000, now - 15 * 60_000, now)).not.toThrow();
    expect(() => assertFreshMarketTimestamps(now - 6 * 60_000, now - 2_000, now - 15 * 60_000, now)).toThrow(/stale/);
    expect(() => assertFreshMarketTimestamps(now - 1_000, now - 2_000, now - 21 * 60_000, now)).toThrow(/candle/);
  });

  it("does not let a legacy stored state erase a newly classified sentiment phase", () => {
    const current = { mamis_phase: "wall_of_worry", mamis_confidence: 0.65 } as MarketIndicatorState;
    const legacy = {} as MarketIndicatorState;
    const result = stabilizeMamisPhases(
      { BTC: current, ETH: current, XAUT: current },
      { BTC: legacy, ETH: legacy, XAUT: legacy },
    );
    expect(result.BTC.mamis_phase).toBe("wall_of_worry");
  });
});
