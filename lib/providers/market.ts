import { SYMBOLS } from "../config";
import type { MamisPhase, MarketIndicatorState, MarketRegime, TradeAsset } from "../types";
import { getMainnetMarketClient } from "./bybit";

export type Candle = {
  startTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
};
type RegimeInput = {
  lastPrice: number; ema9: number; ema21: number; ema50: number; ema200: number;
  return4h: number; return24h: number; adx: number; plusDi: number; minusDi: number;
  priceZScore: number; bbWidthPercentile?: number;
};

function assertResponse(response: { retCode: number; retMsg: string }, operation: string) {
  if (response.retCode !== 0) throw new Error(`${operation} failed [${response.retCode}]: ${response.retMsg}`);
}

function round(value: number, digits = 4) { return Number(value.toFixed(digits)); }
function clamp(value: number, minimum = 0, maximum = 1) { return Math.min(maximum, Math.max(minimum, value)); }

export function assertFreshMarketTimestamps(
  tickerTime: number,
  orderbookTime: number,
  lastClosed15mTime: number,
  now: number,
) {
  const sourceAges = [tickerTime, orderbookTime].map((timestamp) => now - timestamp);
  if (sourceAges.some((age) => !Number.isFinite(age) || age < -60_000 || age > 5 * 60 * 1_000)) {
    throw new Error("Ticker or order-book source timestamp is stale or invalid.");
  }
  const candleAge = now - lastClosed15mTime;
  if (!Number.isFinite(candleAge) || candleAge < -60_000 || candleAge > 20 * 60 * 1_000) {
    throw new Error("Latest closed 15-minute candle timestamp is stale or invalid.");
  }
}

export function parseClosedCandles(list: string[][], intervalMinutes: number, serverTime: number): Candle[] {
  const intervalMs = intervalMinutes * 60 * 1_000;
  return [...list]
    .reverse()
    .map((candle) => ({
      startTime: Number(candle[0]),
      closeTime: Number(candle[0]) + intervalMs,
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5]),
      turnover: Number(candle[6]),
    }))
    .filter((candle) => candle.closeTime <= serverTime)
    .filter((candle) => [candle.startTime, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.turnover].every(Number.isFinite));
}

function percentageReturn(values: number[], periods: number) {
  if (values.length <= periods) throw new Error(`Return requires ${periods + 1} observations.`);
  const current = values.at(-1)!;
  const previous = values.at(-(periods + 1))!;
  if (previous === 0) throw new Error("Return cannot use a zero reference price.");
  return ((current / previous) - 1) * 100;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) throw new Error("Standard deviation requires two observations.");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function channelState(candles: Candle[], lastPrice: number, atr: number) {
  if (candles.length === 0) throw new Error("Price channel requires at least one completed reference candle.");
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const width = high - low;
  return {
    high,
    low,
    position: width > 0 ? (lastPrice - low) / width : 0.5,
    distanceToHighAtr: atr > 0 ? (high - lastPrice) / atr : 0,
    distanceToLowAtr: atr > 0 ? (lastPrice - low) / atr : 0,
    breakoutPct: high > 0 ? ((lastPrice / high) - 1) * 100 : 0,
  };
}

function percentileRank(values: number[], value: number) {
  if (values.length === 0) return 0.5;
  return values.filter((item) => item <= value).length / values.length;
}

function classifySwingStructure(candles: Candle[]): MarketIndicatorState["structure_12h"] {
  const window = candles.slice(-12);
  if (window.length < 12) return "mixed";
  const previous = window.slice(0, 6);
  const recent = window.slice(6);
  const previousHigh = Math.max(...previous.map((candle) => candle.high));
  const previousLow = Math.min(...previous.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  if (recentHigh > previousHigh && recentLow > previousLow) return "higher";
  if (recentHigh < previousHigh && recentLow < previousLow) return "lower";
  return "mixed";
}

export function calculateEmaSeries(values: number[], period: number) {
  if (values.length === 0) throw new Error("EMA requires at least one value.");
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * multiplier + result[index - 1] * (1 - multiplier));
  }
  return result;
}

