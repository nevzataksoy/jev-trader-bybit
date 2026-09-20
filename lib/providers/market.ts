import { SYMBOLS } from "../config";
import type { MarketIndicatorState, MarketRegime, TradeAsset } from "../types";
import { getMainnetMarketClient } from "./bybit";

type Candle = { high: number; low: number; close: number; turnover: number };
type RegimeInput = {
  lastPrice: number; ema9: number; ema21: number; ema50: number; ema200: number;
  return4h: number; return24h: number; adx: number; plusDi: number; minusDi: number;
  priceZScore: number;
};

function assertResponse(response: { retCode: number; retMsg: string }, operation: string) {
  if (response.retCode !== 0) throw new Error(`${operation} failed [${response.retCode}]: ${response.retMsg}`);
}

function round(value: number, digits = 4) { return Number(value.toFixed(digits)); }
function clamp(value: number, minimum = 0, maximum = 1) { return Math.min(maximum, Math.max(minimum, value)); }

function parseCandles(list: string[][]): Candle[] {
  return [...list].reverse().map((candle) => ({
    high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]),
    turnover: Number(candle[6]),
  }));
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
  if (input.adx < 20 && Math.abs(input.priceZScore) <= 1.5) return { regime: "range", trendScore };
  return { regime: "transition", trendScore };
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
    const [technical, orderbook, ticker, derivatives] = await Promise.all([
      this.getTechnicalState(symbol), this.getOrderbookState(symbol), this.getTickerState(symbol), this.getDerivativeState(symbol),
    ]);
    const reboundScore =
      (technical.return_15m_pct > 0 ? 0.16 : 0) +
      (technical.return_1h_pct > 0 ? 0.16 : 0) +
      clamp((45 - technical.rsi_14) / 25) * 0.14 +
      clamp((-technical.price_zscore_20) / 2) * 0.14 +
      (technical.macd_hist > 0 ? 0.12 : 0) +
      clamp(orderbook.orderbook_imbalance / 0.2) * 0.14 +
      clamp((technical.volume_ratio_20 - 0.8) / 1.2) * 0.14;
    return {
      symbol, source: "bybit-mainnet", observed_at: new Date().toISOString(),
      ...ticker, ...technical, ...orderbook, ...derivatives,
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
    return { last_price: Number(ticker.lastPrice), change_24h_pct: round(Number(ticker.price24hPcnt) * 100, 3), turnover_24h_usdt: round(Number(ticker.turnover24h), 2) };
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
    const candles = parseCandles(fifteenMinuteResponse.result.list);
    const hourlyCandles = parseCandles(hourlyResponse.result.list);
    const fourHourlyCandles = parseCandles(fourHourlyResponse.result.list);
    if (candles.length < 201 || hourlyCandles.length < 169 || fourHourlyCandles.length < 181) throw new Error(`${symbol} returned insufficient multi-timeframe candles.`);
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
    const return4h = percentageReturn(closes, 16);
    const return24h = percentageReturn(closes, 96);
    const regime = classifyRegime({ lastPrice: closes.at(-1)!, ema9: ema9.at(-1)!, ema21: ema21.at(-1)!, ema50: ema50.at(-1)!, ema200: ema200.at(-1)!, return4h, return24h, adx: directional.adx, plusDi: directional.plusDi, minusDi: directional.minusDi, priceZScore: bollinger.zScore });
    const recentTurnover = candles.at(-1)!.turnover;
    const previousTurnovers = candles.slice(-21, -1).map((candle) => candle.turnover);
    const averageTurnover = previousTurnovers.reduce((sum, value) => sum + value, 0) / previousTurnovers.length;
    return {
      return_15m_pct: round(percentageReturn(closes, 1), 4), return_1h_pct: round(percentageReturn(closes, 4), 4),
      return_4h_pct: round(return4h, 4), return_24h_pct: round(return24h, 4),
      return_7d_pct: round(percentageReturn(hourlyCloses, 168), 4), return_30d_pct: round(percentageReturn(fourHourlyCloses, 180), 4),
      ema_9: round(ema9.at(-1)!, 4), ema_21: round(ema21.at(-1)!, 4), ema_50: round(ema50.at(-1)!, 4), ema_200: round(ema200.at(-1)!, 4),
      ema_50_slope_3h_pct: round(((ema50.at(-1)! / ema50.at(-13)!) - 1) * 100, 4),
      rsi_14: round(calculateRsi(closes), 3), atr_14: round(atr, 4), atr_14_pct: round((atr / closes.at(-1)!) * 100, 4),
      bb_upper: round(bollinger.upper, 4), bb_lower: round(bollinger.lower, 4), bb_width_pct: round(bollinger.widthPct, 3), bb_position: round(bollinger.position, 4),
      macd_hist: round(calculateMacdHistogram(closes), 6), realized_volatility_24h_pct: round(calculateRealizedVolatility(closes), 4),
      volume_ratio_20: round(averageTurnover > 0 ? recentTurnover / averageTurnover : 1, 4), price_zscore_20: round(bollinger.zScore, 4),
      adx_14: round(directional.adx, 3), plus_di_14: round(directional.plusDi, 3), minus_di_14: round(directional.minusDi, 3),
      trend_score: round(regime.trendScore, 4), regime: regime.regime,
    };
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
    return { bid_ask_spread_pct: round(((bestAsk - bestBid) / midpoint) * 100, 5), orderbook_imbalance: round(depth > 0 ? (totalBid - totalAsk) / depth : 0, 4), bid_depth_50_usdt: round(totalBid, 2), ask_depth_50_usdt: round(totalAsk, 2) };
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
