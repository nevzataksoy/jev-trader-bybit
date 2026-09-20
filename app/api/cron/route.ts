import { NextResponse } from "next/server";
import { getAccountEnvironment, getTradingConfig, SYMBOLS } from "@/lib/config";
import {
  beginBotRun,
  completeBotRun,
  failBotRun,
  savePortfolioSnapshot,
  upsertOrders,
} from "@/lib/db";
import { evaluateTradingState } from "@/lib/jev";
import { getSafeErrorMessage } from "@/lib/errors";
import {
  calculatePortfolioTotal,
  executeMarketBuy,
  executeMarketSell,
  getSpotActivity,
  getSpotBalances,
  getSpotPrices,
} from "@/lib/providers/bybit";
import { MarketDataAggregator } from "@/lib/providers/market";
import { createExecutionPlan } from "@/lib/risk";
import type { BotExecutionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getCycleKey(now = new Date()) {
  const interval = 15 * 60 * 1_000;
  return new Date(Math.floor(now.getTime() / interval) * interval).toISOString();
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const cycleKey = getCycleKey();
  let ownsCycle = false;
  try {
    ownsCycle = await beginBotRun(cycleKey);
    if (!ownsCycle) {
      return NextResponse.json({
        success: true,
        skipped: true,
        cycleKey,
        reason: "This 15-minute cycle is already running or completed.",
      });
    }

    const pricePromise = getSpotPrices();
    const [prices, activity, indicators] = await Promise.all([
      pricePromise,
      getSpotActivity(),
      new MarketDataAggregator().fetchAll(),
    ]);
    const balances = await getSpotBalances(prices);
    const capturedAt = new Date().toISOString();
    const totalPortfolioUsdt = calculatePortfolioTotal(balances);

    await Promise.all([
      savePortfolioSnapshot(cycleKey, {
        capturedAt,
        totalPortfolioUsdt,
        balances,
        prices,
      }),
      upsertOrders(activity.orders),
    ]);

    const accountEnvironment = getAccountEnvironment();
    const jev = await evaluateTradingState({
      observedAt: capturedAt,
      executionEnvironment: accountEnvironment,
      marketSource: "bybit-mainnet",
      balances,
      prices,
      openOrders: activity.openOrders,
      indicators,
    });

    const trading = getTradingConfig();
    const openSymbols = new Set(activity.openOrders.map((order) => order.symbol));
    const executions: BotExecutionResult[] = [];
    const riskBalances = balances.map((balance) => ({ ...balance }));

    for (const decision of jev.decisions) {
      const symbol = SYMBOLS[decision.asset];
      if (!trading.enabled) {
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "disabled",
          reason: "TRADING_ENABLED is not true; decision recorded without an order.",
        });
        continue;
      }
      const plan = createExecutionPlan(
        decision,
        indicators[decision.asset],
        riskBalances,
        totalPortfolioUsdt,
        trading,
      );
      if (!plan.allowed) {
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: decision.action === "hold" ? "held" : "skipped",
          reason: plan.reason,
        });
        continue;
      }
      if (openSymbols.has(symbol)) {
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "skipped",
          reason: "An open order already exists for this symbol.",
        });
        continue;
      }

      const orderLinkId = `jev-${new Date(cycleKey).getTime()}-${decision.asset.toLowerCase()}`;
      try {
        const result = decision.action === "buy"
          ? await executeMarketBuy(
              decision.asset,
              plan.buyPctOfUsdt,
              trading.minTradeUsdt,
              orderLinkId,
            )
          : await executeMarketSell(
              decision.asset,
              trading.sellPctOfHolding,
              trading.minTradeUsdt,
              orderLinkId,
            );
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "submitted",
          reason: `${plan.reason} Validated market order submitted to the configured Bybit account.`,
          orderId: result.orderId,
          orderLinkId,
        });
        openSymbols.add(symbol);
        const usdtBalance = riskBalances.find((balance) => balance.coin === "USDT");
        const assetBalance = riskBalances.find((balance) => balance.coin === decision.asset);
        if (decision.action === "buy" && usdtBalance && assetBalance) {
          const spend = usdtBalance.free * plan.buyPctOfUsdt;
          usdtBalance.free -= spend;
          usdtBalance.total -= spend;
          usdtBalance.usdtValue -= spend;
          assetBalance.usdtValue += spend;
        } else if (decision.action === "sell" && usdtBalance && assetBalance) {
          const proceeds = assetBalance.usdtValue * trading.sellPctOfHolding;
          assetBalance.usdtValue -= proceeds;
          usdtBalance.free += proceeds;
          usdtBalance.total += proceeds;
          usdtBalance.usdtValue += proceeds;
        }
      } catch (error) {
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "failed",
          reason: getSafeErrorMessage(error, "Unknown execution error"),
          orderLinkId,
        });
      }
    }

    if (executions.some((execution) => execution.status === "submitted")) {
      const refreshedActivity = await getSpotActivity();
      await upsertOrders(refreshedActivity.orders);
    }

    await completeBotRun(cycleKey, jev.model, indicators, jev.decisions, executions);
    return NextResponse.json({
      success: true,
      cycleKey,
      capturedAt,
      accountEnvironment,
      marketSource: "bybit-mainnet",
      tradingEnabled: trading.enabled,
      totalPortfolioUsdt,
      decisions: jev.decisions,
      executions,
      model: jev.model,
      usage: jev.usage,
    });
  } catch (error) {
    const message = getSafeErrorMessage(error, "Unknown cron failure");
    if (ownsCycle) {
      try {
        await failBotRun(cycleKey, error);
      } catch (persistenceError) {
        console.error("[cron] failed to persist run failure", persistenceError);
      }
    }
    console.error("[cron]", { cycleKey, message });
    return NextResponse.json({ success: false, cycleKey, error: message }, { status: 500 });
  }
}
