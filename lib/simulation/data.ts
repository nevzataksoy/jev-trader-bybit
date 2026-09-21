import { SYMBOLS } from "../config";
import { getMainnetMarketClient } from "../providers/bybit";
import { parseFredCsv } from "../providers/macro";
import { parseClosedCandles, type Candle } from "../providers/market";
import { TRADE_ASSETS, type TradeAsset } from "../types";
import type {
  HistoricalAssetData,
  HistoricalDataset,
  HistoricalFunding,
  HistoricalOpenInterest,
  SimulationConfig,
} from "./types";

const MINUTE_MS = 60_000;

function assertBybit(response: { retCode: number; retMsg: string }, operation: string) {
  if (response.retCode !== 0) throw new Error(`${operation} failed [${response.retCode}]: ${response.retMsg}`);
}

async function retry<T>(operation: string, task: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw new Error(`${operation} failed after ${attempts} attempts.`, { cause: lastError });
}

export async function fetchHistoricalCandles(
  symbol: string,
  intervalMinutes: 15 | 60 | 240,
  startAt: number,
  endAt: number,
): Promise<Candle[]> {
  const client = getMainnetMarketClient();
  const byStart = new Map<number, Candle>();
  let cursorEnd = endAt - 1;
  while (cursorEnd >= startAt) {
    const response = await retry(`${symbol} ${intervalMinutes}m candles`, () => client.getKline({
      category: "spot",
      symbol,
      interval: String(intervalMinutes) as "15" | "60" | "240",
      start: startAt,
      end: cursorEnd,
      limit: 1_000,
    }));
    assertBybit(response, `${symbol} ${intervalMinutes}m historical kline request`);
    const batch = parseClosedCandles(response.result.list, intervalMinutes, endAt);
    for (const candle of batch) {
      if (candle.startTime >= startAt && candle.closeTime <= endAt) byStart.set(candle.startTime, candle);
    }
    const earliest = Math.min(...response.result.list.map((item) => Number(item[0])).filter(Number.isFinite));
    if (!response.result.list.length || !Number.isFinite(earliest) || earliest <= startAt) break;
    cursorEnd = earliest - 1;
  }
  return [...byStart.values()].sort((left, right) => left.startTime - right.startTime);
}

async function fetchOpenInterest(
  asset: TradeAsset,
  startAt: number,
  endAt: number,
): Promise<HistoricalOpenInterest[]> {
  const client = getMainnetMarketClient();
  const points = new Map<number, HistoricalOpenInterest>();
  let cursor: string | undefined;
  do {
    const response = await retry(`${asset} open interest`, () => client.getOpenInterest({
      category: "linear",
      symbol: SYMBOLS[asset],
      intervalTime: "5min",
      startTime: startAt,
      endTime: endAt,
      limit: 200,
      cursor,
    }));
    assertBybit(response, `${asset} historical open-interest request`);
    for (const item of response.result.list) {
      const timestamp = Number(item.timestamp);
      const openInterest = Number(item.openInterest);
      if (Number.isFinite(timestamp) && Number.isFinite(openInterest)) points.set(timestamp, { timestamp, openInterest });
    }
    cursor = response.result.nextPageCursor || undefined;
  } while (cursor);
  return [...points.values()].sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchFunding(
  asset: TradeAsset,
  startAt: number,
  endAt: number,
): Promise<HistoricalFunding[]> {
  const client = getMainnetMarketClient();
  const response = await retry(`${asset} funding`, () => client.getFundingRateHistory({
    category: "linear",
    symbol: SYMBOLS[asset],
    startTime: startAt,
    endTime: endAt,
    limit: 200,
  }));
  assertBybit(response, `${asset} historical funding request`);
  return response.result.list
    .map((item) => ({ timestamp: Number(item.fundingRateTimestamp), rate: Number(item.fundingRate) }))
    .filter((item) => Number.isFinite(item.timestamp) && Number.isFinite(item.rate))
    .sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchAssetData(asset: TradeAsset, config: SimulationConfig): Promise<HistoricalAssetData> {
  const symbol = SYMBOLS[asset];
  const candleEnd = config.endAt + 15 * MINUTE_MS;
  const [candles15m, candles1h, candles4h] = await Promise.all([
    fetchHistoricalCandles(symbol, 15, config.warmupStartAt, candleEnd),
    fetchHistoricalCandles(symbol, 60, config.warmupStartAt, config.endAt),
    fetchHistoricalCandles(symbol, 240, config.warmupStartAt, config.endAt),
  ]);
  let openInterest: HistoricalOpenInterest[] = [];
  let funding: HistoricalFunding[] = [];
  let derivativeError: string | null = null;
  try {
    [openInterest, funding] = await Promise.all([
      fetchOpenInterest(asset, config.startAt - 5 * 60 * MINUTE_MS, config.endAt),
      fetchFunding(asset, config.startAt - 24 * 60 * MINUTE_MS, config.endAt),
    ]);
  } catch (error) {
    derivativeError = error instanceof Error ? error.message : String(error);
  }
  return { asset, candles15m, candles1h, candles4h, openInterest, funding, derivativeError };
}

async function fetchMacroRows(config: SimulationConfig) {
  const start = new Date(config.startAt - 180 * 24 * 60 * MINUTE_MS);
  const end = new Date(config.endAt);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", "DGS1,DGS2,DGS10,DFII10,T10YIE");
  url.searchParams.set("cosd", startDate);
  url.searchParams.set("coed", endDate);
  const response = await retry("FRED historical macro data", () => fetch(url, {
    headers: { accept: "text/csv" },
    signal: AbortSignal.timeout(15_000),
  }));
  if (!response.ok) throw new Error(`FRED historical request failed with HTTP ${response.status}.`);
  return parseFredCsv(await response.text()).filter((row) => row.date >= startDate && row.date <= endDate);
}

export async function fetchHistoricalDataset(
  config: SimulationConfig,
  onProgress: (message: string) => void = () => undefined,
): Promise<HistoricalDataset> {
  const partial: Partial<Record<TradeAsset, HistoricalAssetData>> = {};
  for (const asset of TRADE_ASSETS) {
    onProgress(`Fetching ${asset} candles and derivative history...`);
    partial[asset] = await fetchAssetData(asset, config);
  }
  onProgress("Fetching point-in-time macro history...");
  const macroRows = await fetchMacroRows(config);
  return {
    fetchedAt: new Date().toISOString(),
    warmupStart: new Date(config.warmupStartAt).toISOString(),
    simulationStart: new Date(config.startAt).toISOString(),
    simulationEnd: new Date(config.endAt).toISOString(),
    assets: partial as Record<TradeAsset, HistoricalAssetData>,
    macroRows,
  };
}