export function calculateRsi(values: number[], period = 14) {
  if (values.length <= period) throw new Error("RSI does not have enough candles.");
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (averageLoss === 0) return 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

export function calculateMacdHistogram(values: number[]) {
  const ema12 = calculateEmaSeries(values, 12);
  const ema26 = calculateEmaSeries(values, 26);
  const macd = values.map((_, index) => ema12[index] - ema26[index]);
  const signal = calculateEmaSeries(macd, 9);
  return macd.at(-1)! - signal.at(-1)!;
}

export function calculateBollinger(values: number[], period = 20, multiplier = 2) {
  const window = values.slice(-period);
  if (window.length < period) throw new Error("Bollinger Bands do not have enough candles.");
  const mean = window.reduce((sum, value) => sum + value, 0) / period;
  const deviation = standardDeviation(window);
  const upper = mean + deviation * multiplier;
  const lower = mean - deviation * multiplier;
  return {
    upper, lower, widthPct: ((upper - lower) / mean) * 100,
    position: upper === lower ? 0.5 : (values.at(-1)! - lower) / (upper - lower),
    zScore: deviation === 0 ? 0 : (values.at(-1)! - mean) / deviation,
  };
}

export function calculateAtr(highs: number[], lows: number[], closes: number[], period = 14) {
  if (closes.length <= period) throw new Error("ATR does not have enough candles.");
  const trueRanges: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    trueRanges.push(Math.max(
      highs[index] - lows[index],
      Math.abs(highs[index] - closes[index - 1]),
      Math.abs(lows[index] - closes[index - 1]),
    ));
  }
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const range of trueRanges.slice(period)) atr = (atr * (period - 1) + range) / period;
  return atr;
}

export function calculateAdx(highs: number[], lows: number[], closes: number[], period = 14) {
  if (closes.length < period * 2 + 1) throw new Error("ADX does not have enough candles.");
  const trueRanges: number[] = [];
  const plusMoves: number[] = [];
  const minusMoves: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const upMove = highs[index] - highs[index - 1];
    const downMove = lows[index - 1] - lows[index];
    trueRanges.push(Math.max(highs[index] - lows[index], Math.abs(highs[index] - closes[index - 1]), Math.abs(lows[index] - closes[index - 1])));
    plusMoves.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusMoves.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothedTr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedPlus = plusMoves.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedMinus = minusMoves.slice(0, period).reduce((sum, value) => sum + value, 0);
  const values: Array<{ dx: number; plusDi: number; minusDi: number }> = [];
  const addValue = () => {
    const plusDi = smoothedTr === 0 ? 0 : (100 * smoothedPlus) / smoothedTr;
    const minusDi = smoothedTr === 0 ? 0 : (100 * smoothedMinus) / smoothedTr;
    const denominator = plusDi + minusDi;
    values.push({ plusDi, minusDi, dx: denominator === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / denominator });
  };
  addValue();
  for (let index = period; index < trueRanges.length; index += 1) {
    smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index];
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusMoves[index];
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusMoves[index];
    addValue();
  }
  let adx = values.slice(0, period).reduce((sum, value) => sum + value.dx, 0) / period;
  for (const value of values.slice(period)) adx = (adx * (period - 1) + value.dx) / period;
  const latest = values.at(-1)!;
  return { adx, plusDi: latest.plusDi, minusDi: latest.minusDi };
}

export function calculateRealizedVolatility(values: number[], intervalsPerDay = 96) {
  const window = values.slice(-(intervalsPerDay + 1));
  if (window.length < intervalsPerDay + 1) throw new Error("Realized volatility lacks a full window.");
  const logReturns = window.slice(1).map((value, index) => Math.log(value / window[index]));
  return standardDeviation(logReturns) * Math.sqrt(intervalsPerDay) * 100;
}

export function calculateDownsideVolatility(values: number[], intervalsPerDay = 96) {
  const window = values.slice(-(intervalsPerDay + 1));
  if (window.length < intervalsPerDay + 1) throw new Error("Downside volatility lacks a full window.");
  const negativeReturns = window.slice(1)
    .map((value, index) => Math.log(value / window[index]))
    .filter((value) => value < 0);
  return negativeReturns.length < 2 ? 0 : standardDeviation(negativeReturns) * Math.sqrt(intervalsPerDay) * 100;
}

