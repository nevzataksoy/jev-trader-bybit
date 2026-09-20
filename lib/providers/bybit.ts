import { RestClientV5 } from "bybit-api";
import {
  assertLiveTradingAllowed,
  getAccountEnvironment,
  SYMBOLS,
  TARGET_ASSETS,
} from "../config";
import type {
  AssetId,
  FeeRate,
  OrderHistoryItem,
  SpotBalance,
  TickerPrices,
  TradeAsset,
} from "../types";

let accountClient: RestClientV5 | null = null;
let mainnetMarketClient: RestClientV5 | null = null;

function requireCredentials() {
  const key = process.env.BYBIT_API_KEY?.trim();
  const secret = process.env.BYBIT_API_SECRET?.trim();
  if (!key || !secret) {
    throw new Error("BYBIT_API_KEY and BYBIT_API_SECRET must be configured.");
  }
  return { key, secret };
}

export function hasBybitCredentials() {
  return Boolean(process.env.BYBIT_API_KEY?.trim() && process.env.BYBIT_API_SECRET?.trim());
}

export function getBybitAccountClient() {
  if (accountClient) return accountClient;
  const environment = getAccountEnvironment();
  assertLiveTradingAllowed(environment);
  const credentials = requireCredentials();
  accountClient = new RestClientV5({
    ...credentials,
    testnet: environment === "testnet",
    demoTrading: environment === "demo",
  });
  return accountClient;
}

export function getMainnetMarketClient() {
  if (!mainnetMarketClient) {
    mainnetMarketClient = new RestClientV5({ testnet: false });
  }
  return mainnetMarketClient;
}

function assertBybitResponse(response: { retCode: number; retMsg: string }, operation: string) {
  if (response.retCode !== 0) {
    if (response.retCode === 10003) {
      throw new Error(
        `${operation} failed [10003]: API key and Bybit domain do not match. Use BYBIT_ACCOUNT_ENV=demo for api-demo.bybit.com keys or testnet for api-testnet.bybit.com keys.`,
      );
    }
    throw new Error(`${operation} failed [${response.retCode}]: ${response.retMsg}`);
  }
}

export async function getSpotPrices(): Promise<TickerPrices> {
  const response = await getMainnetMarketClient().getTickers({ category: "spot" });
  assertBybitResponse(response, "Mainnet ticker request");

  const prices: TickerPrices = { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 };
  const symbolMap = Object.fromEntries(
    Object.entries(SYMBOLS).map(([asset, symbol]) => [symbol, asset]),
  ) as Record<string, TradeAsset>;

  for (const ticker of response.result.list) {
    const asset = symbolMap[ticker.symbol];
    if (asset) prices[asset] = Number(ticker.lastPrice);
  }

  for (const asset of Object.keys(SYMBOLS) as TradeAsset[]) {
    if (!Number.isFinite(prices[asset]) || prices[asset] <= 0) {
      throw new Error(`Mainnet price is unavailable for ${SYMBOLS[asset]}.`);
    }
  }
  return prices;
}

export async function getSpotBalances(prices?: TickerPrices): Promise<SpotBalance[]> {
  const response = await getBybitAccountClient().getWalletBalance({
    accountType: "UNIFIED",
    coin: TARGET_ASSETS.join(","),
  });
  assertBybitResponse(response, "Configured spot account wallet request");

  const coins = response.result.list[0]?.coin ?? [];
  return TARGET_ASSETS.map((coin) => {
    const source = coins.find((item) => item.coin === coin);
    const locked = Number(source?.locked || 0);
    const borrow = Number(source?.spotBorrow || 0);
    const total = Math.max(0, Number(source?.walletBalance || 0) - borrow);
    const free = Math.max(0, total - locked);
    const price = coin === "USDT" ? 1 : prices?.[coin] ?? 0;
    return {
      coin,
      free,
      locked,
      total,
      usdtValue: total * price,
    };
  });
}

