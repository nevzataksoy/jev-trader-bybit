import { NextResponse } from "next/server";
import { getAccountEnvironment, getTradingConfig, SYMBOLS } from "@/lib/config";
import {
  beginBotRun,
  cleanupDatabase,
  completeBotRun,
  failBotRun,
  getLatestMacroSnapshot,
  getLatestMarketState,
  getPortfolioRiskContext,
  getStoredOrders,
  saveMacroSnapshot,
  savePortfolioSnapshot,
  upsertOrders,
} from "@/lib/db";
import { evaluateTradingState } from "@/lib/jev";
import { buildPositionContexts, rankDecisionsForExecution } from "@/lib/portfolio";
import { getSafeErrorMessage } from "@/lib/errors";
import { reconcileExecutions } from "@/lib/execution";
import {
  calculatePortfolioTotal,
  executeMarketBuy,
  executeMarketSell,
  getSpotActivity,
  getSpotBalances,
  getSpotFeeRates,
  getSpotPrices,
} from "@/lib/providers/bybit";
import { MarketDataAggregator, stabilizeMamisPhases } from "@/lib/providers/market";
import {
  createUnavailableMacroState,
  fetchMacroState,
  isMacroCacheFresh,
  markMacroStateStale,
} from "@/lib/providers/macro";
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

async function runEndOfCycleCleanup(cycleKey: string) {
  try {
    return { success: true as const, ...(await cleanupDatabase()) };
  } catch (error) {
    const message = getSafeErrorMessage(error, "Database cleanup failed");
    console.error("[cron-cleanup]", { cycleKey, message });
    return { success: false as const, error: message };
  }
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

    const trading = getTradingConfig();
    const pricePromise = getSpotPrices();
    const [prices, activity, fetchedIndicators, fees, cachedMacro, previousMarketState] = await Promise.all([
      pricePromise,
      getSpotActivity(),
      new MarketDataAggregator().fetchAll(),
      getSpotFeeRates(),
      getLatestMacroSnapshot(),
      getLatestMarketState(),
    ]);
    const indicators = stabilizeMamisPhases(fetchedIndicators, previousMarketState);
    let macro = cachedMacro;
    if (!macro || !isMacroCacheFresh(macro, Date.now(), trading.macroCacheHours)) {
      try {
        macro = await fetchMacroState();
        await saveMacroSnapshot(macro);
      } catch (error) {
        const message = getSafeErrorMessage(error, "Macro data unavailable");
        macro = cachedMacro ? markMacroStateStale(cachedMacro, message) : createUnavailableMacroState(message);
      }
    }
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
    const [portfolioRisk, storedOrders] = await Promise.all([
      getPortfolioRiskContext(totalPortfolioUsdt),
      getStoredOrders(500),
    ]);
    const positions = buildPositionContexts(balances, storedOrders, totalPortfolioUsdt);
    const decisionContext = { positions, fees, portfolioRisk, macro };

    const accountEnvironment = getAccountEnvironment();
    const jev = await evaluateTradingState({
      observedAt: capturedAt,
      executionEnvironment: accountEnvironment,
      marketSource: "bybit-mainnet",
      balances,
      prices,
      openOrders: activity.openOrders,
      indicators,
      positions,
      fees,
      portfolioRisk,
      macro,
    });

    const openSymbols = new Set(activity.openOrders.map((order) => order.symbol));
    let executions: BotExecutionResult[] = [];
    const riskBalances = balances.map((balance) => ({ ...balance }));
    let submittedBuyCount = 0;

    for (const decision of rankDecisionsForExecution(jev.decisions)) {
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
      if (decision.action === "buy" && submittedBuyCount >= trading.maxBuysPerCycle) {
        executions.push({
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "skipped",
          reason: "A higher-ranked buy already consumed this cycle's new-exposure budget.",
        });
        continue;
      }
      const plan = createExecutionPlan(
        decision,
        indicators[decision.asset],
        riskBalances,
        totalPortfolioUsdt,
        trading,
        {
          position: positions[decision.asset],
          fee: fees[decision.asset],
          portfolioRisk,
        },
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
              trading.maxMarketSlippagePct,
            )
          : await executeMarketSell(
            decision.asset,
              plan.sellPctOfHolding,
              trading.minTradeUsdt,
              orderLinkId,
              trading.maxMarketSlippagePct,
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
        if (decision.action === "buy") submittedBuyCount += 1;
        const usdtBalance = riskBalances.find((balance) => balance.coin === "USDT");
        const assetBalance = riskBalances.find((balance) => balance.coin === decision.asset);
        if (decision.action === "buy" && usdtBalance && assetBalance) {
          const spend = usdtBalance.free * plan.buyPctOfUsdt;
          usdtBalance.free -= spend;
          usdtBalance.total -= spend;
          usdtBalance.usdtValue -= spend;
          assetBalance.usdtValue += spend;
        } else if (decision.action === "sell" && usdtBalance && assetBalance) {
          const proceeds = assetBalance.usdtValue * plan.sellPctOfHolding;
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
      await new Promise((resolve) => setTimeout(resolve, 750));
      const refreshedActivity = await getSpotActivity();
      await upsertOrders(refreshedActivity.orders);
      executions = reconcileExecutions(executions, refreshedActivity.orders);
    }

    await completeBotRun(
      cycleKey,
      jev.model,
      indicators,
      { ...decisionContext, portfolioJudgments: jev.portfolioJudgments },
      jev.decisions,
      executions,
    );
    const cleanup = await runEndOfCycleCleanup(cycleKey);
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
      portfolioJudgments: jev.portfolioJudgments,
      cleanup,
      macro: {
        sourceObservedAt: macro.source_observed_at,
        dataQuality: macro.data_quality,
        policyRegime: macro.policy_regime,
        goldRealYieldRegime: macro.gold_real_yield_regime,
      },
    });
  } catch (error) {
    const message = getSafeErrorMessage(error, "Unknown cron failure");
    if (ownsCycle) {
      try {
        await failBotRun(cycleKey, error);
      } catch (persistenceError) {
        console.error("[cron] failed to persist run failure", persistenceError);
      }
      await runEndOfCycleCleanup(cycleKey);
    }
    console.error("[cron]", { cycleKey, message });
    return NextResponse.json({ success: false, cycleKey, error: message }, { status: 500 });
  }
}
