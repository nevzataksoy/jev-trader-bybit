import { getMainnetMarketClient } from "./bybit";
import type { MarketIndicatorState, TradeAsset } from "../types";
import { SYMBOLS } from "../config";

function assertResponse(response: { retCode: number; retMsg: string }, operation: string) {
  if (response.retCode !== 0) {
    throw new Error(`${operation} failed [${response.retCode}]: ${response.retMsg}`);
  }
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
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
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
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
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
  const deviation = Math.sqrt(variance);
  const upper = mean + deviation * multiplier;
  const lower = mean - deviation * multiplier;
  return { upper, lower, widthPct: ((upper - lower) / mean) * 100 };
}

export function calculateAtr(highs: number[], lows: number[], closes: number[], period = 14) {
  if (closes.length <= period) throw new Error("ATR does not have enough candles.");
  const trueRanges: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    trueRanges.push(
      Math.max(
        highs[index] - lows[index],
        Math.abs(highs[index] - closes[index - 1]),
        Math.abs(lows[index] - closes[index - 1]),
      ),
    );
  }
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const range of trueRanges.slice(period)) {
    atr = (atr * (period - 1) + range) / period;
  }
  return atr;
}

async function getFearAndGreed(): Promise<number | null> {
  try {
    const response = await fetch("https://api.alternative.me/fng/?limit=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: Array<{ value?: string }> };
    const value = Number(data.data?.[0]?.value);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export class MarketDataAggregator {
  private readonly client = getMainnetMarketClient();

  async fetchAll(): Promise<Record<TradeAsset, MarketIndicatorState>> {
    const fearAndGreedPromise = getFearAndGreed();
    const states = await Promise.all(
      (Object.keys(SYMBOLS) as TradeAsset[]).map(async (asset) => [
        asset,
        await this.fetchSymbolState(SYMBOLS[asset], await fearAndGreedPromise),
      ] as const),
    );
    return Object.fromEntries(states) as Record<TradeAsset, MarketIndicatorState>;
  }

  async fetchSymbolState(symbol: string, fearAndGreed: number | null): Promise<MarketIndicatorState> {
    const [technical, orderbook, ticker, derivatives] = await Promise.all([
      this.getTechnicalState(symbol),
      this.getOrderbookState(symbol),
      this.getTickerState(symbol),
      this.getDerivativeState(symbol),
    ]);

    return {
      symbol,
      source: "bybit-mainnet",
      observed_at: new Date().toISOString(),
      ...ticker,
      ...technical,
      ...orderbook,
      ...derivatives,
      fear_and_greed: fearAndGreed,
      data_quality:
        fearAndGreed === null || derivatives.open_interest_usdt_estimate === null
          ? "partial"
          : "complete",
    };
  }

  private async getTickerState(symbol: string) {
    const response = await this.client.getTickers({ category: "spot", symbol });
    assertResponse(response, `Ticker request for ${symbol}`);
    const ticker = response.result.list[0];
    if (!ticker) throw new Error(`Ticker is unavailable for ${symbol}.`);
    return {
      last_price: Number(ticker.lastPrice),
      change_24h_pct: round(Number(ticker.price24hPcnt) * 100, 3),
      turnover_24h_usdt: round(Number(ticker.turnover24h), 2),
    };
  }

  private async getTechnicalState(symbol: string) {
    const response = await this.client.getKline({
      category: "spot",
      symbol,
      interval: "15",
      limit: 200,
    });
    assertResponse(response, `Kline request for ${symbol}`);
    const candles = [...response.result.list].reverse();
    if (candles.length < 200) throw new Error(`${symbol} returned fewer than 200 candles.`);

    const closes = candles.map((candle) => Number(candle[4]));
    const highs = candles.map((candle) => Number(candle[2]));
    const lows = candles.map((candle) => Number(candle[3]));
    const bollinger = calculateBollinger(closes);

    return {
      ema_9: round(calculateEmaSeries(closes, 9).at(-1)!, 4),
      ema_21: round(calculateEmaSeries(closes, 21).at(-1)!, 4),
      ema_50: round(calculateEmaSeries(closes, 50).at(-1)!, 4),
      ema_200: round(calculateEmaSeries(closes, 200).at(-1)!, 4),
      rsi_14: round(calculateRsi(closes), 3),
      atr_14: round(calculateAtr(highs, lows, closes), 4),
      bb_upper: round(bollinger.upper, 4),
      bb_lower: round(bollinger.lower, 4),
      bb_width_pct: round(bollinger.widthPct, 3),
      macd_hist: round(calculateMacdHistogram(closes), 5),
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
    const totalBid = bids.reduce((sum, bid) => sum + Number(bid[1]), 0);
    const totalAsk = asks.reduce((sum, ask) => sum + Number(ask[1]), 0);
    return {
      bid_ask_spread_pct: round(((bestAsk - bestBid) / midpoint) * 100, 5),
      orderbook_imbalance_ratio: round(totalAsk > 0 ? totalBid / totalAsk : 1, 4),
    };
  }

  private async getDerivativeState(symbol: string) {
    try {
      const [openInterestResponse, fundingResponse, tickerResponse] = await Promise.all([
        this.client.getOpenInterest({ category: "linear", symbol, intervalTime: "5min", limit: 1 }),
        this.client.getFundingRateHistory({ category: "linear", symbol, limit: 1 }),
        this.client.getTickers({ category: "linear", symbol }),
      ]);
      assertResponse(openInterestResponse, `Open interest request for ${symbol}`);
      assertResponse(fundingResponse, `Funding request for ${symbol}`);
      assertResponse(tickerResponse, `Linear ticker request for ${symbol}`);
      const openInterest = Number(openInterestResponse.result.list[0]?.openInterest);
      const markPrice = Number(tickerResponse.result.list[0]?.markPrice);
      const fundingRate = Number(fundingResponse.result.list[0]?.fundingRate);
      if (![openInterest, markPrice, fundingRate].every(Number.isFinite)) throw new Error("Incomplete data");
      return {
        open_interest_usdt_estimate: round(openInterest * markPrice, 2),
        funding_rate_latest_pct: round(fundingRate * 100, 6),
      };
    } catch {
      return {
        open_interest_usdt_estimate: null,
        funding_rate_latest_pct: null,
      };
    }
  }
}
