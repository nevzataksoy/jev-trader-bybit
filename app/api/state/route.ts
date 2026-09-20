import { NextResponse } from "next/server";
import { getAccountEnvironment, getTradingConfig } from "@/lib/config";
import {
  ensureDatabase,
  getDailyPortfolioHistory,
  getRecentRuns,
  getStoredOrders,
  isDatabaseConfigured,
  upsertOrders,
} from "@/lib/db";
import {
  getSpotActivity,
  getSpotBalances,
  getSpotPrices,
  hasBybitCredentials,
} from "@/lib/providers/bybit";
import { getSafeErrorMessage } from "@/lib/errors";
import type { DashboardState, OrderHistoryItem, SpotBalance, TickerPrices } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyPrices: TickerPrices = { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 };
const emptyBalances: SpotBalance[] = ["USDT", "BTC", "ETH", "XAUT"].map((coin) => ({
  coin: coin as SpotBalance["coin"],
  free: 0,
  locked: 0,
  total: 0,
  usdtValue: 0,
}));

function mergeOrders(stored: OrderHistoryItem[], live: OrderHistoryItem[]) {
  const merged = new Map(stored.map((order) => [order.orderId, order]));
  for (const order of live) merged.set(order.orderId, order);
  return [...merged.values()].sort((a, b) => Number(b.createdTime) - Number(a.createdTime));
}

export async function GET(request: Request) {
  const language = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "tr";
  const historyTimeZone = language === "tr" ? "Europe/Istanbul" : "UTC";
  let prices = emptyPrices;
  let balances = emptyBalances;
  let liveOrders: OrderHistoryItem[] = [];
  let openOrders: OrderHistoryItem[] = [];
  let bybitStatus: DashboardState["connection"]["bybit"] = hasBybitCredentials()
    ? "error"
    : "not_configured";
  let databaseStatus: DashboardState["connection"]["database"] = isDatabaseConfigured()
    ? "error"
    : "not_configured";
  const messages: string[] = [];

  try {
    prices = await getSpotPrices();
    if (hasBybitCredentials()) {
      const [wallet, activity] = await Promise.all([getSpotBalances(prices), getSpotActivity()]);
      balances = wallet;
      liveOrders = activity.orders;
      openOrders = activity.openOrders;
      bybitStatus = "connected";
    } else {
      messages.push("Bybit credentials are not configured.");
    }
  } catch (error) {
    messages.push(getSafeErrorMessage(error, "Bybit connection failed."));
  }

  let history: DashboardState["history"] = [];
  let storedOrders: OrderHistoryItem[] = [];
  let recentRuns: DashboardState["recentRuns"] = [];
  if (isDatabaseConfigured()) {
    try {
      await ensureDatabase();
      await upsertOrders(liveOrders);
      [history, storedOrders, recentRuns] = await Promise.all([
        getDailyPortfolioHistory(90, historyTimeZone),
        getStoredOrders(),
        getRecentRuns(),
      ]);
      databaseStatus = "connected";
    } catch (error) {
      messages.push(getSafeErrorMessage(error, "Database connection failed."));
    }
  } else {
    messages.push("DATABASE_URL is not configured; historical charts are unavailable.");
  }

  const payload: DashboardState = {
    generatedAt: new Date().toISOString(),
    accountEnvironment: getAccountEnvironment(),
    marketSource: "bybit-mainnet",
    tradingEnabled: getTradingConfig().enabled,
    balances,
    prices,
    openOrders,
    orders: mergeOrders(storedOrders, liveOrders),
    history,
    recentRuns,
    connection: {
      bybit: bybitStatus,
      database: databaseStatus,
      message: messages.length ? messages.join(" ") : null,
    },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
