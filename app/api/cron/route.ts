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
import { getSafeErrorMessage } from "@/lib/errors";
import { reconcileExecutions } from "@/lib/execution";
import { buildPositionContexts, rankDecisionsForExecution } from "@/lib/portfolio";
import {
  calculatePortfolioTotal,
  executeMarketBuy,
  executeMarketSell,
  getSpotActivity,
  getSpotBalances,
  getSpotFeeRates,
  getSpotPrices,
} from "@/lib/providers/bybit";
import {
  createUnavailableMacroState,
  fetchMacroState,
  isMacroCacheFresh,
  markMacroStateStale,
} from "@/lib/providers/macro";
import { MarketDataAggregator, stabilizeMamisPhases } from "@/lib/providers/market";
import { createExecutionPlan } from "@/lib/risk";
import { getExchangeRoutingState, getStrategyRuntimeConfig } from "@/lib/strategy/config";
import { ensureStrategyExperiment, saveSharedMarketSnapshot } from "@/lib/strategy/experiment";
import { createEngineState, runPaperEngineCycle, strategyEngines } from "@/lib/strategy/runner";
import type { StrategyEngineId } from "@/lib/strategy/types";
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

function routingReason(reason: ReturnType<typeof getExchangeRoutingState>["reason"]) {
  if (reason === "trading_disabled") return "TRADING_ENABLED is not true; decision recorded without an order.";
  if (reason === "execution_engine_none") return "EXCHANGE_EXECUTION_ENGINE is none; decision recorded without an order.";
  if (reason === "engine_not_selected") return "This decision engine is not selected for exchange execution.";
  if (reason === "ab_test_lock") return "A/B safety lock suppressed exchange routing.";
  return "Exchange routing allowed.";
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured." }, { status: 503 });
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
    const strategy = getStrategyRuntimeConfig();
    const [prices, activity, fetchedIndicators, fees, cachedMacro, previousMarketState] = await Promise.all([
      getSpotPrices(),
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
      savePortfolioSnapshot(cycleKey, { capturedAt, totalPortfolioUsdt, balances, prices }),
      upsertOrders(activity.orders),
    ]);
    const snapshotId = await saveSharedMarketSnapshot({ cycleKey, capturedAt, prices, indicators, fees, macro });
    const accountEnvironment = getAccountEnvironment();

    if (strategy.runMode === "ab_test") {
      const engineVersions = {
        model1: strategyEngines.model1.version,
        model2: strategyEngines.model2.version,
      };
      await ensureStrategyExperiment({
        experimentId: strategy.experimentId,
        initialCapitalUsdt: strategy.initialCapitalUsdt,
        minimumDays: strategy.minimumDays,
        minimumFilledOrdersPerEngine: strategy.minimumFilledOrdersPerEngine,
      }, engineVersions);
      const settled = await Promise.allSettled(strategy.activeEngines.map((engineId) => runPaperEngineCycle(engineId, {
        experimentId: strategy.experimentId,
        cycleKey,
        snapshotId,
        capturedAt,
        executionEnvironment: accountEnvironment,
        prices,
        indicators,
        fees,
        macro,
      })));
      const engineOutcomes = settled.map((outcome, index) => {
        const engineId = strategy.activeEngines[index];
        return outcome.status === "fulfilled"
          ? {
              engineId,
              status: "completed" as const,
              engineVersion: outcome.value.result.engineVersion,
              model: outcome.value.result.model,
              usage: outcome.value.result.usage,
              latencyMs: outcome.value.result.latencyMs,
              totalPortfolioUsdt: outcome.value.totalPortfolioUsdt,
              decisions: outcome.value.result.decisions,
              executions: outcome.value.executions,
            }
          : {
              engineId,
              status: "failed" as const,
              engineVersion: strategyEngines[engineId].version,
              error: getSafeErrorMessage(outcome.reason, `${engineId} failed`),
            };
      });
      const [portfolioRisk, storedOrders] = await Promise.all([
        getPortfolioRiskContext(totalPortfolioUsdt),
        getStoredOrders(500),
      ]);
      const positions = buildPositionContexts(balances, storedOrders, totalPortfolioUsdt);
      await completeBotRun(
        cycleKey,
        `ab_test:${engineVersions.model1}|${engineVersions.model2}`,
        indicators,
        { positions, fees, portfolioRisk, macro },
        [],
        [],
      );
      const cleanup = await runEndOfCycleCleanup(cycleKey);
      return NextResponse.json({
        success: true,
        cycleKey,
        capturedAt,
        runMode: strategy.runMode,
        experimentId: strategy.experimentId,
        exchangeRoutingAllowed: false,
        exchangeRoutingReason: "ab_test_lock",
        sharedSnapshotId: snapshotId,
        realPortfolioUsdt: totalPortfolioUsdt,
        engines: engineOutcomes,
        cleanup,
      });
    }

    const engineId = strategy.runMode as StrategyEngineId;
    const engine = strategyEngines[engineId];
    const [portfolioRisk, storedOrders] = await Promise.all([
      getPortfolioRiskContext(totalPortfolioUsdt),
      getStoredOrders(500),
    ]);
    const positions = buildPositionContexts(balances, storedOrders, totalPortfolioUsdt);
    const state = createEngineState({
      observedAt: capturedAt,
      executionEnvironment: accountEnvironment,
      balances,
      prices,
      openOrders: activity.openOrders,
      indicators,
      positions,
      fees,
      portfolioRisk,
      macro,
    });
    const result = await engine.evaluate(state);
    const routing = getExchangeRoutingState(engineId, strategy, trading.enabled);
    const openSymbols = new Set(activity.openOrders.map((order) => order.symbol));
    let executions: BotExecutionResult[] = [];
    const riskBalances = balances.map((balance) => ({ ...balance }));
    let submittedBuyCount = 0;

    for (const decision of rankDecisionsForExecution(result.decisions)) {
      const symbol = SYMBOLS[decision.asset];
      if (!routing.allowed) {
        executions.push({ engineId, asset: decision.asset, symbol, action: decision.action, status: "disabled", reason: routingReason(routing.reason) });
        continue;
      }
      if (decision.action === "buy" && submittedBuyCount >= trading.maxBuysPerCycle) {
        executions.push({ engineId, asset: decision.asset, symbol, action: decision.action, status: "skipped", reason: "A higher-ranked buy already consumed this cycle's new-exposure budget." });
        continue;
      }
      const plan = createExecutionPlan(
        decision,
        indicators[decision.asset],
        riskBalances,
        totalPortfolioUsdt,
        trading,
        { position: positions[decision.asset], fee: fees[decision.asset], portfolioRisk },
      );
      if (!plan.allowed) {
        executions.push({ engineId, asset: decision.asset, symbol, action: decision.action, status: decision.action === "hold" ? "held" : "skipped", reason: plan.reason });
        continue;
      }
      if (openSymbols.has(symbol)) {
        executions.push({ engineId, asset: decision.asset, symbol, action: decision.action, status: "skipped", reason: "An open order already exists for this symbol." });
        continue;
      }

      const orderLinkId = `jev-${engineId}-${new Date(cycleKey).getTime()}-${decision.asset.toLowerCase()}`;
      try {
        const order = decision.action === "buy"
          ? await executeMarketBuy(decision.asset, plan.buyPctOfUsdt, trading.minTradeUsdt, orderLinkId, trading.maxMarketSlippagePct)
          : await executeMarketSell(decision.asset, plan.sellPctOfHolding, trading.minTradeUsdt, orderLinkId, trading.maxMarketSlippagePct);
        executions.push({
          engineId,
          asset: decision.asset,
          symbol,
          action: decision.action,
          status: "submitted",
          reason: `${plan.reason} Validated market order submitted to the configured Bybit account.`,
          orderId: order.orderId,
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
        executions.push({ engineId, asset: decision.asset, symbol, action: decision.action, status: "failed", reason: getSafeErrorMessage(error, "Unknown execution error"), orderLinkId });
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
      `${result.engineVersion}:${result.model}`,
      indicators,
      { positions, fees, portfolioRisk, macro, portfolioJudgments: result.portfolioJudgments },
      result.decisions,
      executions,
    );
    const cleanup = await runEndOfCycleCleanup(cycleKey);
    return NextResponse.json({
      success: true,
      cycleKey,
      capturedAt,
      accountEnvironment,
      marketSource: "bybit-mainnet",
      runMode: strategy.runMode,
      engineId,
      engineVersion: result.engineVersion,
      tradingEnabled: trading.enabled,
      exchangeRoutingAllowed: routing.allowed,
      exchangeRoutingReason: routing.reason,
      totalPortfolioUsdt,
      decisions: result.decisions,
      executions,
      model: result.model,
      usage: result.usage,
      portfolioJudgments: result.portfolioJudgments,
      sharedSnapshotId: snapshotId,
      cleanup,
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