export function calculateTrendEfficiency(values: number[], periods: number) {
  const window = values.slice(-(periods + 1));
  if (window.length < periods + 1) throw new Error("Trend efficiency lacks enough observations.");
  const netMove = Math.abs(window.at(-1)! - window[0]);
  const travelled = window.slice(1).reduce((sum, value, index) => sum + Math.abs(value - window[index]), 0);
  return travelled === 0 ? 0 : netMove / travelled;
}

export function calculateReturnStreak(values: number[]) {
  if (values.length < 2) return 0;
  let streak = 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    const direction = Math.sign(values[index] - values[index - 1]);
    if (direction === 0 || (streak !== 0 && Math.sign(streak) !== direction)) break;
    streak += direction;
  }
  return streak;
}

type MamisInput = {
  regime: MarketRegime;
  lastPrice: number;
  ema50: number;
  ema200: number;
  rsi: number;
  priceZScore: number;
  volumeRatio: number;
  volumeZScore: number;
  adx: number;
  plusDi: number;
  minusDi: number;
  return1h: number;
  return4h: number;
  return24h: number;
  return7d: number;
  return30d: number;
  macdHistogram: number;
};

export function classifyMamisPhase(input: MamisInput): { phase: MamisPhase; confidence: number; evidence: string[] } {
  const phases = [
    "returning_confidence", "buy_the_dip", "enthusiasm", "disbelief", "panic",
    "discouragement", "wall_of_worry", "anxiety", "aversion", "denial",
  ] as const;
  const scores = Object.fromEntries(phases.map((phase) => [phase, { score: 0, evidence: [] as string[] }])) as Record<(typeof phases)[number], { score: number; evidence: string[] }>;
  const add = (phase: (typeof phases)[number], condition: boolean, weight: number, evidence: string) => {
    if (condition) {
      scores[phase].score += weight;
      scores[phase].evidence.push(evidence);
    }
  };

  add("enthusiasm", input.regime === "bull_trend", 1.2, "established bull trend");
  add("enthusiasm", input.priceZScore >= 1.4, 1, "price materially extended above its recent mean");
  add("enthusiasm", input.rsi >= 67, 0.8, "high momentum reading");
  add("enthusiasm", input.volumeRatio >= 1.2, 0.6, "above-normal participation");

  add("buy_the_dip", input.regime === "bull_trend", 1.2, "primary trend remains positive");
  add("buy_the_dip", input.return1h < 0 && input.return24h > 0, 1, "short pullback inside a positive day");
  add("buy_the_dip", input.priceZScore < 0 && input.lastPrice > input.ema200, 0.8, "discounted locally while above the long trend");

  add("returning_confidence", input.return4h > 0 && input.return24h > 0, 1, "short and daily momentum have turned positive");
  add("returning_confidence", input.lastPrice > input.ema50 && input.return30d < 0, 1.2, "price recovered above the medium trend while the long lookback remains damaged");
  add("returning_confidence", input.macdHistogram > 0 && input.plusDi > input.minusDi, 0.8, "momentum and directional movement are improving together");

  add("disbelief", input.regime !== "bull_trend" && input.return1h > 0 && input.return24h < 0, 1.2, "rebound is occurring inside a weak daily structure");
  add("disbelief", input.lastPrice < input.ema200 && input.plusDi > input.minusDi, 1, "buyers improved before the long trend was reclaimed");

  add("panic", input.return24h < 0 && input.priceZScore <= -1.6, 1.2, "price is deeply below its recent mean during a negative day");
  add("panic", input.volumeZScore >= 1.2, 0.9, "abnormal trading participation");
  add("panic", input.adx >= 25 && input.minusDi > input.plusDi, 1.1, "strong directional selling pressure");

  add("discouragement", input.return7d < 0 && input.return30d < 0, 1.2, "weekly and monthly returns remain negative");
  add("discouragement", input.adx < 22 && input.volumeRatio < 1, 1, "downtrend participation and directional strength have faded");
  add("discouragement", input.rsi >= 35 && input.rsi <= 55, 0.6, "momentum is subdued rather than capitulating");

  add("wall_of_worry", input.regime === "bull_trend" && input.rsi >= 45 && input.rsi <= 65, 1.2, "orderly bull trend without extreme momentum");
  add("wall_of_worry", input.priceZScore >= -0.3 && input.priceZScore <= 1, 0.8, "price is advancing without statistical extension");
  add("wall_of_worry", input.volumeRatio >= 0.7 && input.volumeRatio <= 1.4, 0.6, "participation is balanced");

  add("anxiety", input.regime === "transition" && input.return30d > 0, 1, "a previously positive long window has entered transition");
  add("anxiety", input.return4h < 0 && input.minusDi > input.plusDi, 1, "short-term selling pressure is increasing");

  add("aversion", input.return30d < 0 && input.rsi < 42, 1, "long-window losses coexist with weak momentum");
  add("aversion", input.volumeRatio < 0.8 && input.regime !== "bull_trend", 1, "participation is depressed outside a bull trend");

  add("denial", input.regime === "bear_trend" && input.return30d > 0, 1.2, "bear trend conflicts with a still-positive monthly return");
  add("denial", input.return24h < 0 && input.lastPrice < input.ema50, 0.9, "daily weakness has broken the medium trend");

  const ranked = phases.map((phase) => ({ phase, ...scores[phase] })).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const margin = best.score - ranked[1].score;
  if (best.score < 1.8 || margin < 0.25) {
    return { phase: "uncertain", confidence: round(clamp(best.score / 4) * 0.7, 3), evidence: best.evidence };
  }
  return { phase: best.phase, confidence: round(clamp((best.score + margin) / 4), 3), evidence: best.evidence };
}

