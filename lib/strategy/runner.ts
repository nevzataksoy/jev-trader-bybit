import { SYMBOLS, getTradingConfig } from "../config";
import { getSafeErrorMessage } from "../errors";
import type { JevTradingState } from "../jev";
import { rankDecisionsForExecution } from "../portfolio";
import { createExecutionPlan } from "../risk";
import type {
  BotExecutionResult,
  FeeRate,
  MacroState,
  MarketIndicatorState,
  TickerPrices,
  TradeAsset,
} from "../types";
import {
  beginEngineRun,
  completeEngineRun,
  failEngineRun,
  getPaperTradingState,
  savePaperEquitySnapshot,
  simulatePaperOrder,
} from "./experiment";
import { model1Engine } from "./model1";
import { model2Engine } from "./model2";
import type { StrategyEngine, StrategyEngineId, StrategyEngineResult } from "./types";

export const strategyEngines: Record<StrategyEngineId, StrategyEngine> = {
  model1: model1Engine,
  model2: model2Engine,
};

export interface SharedEngineCycleContext {
  experimentId: string;
  cycleKey: string;
  snapshotId: number;
  capturedAt: string;
  executionEnvironment: "testnet" | "demo" | "mainnet";
  prices: TickerPrices;
  indicators: Record<TradeAsset, MarketIndicatorState>;
  fees: Record<TradeAsset, FeeRate>;
  macro: MacroState | null;
}

export interface PaperEngineCycleResult {
  result: StrategyEngineResult;
  executions: BotExecutionResult[];
  totalPortfolioUsdt: number;
}

export function createEngineState(
  base: Omit<JevTradingState, "executionEnvironment" | "marketSource"> & {
    executionEnvironment: JevTradingState["executionEnvironment"];
  },
): JevTradingState {
  return { ...base, marketSource: "bybit-mainnet" };
}

export async function runPaperEngineCycle(
  engineId: StrategyEngineId,
  shared: SharedEngineCycleContext,
): Promise<PaperEngineCycleResult> {
  const engine = strategyEngines[engineId];
  await beginEngineRun(shared.experimentId, shared.cycleKey, shared.snapshotId, engine.id, engine.version);
  try {
    const paper = await getPaperTradingState(
      shared.experimentId,
      engine.id,
      shared.prices,
      new Date(shared.capturedAt).getTime(),
    );
    const state = createEngineState({
      observedAt: shared.capturedAt,
      executionEnvironment: shared.executionEnvironment,
      balances: paper.balances,
      prices: shared.prices,
      openOrders: [],
      indicators: shared.indicators,
      positions: paper.positions,
      fees: shared.fees,
      portfolioRisk: paper.portfolioRisk,
      macro: shared.macro,
    });
    const result = await engine.evaluate(state);
    const trading = getTradingConfig();
    const executions: BotExecutionResult[] = [];
    const workingBalances = paper.balances.map((balance) => ({ ...balance }));
    let buyCount = 0;

    for (const decision of rankDecisionsForExecution(result.decisions)) {
      const symbol = SYMBOLS[decision.asset];
      if (decision.action === "buy" && buyCount >= trading.maxBuysPerCycle) {
        executions.push({ asset: decision.asset, symbol, action: decision.action, status: "skipped", reason: "A higher-ranked paper buy consumed this cycle's exposure budget." });
        continue;
      }
      const plan = createExecutionPlan(
        decision,
        shared.indicators[decision.asset],
        workingBalances,
        paper.totalPortfolioUsdt,
        trading,
        { position: paper.positions[decision.asset], fee: shared.fees[decision.asset], portfolioRisk: paper.portfolioRisk },
        new Date(shared.capturedAt).getTime(),
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
      const execution = await simulatePaperOrder({
        experimentId: shared.experimentId,
        cycleKey: shared.cycleKey,
        snapshotId: shared.snapshotId,
        engineId: engine.id,
        engineVersion: engine.version,
        decision,
        plan,
        market: shared.indicators[decision.asset],
        fee: shared.fees[decision.asset],
        capturedAt: shared.capturedAt,
        estimatedSlippagePct: trading.estimatedSlippagePct,
      });
      executions.push(execution);
      if (execution.status === "confirmed") {
        const cash = workingBalances.find((balance) => balance.coin === "USDT");
        const asset = workingBalances.find((balance) => balance.coin === decision.asset);
        const value = execution.filledValueUsdt ?? 0;
        if (cash && asset && decision.action === "buy") {
          cash.free = Math.max(0, cash.free - value);
          cash.total = Math.max(0, cash.total - value);
          cash.usdtValue = cash.total;
          asset.usdtValue += value;
          buyCount += 1;
        } else if (cash && asset && decision.action === "sell") {
          asset.usdtValue = Math.max(0, asset.usdtValue - value);
          cash.free += value;
          cash.total += value;
          cash.usdtValue = cash.total;
        }
      }
    }
    const finalState = await savePaperEquitySnapshot(
      shared.experimentId,
      shared.cycleKey,
      engine.id,
      shared.capturedAt,
      shared.prices,
    );
    await completeEngineRun(
      shared.experimentId,
      shared.cycleKey,
      result,
      { positions: paper.positions, fees: shared.fees, portfolioRisk: paper.portfolioRisk, macro: shared.macro, portfolioJudgments: result.portfolioJudgments },
      executions,
    );
    return { result, executions, totalPortfolioUsdt: finalState.totalPortfolioUsdt };
  } catch (error) {
    const message = getSafeErrorMessage(error, `${engine.id} paper cycle failed`);
    await failEngineRun(shared.experimentId, shared.cycleKey, engine.id, message);
    throw error;
  }
}