export async function getSpotFeeRates(): Promise<Record<TradeAsset, FeeRate>> {
  const client = getBybitAccountClient();
  const entries = await Promise.all((Object.keys(SYMBOLS) as TradeAsset[]).map(async (asset) => {
    const symbol = SYMBOLS[asset];
    const response = await client.getFeeRate({ category: "spot", symbol });
    assertBybitResponse(response, `Spot fee-rate request for ${symbol}`);
    const fee = response.result.list[0];
    const makerFeePct = Number(fee?.makerFeeRate) * 100;
    const takerFeePct = Number(fee?.takerFeeRate) * 100;
    if (!fee || !Number.isFinite(makerFeePct) || !Number.isFinite(takerFeePct)) {
      throw new Error(`Spot fee rate is unavailable for ${symbol}.`);
    }
    return [asset, { symbol, maker_fee_pct: makerFeePct, taker_fee_pct: takerFeePct }] as const;
  }));
  return Object.fromEntries(entries) as Record<TradeAsset, FeeRate>;
}

type RawOrder = Awaited<ReturnType<RestClientV5["getHistoricOrders"]>>["result"]["list"][number];
type RawExecution = Awaited<ReturnType<RestClientV5["getExecutionList"]>>["result"]["list"][number];

function sumFeeDetail(detail?: Record<string, string>) {
  return Object.values(detail ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function mapOrder(
  order: RawOrder,
  executions: RawExecution[],
  openOrderIds: Set<string>,
): OrderHistoryItem {
  const fills = executions.filter((execution) => execution.orderId === order.orderId);
  const latestFill = fills.reduce<RawExecution | null>((latest, current) => {
    if (!latest || Number(current.execTime) > Number(latest.execTime)) return current;
    return latest;
  }, null);
  const executionFee = fills.reduce((sum, fill) => sum + Number(fill.execFee || 0), 0);
  const detailFee = sumFeeDetail(order.cumFeeDetail);

  return {
    orderId: order.orderId,
    orderLinkId: order.orderLinkId || "",
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    qty: order.qty,
    price: order.price,
    avgPrice: order.avgPrice,
    cumExecQty: order.cumExecQty,
    cumExecValue: order.cumExecValue,
    fee: String(executionFee || detailFee || Number(order.cumExecFee || 0)),
    feeCurrency: latestFill?.feeCurrency || "",
    orderStatus: order.orderStatus,
    createdTime: order.createdTime,
    updatedTime: order.updatedTime,
    executedTime: latestFill?.execTime ?? null,
    isOpen: openOrderIds.has(order.orderId),
  };
}

export async function getSpotActivity() {
  const client = getBybitAccountClient();
  const [openResponse, historyResponse, executionResponse] = await Promise.all([
    client.getActiveOrders({ category: "spot", openOnly: 0, limit: 50 }),
    client.getHistoricOrders({ category: "spot", limit: 50 }),
    client.getExecutionList({ category: "spot", limit: 100 }),
  ]);
  assertBybitResponse(openResponse, "Open spot orders request");
  assertBybitResponse(historyResponse, "Spot order history request");
  assertBybitResponse(executionResponse, "Spot execution history request");

  const allowedSymbols = new Set(Object.values(SYMBOLS));
  const rawOrders = new Map<string, RawOrder>();
  for (const order of [...historyResponse.result.list, ...openResponse.result.list]) {
    if (allowedSymbols.has(order.symbol)) rawOrders.set(order.orderId, order);
  }
  const executions = executionResponse.result.list.filter((item) => allowedSymbols.has(item.symbol));
  const openOrderIds = new Set(openResponse.result.list.map((order) => order.orderId));
  const orders = [...rawOrders.values()]
    .map((order) => mapOrder(order, executions, openOrderIds))
    .sort((a, b) => Number(b.createdTime) - Number(a.createdTime));

  return {
    orders,
    openOrders: orders.filter((order) => order.isOpen),
  };
}

interface InstrumentRules {
  minOrderAmount: number;
  minOrderQty: number;
  basePrecision: string;
}

async function getInstrumentRules(symbol: string): Promise<InstrumentRules> {
  const response = await getBybitAccountClient().getInstrumentsInfo({
    category: "spot",
    symbol,
  });
  assertBybitResponse(response, `Instrument rules request for ${symbol}`);
  const instrument = response.result.list[0];
  if (!instrument || !("lotSizeFilter" in instrument)) {
    throw new Error(`Instrument rules are unavailable for ${symbol}.`);
  }
  const filter = instrument.lotSizeFilter;
  return {
    minOrderAmount: Number(filter.minOrderAmt || 0),
    minOrderQty: Number(filter.minOrderQty || 0),
    basePrecision: filter.basePrecision,
  };
}

export function formatToIncrement(value: number, increment: string) {
  const step = Number(increment);
  if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid increment: ${increment}`);
  const decimals = increment.includes(".") ? increment.replace(/0+$/, "").split(".")[1]?.length ?? 0 : 0;
  const stepped = Math.floor((value + Number.EPSILON) / step) * step;
  return stepped.toFixed(decimals);
}

export async function executeMarketBuy(
  asset: TradeAsset,
  percentage: number,
  minimumUsdt: number,
  orderLinkId: string,
  maxSlippagePct: number,
) {
  const symbol = SYMBOLS[asset];
  const [prices, rules] = await Promise.all([getSpotPrices(), getInstrumentRules(symbol)]);
  const balances = await getSpotBalances(prices);
  const availableUsdt = balances.find((balance) => balance.coin === "USDT")?.free ?? 0;
  const amountToUse = Math.floor(availableUsdt * percentage * 100) / 100;
  const requiredMinimum = Math.max(minimumUsdt, rules.minOrderAmount);
  if (amountToUse < requiredMinimum) {
    throw new Error(`Available buy budget ${amountToUse.toFixed(2)} USDT is below ${requiredMinimum}.`);
  }

  const response = await getBybitAccountClient().submitOrder({
    category: "spot",
    symbol,
    side: "Buy",
    orderType: "Market",
    qty: amountToUse.toFixed(2),
    marketUnit: "quoteCoin",
    isLeverage: 0,
    orderLinkId,
    slippageToleranceType: "Percent",
    slippageTolerance: maxSlippagePct.toFixed(2),
  });
  assertBybitResponse(response, `Market buy for ${symbol}`);
  return response.result;
}

export async function executeMarketSell(
  asset: TradeAsset,
  percentage: number,
  minimumUsdt: number,
  orderLinkId: string,
  maxSlippagePct: number,
) {
  const symbol = SYMBOLS[asset];
  const [prices, rules] = await Promise.all([getSpotPrices(), getInstrumentRules(symbol)]);
  const balances = await getSpotBalances(prices);
  const available = balances.find((balance) => balance.coin === asset)?.free ?? 0;
  const qty = formatToIncrement(available * percentage, rules.basePrecision);
  const numericQty = Number(qty);
  if (numericQty < rules.minOrderQty || numericQty * prices[asset] < Math.max(minimumUsdt, rules.minOrderAmount)) {
    throw new Error(`Available ${asset} balance is below the minimum sell amount.`);
  }

  const response = await getBybitAccountClient().submitOrder({
    category: "spot",
    symbol,
    side: "Sell",
    orderType: "Market",
    qty,
    marketUnit: "baseCoin",
    isLeverage: 0,
    orderLinkId,
    slippageToleranceType: "Percent",
    slippageTolerance: maxSlippagePct.toFixed(2),
  });
  assertBybitResponse(response, `Market sell for ${symbol}`);
  return response.result;
}

export function calculatePortfolioTotal(balances: SpotBalance[]) {
  return balances.reduce((total, balance) => total + balance.usdtValue, 0);
}

export function assetFromSymbol(symbol: string): AssetId | null {
  const match = Object.entries(SYMBOLS).find(([, value]) => value === symbol);
  return (match?.[0] as AssetId | undefined) ?? null;
}