export function stabilizeMamisPhases(
  current: Record<TradeAsset, MarketIndicatorState>,
  previous: Record<TradeAsset, MarketIndicatorState> | null,
) {
  if (!previous) return current;
  return Object.fromEntries((Object.keys(current) as TradeAsset[]).map((asset) => {
    const latest = current[asset];
    const prior = previous[asset];
    if (!prior?.mamis_phase || latest.mamis_phase === prior.mamis_phase || latest.mamis_confidence >= 0.75) return [asset, latest];
    return [asset, {
      ...latest,
      mamis_phase: prior.mamis_phase,
      mamis_confidence: round(Math.max(0.5, prior.mamis_confidence - 0.1), 3),
      mamis_evidence: [...latest.mamis_evidence, "phase transition held for one more cycle by hysteresis"],
    }];
  })) as Record<TradeAsset, MarketIndicatorState>;
}

export function classifyRegime(input: RegimeInput): { regime: MarketRegime; trendScore: number } {
  const votes = [
    input.lastPrice > input.ema50 ? 1 : -1,
    input.lastPrice > input.ema200 ? 1 : -1,
    input.ema9 > input.ema21 ? 1 : -1,
    input.return4h > 0 ? 1 : -1,
    input.return24h > 0 ? 1 : -1,
    input.plusDi > input.minusDi ? 1 : -1,
  ];
  const trendScore = votes.reduce((sum, vote) => sum + vote, 0) / votes.length;
  if (input.adx >= 20 && trendScore >= 1 / 3) return { regime: "bull_trend", trendScore };
  if (input.adx >= 20 && trendScore <= -1 / 3) return { regime: "bear_trend", trendScore };
  if (input.adx < 20 && input.bbWidthPercentile !== undefined && input.bbWidthPercentile <= 0.2) {
    return { regime: "compression", trendScore };
  }
  if (input.adx < 20 && Math.abs(input.priceZScore) <= 1.5) return { regime: "range", trendScore };
  return { regime: "transition", trendScore };
}

