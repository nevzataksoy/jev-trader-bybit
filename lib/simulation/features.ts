import { SYMBOLS } from "../config";
import { buildMacroState } from "../providers/macro";
import {
  buildTechnicalState,
  stabilizeMamisPhases,
  type Candle,
} from "../providers/market";
import { TRADE_ASSETS, type MacroState, type MarketIndicatorState, type TickerPrices, type TradeAsset } from "../types";
import type { HistoricalAssetData, HistoricalDataset, SimulationConfig } from "./types";

const FIFTEEN_MINUTES = 15 * 60_000;

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function closedAt(candles: Candle[], cycleAt: number) {
  return candles.filter((candle) => candle.closeTime <= cycleAt);
}

function latestAtOrBefore<T extends { timestamp: number }>(points: T[], timestamp: number) {
  let low = 0;
  let high = points.length - 1;
  let result: T | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp <= timestamp) {
      result = points[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function derivativeState(data: HistoricalAssetData, cycleAt: number, spotPrice: number) {
  const latest = latestAtOrBefore(data.openInterest, cycleAt);
  const oneHour = latestAtOrBefore(data.openInterest, cycleAt - 60 * 60_000);
  const fourHour = latestAtOrBefore(data.openInterest, cycleAt - 4 * 60 * 60_000);
  const funding = latestAtOrBefore(data.funding, cycleAt);
  if (!latest || !oneHour || !fourHour || oneHour.openInterest === 0 || fourHour.openInterest === 0) {
    return {
      open_interest_usdt_estimate: null,
      open_interest_change_1h_pct: null,
      open_interest_change_4h_pct: null,
      funding_rate_latest_pct: funding ? round(funding.rate * 100, 6) : null,
    };
  }
  return {
    open_interest_usdt_estimate: round(latest.openInterest * spotPrice, 2),
    open_interest_change_1h_pct: round(((latest.openInterest / oneHour.openInterest) - 1) * 100, 4),
    open_interest_change_4h_pct: round(((latest.openInterest / fourHour.openInterest) - 1) * 100, 4),
    funding_rate_latest_pct: funding ? round(funding.rate * 100, 6) : null,
  };
}

function buildAssetState(data: HistoricalAssetData, cycleAt: number, spreadPct: number): MarketIndicatorState {
  const candles15m = closedAt(data.candles15m, cycleAt);
  const candles1h = closedAt(data.candles1h, cycleAt);
  const candles4h = closedAt(data.candles4h, cycleAt);
  const technical = buildTechnicalState(candles15m, candles1h, candles4h);
  const lastPrice = candles15m.at(-1)!.close;
  const derivatives = derivativeState(data, cycleAt, lastPrice);
  const reboundScore =
    (technical.return_15m_pct > 0 ? 0.16 : 0)
    + (technical.return_1h_pct > 0 ? 0.16 : 0)
    + clamp((45 - technical.rsi_14) / 25) * 0.14
    + clamp((-technical.price_zscore_20) / 2) * 0.14
    + (technical.macd_hist > 0 ? 0.12 : 0)
    + clamp((technical.volume_ratio_20 - 0.8) / 1.2) * 0.14;
  const observedAt = new Date(cycleAt).toISOString();
  const turnover24h = candles15m.slice(-96).reduce((sum, candle) => sum + candle.turnover, 0);
  const { lastClosed15mAt, ...technicalState } = technical;
  return {
    symbol: SYMBOLS[data.asset],
    source: "bybit-mainnet",
    collected_at: observedAt,
    observed_at: observedAt,
    ticker_at: observedAt,
    orderbook_at: observedAt,
    last_closed_15m_at: new Date(lastClosed15mAt).toISOString(),
    last_price: lastPrice,
    change_24h_pct: technical.return_24h_pct,
    turnover_24h_usdt: round(turnover24h, 2),
    ...technicalState,
    relative_strength_vs_btc_24h_pct: 0,
    countertrend_rebound_score: round(reboundScore, 4),
    bid_ask_spread_pct: spreadPct,
    orderbook_imbalance: 0,
    bid_depth_50_usdt: 1_000_000,
    ask_depth_50_usdt: 1_000_000,
    depth_ratio: 1,
    taker_buy_ratio: null,
    trade_flow_imbalance: null,
    trade_flow_window_seconds: null,
    ...derivatives,
    data_quality: derivatives.open_interest_usdt_estimate === null ? "spot_only" : "complete",
    data_provenance: {
      candles: "historical_exact",
      ticker: "historical_derived",
      orderbook: "historical_proxy",
      trade_flow: "unavailable",
      derivatives: derivatives.open_interest_usdt_estimate === null ? "unavailable" : "historical_derived",
    },
  };
}

export function buildCycleMarketState(
  dataset: HistoricalDataset,
  cycleAt: number,
  config: SimulationConfig,
  previous: Record<TradeAsset, MarketIndicatorState> | null,
) {
  const raw = Object.fromEntries(TRADE_ASSETS.map((asset) => [
    asset,
    buildAssetState(dataset.assets[asset], cycleAt, config.spreadPct[asset]),
  ])) as Record<TradeAsset, MarketIndicatorState>;
  const stabilized = stabilizeMamisPhases(raw, previous);
  const btcReturn = stabilized.BTC.return_24h_pct;
  for (const asset of TRADE_ASSETS) {
    stabilized[asset].relative_strength_vs_btc_24h_pct = round(stabilized[asset].return_24h_pct - btcReturn, 3);
  }
  return stabilized;
}

export function buildAsOfMacroState(dataset: HistoricalDataset, cycleAt: number): MacroState | null {
  const conservativeCutoff = new Date(cycleAt - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const rows = dataset.macroRows.filter((row) => row.date <= conservativeCutoff);
  return rows.length ? buildMacroState(rows, new Date(cycleAt)) : null;
}

export function pricesFromMarketState(state: Record<TradeAsset, MarketIndicatorState>): TickerPrices {
  return { USDT: 1, BTC: state.BTC.last_price, ETH: state.ETH.last_price, XAUT: state.XAUT.last_price };
}

export function nextOpenPrices(dataset: HistoricalDataset, cycleAt: number): TickerPrices {
  const prices = { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 } satisfies TickerPrices;
  for (const asset of TRADE_ASSETS) {
    const candle = dataset.assets[asset].candles15m.find((item) => item.startTime === cycleAt);
    if (!candle) throw new Error(`No next-candle open exists for ${asset} at ${new Date(cycleAt).toISOString()}.`);
    prices[asset] = candle.open;
  }
  return prices;
}

export function buildCycleTimes(config: SimulationConfig) {
  const result: number[] = [];
  for (let timestamp = config.startAt + FIFTEEN_MINUTES; timestamp <= config.endAt; timestamp += FIFTEEN_MINUTES) {
    result.push(timestamp);
    if (config.maxCycles !== null && result.length >= config.maxCycles) break;
  }
  return result;
}