export function buildTechnicalState(
  candles: Candle[],
  hourlyCandles: Candle[],
  fourHourlyCandles: Candle[],
) {
  if (candles.length < 201 || hourlyCandles.length < 169 || fourHourlyCandles.length < 181) {
    throw new Error("Insufficient multi-timeframe candles.");
  }
  const closes = candles.map((candle) => candle.close);
  const hourlyCloses = hourlyCandles.map((candle) => candle.close);
  const fourHourlyCloses = fourHourlyCandles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const ema9 = calculateEmaSeries(closes, 9);
  const ema21 = calculateEmaSeries(closes, 21);
  const ema50 = calculateEmaSeries(closes, 50);
  const ema200 = calculateEmaSeries(closes, 200);
  const bollinger = calculateBollinger(closes);
  const atr = calculateAtr(highs, lows, closes);
  const directional = calculateAdx(highs, lows, closes);
  const hourlyBandWidths = hourlyCloses
    .map((_, index) => index >= 19 ? calculateBollinger(hourlyCloses.slice(0, index + 1)).widthPct : null)
    .filter((value): value is number => value !== null)
    .slice(-168);
  const hourlyBandWidth = hourlyBandWidths.at(-1) ?? bollinger.widthPct;
  const bbWidthPercentile7d = percentileRank(hourlyBandWidths, hourlyBandWidth);
  const return4h = percentageReturn(closes, 16);
  const return24h = percentageReturn(closes, 96);
  const regime = classifyRegime({
    lastPrice: closes.at(-1)!, ema9: ema9.at(-1)!, ema21: ema21.at(-1)!,
    ema50: ema50.at(-1)!, ema200: ema200.at(-1)!, return4h, return24h,
    adx: directional.adx, plusDi: directional.plusDi, minusDi: directional.minusDi,
    priceZScore: bollinger.zScore, bbWidthPercentile: bbWidthPercentile7d,
  });
  const recentTurnover = candles.at(-1)!.turnover;
  const previousTurnovers = candles.slice(-21, -1).map((candle) => candle.turnover);
  const averageTurnover = previousTurnovers.reduce((sum, value) => sum + value, 0) / previousTurnovers.length;
  const turnoverDeviation = standardDeviation(previousTurnovers);
  const last24hCandles = candles.slice(-96);
  const vwapVolume = last24hCandles.reduce((sum, candle) => sum + candle.volume, 0);
  const sessionVwap = vwapVolume > 0
    ? last24hCandles.reduce((sum, candle) => sum + candle.turnover, 0) / vwapVolume
    : closes.at(-1)!;
  const recentWindow = closes.slice(-17);
  const recentChanges = recentWindow.slice(1).map((value, index) => value - recentWindow[index]);
  const upFraction4h = recentChanges.filter((value) => value > 0).length / recentChanges.length;
  const twentyDayPeak = Math.max(...fourHourlyCloses.slice(-120));
  const return1h = percentageReturn(closes, 4);
  const return7d = percentageReturn(hourlyCloses, 168);
  const return30d = percentageReturn(fourHourlyCloses, 180);
  const macdHistogram = calculateMacdHistogram(closes);
  const volumeRatio = averageTurnover > 0 ? recentTurnover / averageTurnover : 1;
  const volumeZScore = turnoverDeviation > 0 ? (recentTurnover - averageTurnover) / turnoverDeviation : 0;
  const rsi = calculateRsi(closes);
  const lastPrice = closes.at(-1)!;
  const channel24h = channelState(candles.slice(-97, -1), lastPrice, atr);
  const channel3d = channelState(hourlyCandles.slice(-73, -1), lastPrice, atr);
  const channel7d = channelState(hourlyCandles.slice(-169, -1), lastPrice, atr);
  const lastCandle = candles.at(-1)!;
  const mamis = classifyMamisPhase({
    regime: regime.regime,
    lastPrice: closes.at(-1)!,
    ema50: ema50.at(-1)!,
    ema200: ema200.at(-1)!,
    rsi,
    priceZScore: bollinger.zScore,
    volumeRatio,
    volumeZScore,
    adx: directional.adx,
    plusDi: directional.plusDi,
    minusDi: directional.minusDi,
    return1h,
    return4h,
    return24h,
    return7d,
    return30d,
    macdHistogram,
  });
  return {
    lastClosed15mAt: candles.at(-1)!.closeTime,
    return_15m_pct: round(percentageReturn(closes, 1), 4), return_1h_pct: round(return1h, 4),
    return_4h_pct: round(return4h, 4), return_24h_pct: round(return24h, 4),
    return_7d_pct: round(return7d, 4), return_30d_pct: round(return30d, 4),
    ema_9: round(ema9.at(-1)!, 4), ema_21: round(ema21.at(-1)!, 4),
    ema_50: round(ema50.at(-1)!, 4), ema_200: round(ema200.at(-1)!, 4),
    ema_50_slope_3h_pct: round(((ema50.at(-1)! / ema50.at(-13)!) - 1) * 100, 4),
    rsi_14: round(rsi, 3), atr_14: round(atr, 4), atr_14_pct: round((atr / closes.at(-1)!) * 100, 4),
    bb_upper: round(bollinger.upper, 4), bb_lower: round(bollinger.lower, 4),
    bb_width_pct: round(bollinger.widthPct, 3), bb_position: round(bollinger.position, 4),
    macd_hist: round(macdHistogram, 6),
    realized_volatility_24h_pct: round(calculateRealizedVolatility(closes), 4),
    downside_volatility_24h_pct: round(calculateDownsideVolatility(closes), 4),
    volume_ratio_20: round(volumeRatio, 4), volume_zscore_20: round(volumeZScore, 4),
    price_zscore_20: round(bollinger.zScore, 4),
    distance_vwap_24h_pct: round(((closes.at(-1)! / sessionVwap) - 1) * 100, 4),
    trend_efficiency_4h: round(calculateTrendEfficiency(closes, 16), 4),
    up_fraction_4h: round(upFraction4h, 4), return_streak_15m: calculateReturnStreak(closes),
    drawdown_20d_pct: round(twentyDayPeak > 0 ? ((closes.at(-1)! / twentyDayPeak) - 1) * 100 : 0, 4),
    channel_24h_high: round(channel24h.high, 4), channel_24h_low: round(channel24h.low, 4),
    channel_24h_position: round(channel24h.position, 4),
    channel_3d_high: round(channel3d.high, 4), channel_3d_low: round(channel3d.low, 4),
    channel_3d_position: round(channel3d.position, 4),
    channel_7d_high: round(channel7d.high, 4), channel_7d_low: round(channel7d.low, 4),
    channel_7d_position: round(channel7d.position, 4),
    distance_to_24h_high_atr: round(channel24h.distanceToHighAtr, 4),
    distance_to_24h_low_atr: round(channel24h.distanceToLowAtr, 4),
    breakout_24h_pct: round(channel24h.breakoutPct, 4),
    bb_width_percentile_7d: round(bbWidthPercentile7d, 4),
    candle_body_atr: round(atr > 0 ? Math.abs(lastCandle.close - lastCandle.open) / atr : 0, 4),
    upper_wick_atr: round(atr > 0 ? (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) / atr : 0, 4),
    lower_wick_atr: round(atr > 0 ? (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) / atr : 0, 4),
    structure_12h: classifySwingStructure(hourlyCandles),
    adx_14: round(directional.adx, 3), plus_di_14: round(directional.plusDi, 3),
    minus_di_14: round(directional.minusDi, 3), trend_score: round(regime.trendScore, 4),
    regime: regime.regime,
    mamis_phase: mamis.phase,
    mamis_confidence: mamis.confidence,
    mamis_evidence: mamis.evidence,
  };
}

export class MarketDataAggregator {
  private readonly client = getMainnetMarketClient();

  async fetchAll(): Promise<Record<TradeAsset, MarketIndicatorState>> {
    const states = await Promise.all((Object.keys(SYMBOLS) as TradeAsset[]).map(async (asset) => [asset, await this.fetchSymbolState(SYMBOLS[asset])] as const));
    const record = Object.fromEntries(states) as Record<TradeAsset, MarketIndicatorState>;
    const btcReturn = record.BTC.return_24h_pct;
    for (const asset of Object.keys(record) as TradeAsset[]) {
      record[asset].relative_strength_vs_btc_24h_pct = round(record[asset].return_24h_pct - btcReturn, 3);
    }
    return record;
  }

  async fetchSymbolState(symbol: string): Promise<MarketIndicatorState> {
    const [technical, orderbook, ticker, derivatives, tradeFlow] = await Promise.all([
      this.getTechnicalState(symbol), this.getOrderbookState(symbol), this.getTickerState(symbol), this.getDerivativeState(symbol), this.getTradeFlowState(symbol),
    ]);
    const reboundScore =
      (technical.return_15m_pct > 0 ? 0.16 : 0) +
      (technical.return_1h_pct > 0 ? 0.16 : 0) +
      clamp((45 - technical.rsi_14) / 25) * 0.14 +
      clamp((-technical.price_zscore_20) / 2) * 0.14 +
      (technical.macd_hist > 0 ? 0.12 : 0) +
      clamp(orderbook.orderbook_imbalance / 0.2) * 0.14 +
      clamp((technical.volume_ratio_20 - 0.8) / 1.2) * 0.14;
    const { sourceTime: tickerSourceTime, ...tickerState } = ticker;
    const { sourceTime: orderbookSourceTime, ...orderbookState } = orderbook;
    const { lastClosed15mAt, ...technicalState } = technical;
    const collectedTime = Date.now();
    assertFreshMarketTimestamps(tickerSourceTime, orderbookSourceTime, lastClosed15mAt, collectedTime);
    const collectedAt = new Date(collectedTime).toISOString();
    const observedAt = new Date(Math.min(tickerSourceTime, orderbookSourceTime)).toISOString();
    return {
      symbol,
      source: "bybit-mainnet",
      collected_at: collectedAt,
      observed_at: observedAt,
      ticker_at: new Date(tickerSourceTime).toISOString(),
      orderbook_at: new Date(orderbookSourceTime).toISOString(),
      last_closed_15m_at: new Date(lastClosed15mAt).toISOString(),
      ...tickerState, ...technicalState, ...orderbookState, ...derivatives, ...tradeFlow,
      relative_strength_vs_btc_24h_pct: 0,
      countertrend_rebound_score: round(reboundScore, 4),
      data_quality: derivatives.open_interest_usdt_estimate === null ? "spot_only" : "complete",
    };
  }

  private async getTickerState(symbol: string) {
    const response = await this.client.getTickers({ category: "spot", symbol });
    assertResponse(response, `Ticker request for ${symbol}`);
    const ticker = response.result.list[0];
    if (!ticker) throw new Error(`Ticker is unavailable for ${symbol}.`);
    return {
      sourceTime: Number(response.time),
      last_price: Number(ticker.lastPrice),
      change_24h_pct: round(Number(ticker.price24hPcnt) * 100, 3),
      turnover_24h_usdt: round(Number(ticker.turnover24h), 2),
    };
  }

  private async getTechnicalState(symbol: string) {
    const [fifteenMinuteResponse, hourlyResponse, fourHourlyResponse] = await Promise.all([
      this.client.getKline({ category: "spot", symbol, interval: "15", limit: 240 }),
      this.client.getKline({ category: "spot", symbol, interval: "60", limit: 200 }),
      this.client.getKline({ category: "spot", symbol, interval: "240", limit: 200 }),
    ]);
    assertResponse(fifteenMinuteResponse, `15-minute kline request for ${symbol}`);
    assertResponse(hourlyResponse, `Hourly kline request for ${symbol}`);
    assertResponse(fourHourlyResponse, `Four-hour kline request for ${symbol}`);
    const candles = parseClosedCandles(fifteenMinuteResponse.result.list, 15, Number(fifteenMinuteResponse.time));
    const hourlyCandles = parseClosedCandles(hourlyResponse.result.list, 60, Number(hourlyResponse.time));
    const fourHourlyCandles = parseClosedCandles(fourHourlyResponse.result.list, 240, Number(fourHourlyResponse.time));
    try {
      return buildTechnicalState(candles, hourlyCandles, fourHourlyCandles);
    } catch (error) {
      throw new Error(`${symbol} returned insufficient or invalid multi-timeframe candles.`, { cause: error });
    }
  }

  private async getOrderbookState(symbol: string) {
    const response = await this.client.getOrderbook({ category: "spot", symbol, limit: 50 });
    assertResponse(response, `Orderbook request for ${symbol}`);
    const bids = response.result.b;
    const asks = response.result.a;
    if (!bids.length || !asks.length) throw new Error(`Orderbook is empty for ${symbol}.`);
    const bestBid = Number(bids[0][0]);
    const bestAsk = Number(asks[0][0]);
    const midpoint = (bestBid + bestAsk) / 2;
    const totalBid = bids.reduce((sum, bid) => sum + Number(bid[0]) * Number(bid[1]), 0);
    const totalAsk = asks.reduce((sum, ask) => sum + Number(ask[0]) * Number(ask[1]), 0);
    const depth = totalBid + totalAsk;
    return {
      sourceTime: Number(response.result.cts || response.result.ts || response.time),
      bid_ask_spread_pct: round(((bestAsk - bestBid) / midpoint) * 100, 5),
      orderbook_imbalance: round(depth > 0 ? (totalBid - totalAsk) / depth : 0, 4),
      bid_depth_50_usdt: round(totalBid, 2),
      ask_depth_50_usdt: round(totalAsk, 2),
      depth_ratio: round(totalAsk > 0 ? totalBid / totalAsk : 0, 4),
    };
  }

  private async getTradeFlowState(symbol: string) {
    try {
      const response = await this.client.getPublicTradingHistory({ category: "spot", symbol, limit: 1_000 });
      assertResponse(response, `Recent trades request for ${symbol}`);
      let buyNotional = 0;
      let sellNotional = 0;
      const tradeTimes: number[] = [];
      for (const trade of response.result.list) {
        const notional = Number(trade.price) * Number(trade.size);
        if (!Number.isFinite(notional)) continue;
        const tradeTime = Number(trade.time);
        if (Number.isFinite(tradeTime)) tradeTimes.push(tradeTime);
        if (trade.side === "Buy") buyNotional += notional;
        else sellNotional += notional;
      }
      const total = buyNotional + sellNotional;
      return {
        taker_buy_ratio: total > 0 ? round(buyNotional / total, 4) : null,
        trade_flow_imbalance: total > 0 ? round((buyNotional - sellNotional) / total, 4) : null,
        trade_flow_window_seconds: tradeTimes.length >= 2
          ? round((Math.max(...tradeTimes) - Math.min(...tradeTimes)) / 1_000, 1)
          : null,
      };
    } catch {
      return { taker_buy_ratio: null, trade_flow_imbalance: null, trade_flow_window_seconds: null };
    }
  }

  private async getDerivativeState(symbol: string) {
    try {
      const [openInterestResponse, fundingResponse, tickerResponse] = await Promise.all([
        this.client.getOpenInterest({ category: "linear", symbol, intervalTime: "5min", limit: 50 }),
        this.client.getFundingRateHistory({ category: "linear", symbol, limit: 1 }),
        this.client.getTickers({ category: "linear", symbol }),
      ]);
      assertResponse(openInterestResponse, `Open interest request for ${symbol}`);
      assertResponse(fundingResponse, `Funding request for ${symbol}`);
      assertResponse(tickerResponse, `Linear ticker request for ${symbol}`);
      const oi = openInterestResponse.result.list.map((item) => Number(item.openInterest));
      const latest = oi[0];
      const oneHour = oi[12];
      const fourHour = oi[48];
      const markPrice = Number(tickerResponse.result.list[0]?.markPrice);
      const fundingRate = Number(fundingResponse.result.list[0]?.fundingRate);
      if (![latest, oneHour, fourHour, markPrice, fundingRate].every(Number.isFinite) || oneHour === 0 || fourHour === 0) throw new Error("Incomplete derivative data");
      return { open_interest_usdt_estimate: round(latest * markPrice, 2), open_interest_change_1h_pct: round(((latest / oneHour) - 1) * 100, 4), open_interest_change_4h_pct: round(((latest / fourHour) - 1) * 100, 4), funding_rate_latest_pct: round(fundingRate * 100, 6) };
    } catch {
      return { open_interest_usdt_estimate: null, open_interest_change_1h_pct: null, open_interest_change_4h_pct: null, funding_rate_latest_pct: null };
    }
  }
}
