import { randomUUID } from "node:crypto";
import { getTradingConfig } from "../config";
import type { JevTradingState } from "../jev";
import { buildPositionContexts, rankDecisionsForExecution } from "../portfolio";
import { createExecutionPlan } from "../risk";
import { STRATEGY_ENGINE_IDS } from "../strategy/catalog.generated";
import { getStrategyEngine } from "../strategy/runner";
import { TRADE_ASSETS, type FeeRate, type MarketIndicatorState, type TickerPrices, type TradeAsset } from "../types";
import {
  beginSimulationRun,
  completeSimulationRun,
  failSimulationRun,
  saveHistoricalDataset,
  saveSimulationCycle,
} from "./db";
import { fetchHistoricalDataset } from "./data";
import {
  balancesForPortfolio,
  buildSimulationRiskContext,
  createSimulationPortfolio,
  executeSimulationPlan,
  portfolioEquity,
} from "./exchange";
import {
  buildAsOfMacroState,
  buildCycleMarketState,
  buildCycleTimes,
  nextOpenPrices,
  pricesFromMarketState,
} from "./features";
import type { HistoricalDataset, SimulationConfig, SimulationCycleRecord, SimulationSummary } from "./types";

const FIFTEEN_MINUTES = 15 * 60_000;
const DAY = 24 * 60 * 60_000;

function envNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function createSimulationConfig(options: {
  hours?: number;
  endAt?: number;
  initialCapitalUsdt?: number;
  maxCycles?: number | null;
} = {}): SimulationConfig {
  const hours = Math.max(0.25, options.hours ?? 48);
  const currentBoundary = Math.floor(Date.now() / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
  const endAt = options.endAt ?? currentBoundary - FIFTEEN_MINUTES;
  if (endAt % FIFTEEN_MINUTES !== 0) throw new Error("Backtest end time must be aligned to a UTC 15-minute boundary.");
  const startAt = endAt - hours * 60 * 60_000;
  return {
    hours,
    startAt,
    endAt,
    warmupStartAt: startAt - 36 * DAY,
    initialCapitalUsdt: options.initialCapitalUsdt ?? envNumber("BACKTEST_INITIAL_CAPITAL_USDT", 1_000, 10, 10_000_000),
    takerFeePct: envNumber("BACKTEST_TAKER_FEE_PCT", 0.1, 0, 5),
    slippagePct: envNumber("BACKTEST_SLIPPAGE_PCT", 0.03, 0, 5),
    spreadPct: {
      BTC: envNumber("BACKTEST_BTC_SPREAD_PCT", 0.02, 0, 5),
      ETH: envNumber("BACKTEST_ETH_SPREAD_PCT", 0.03, 0, 5),
      XAUT: envNumber("BACKTEST_XAUT_SPREAD_PCT", 0.05, 0, 5),
    },
    maxCycles: options.maxCycles ?? null,
  };
}

function feeRates(config: SimulationConfig): Record<TradeAsset, FeeRate> {
  return Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, {
    symbol: `${asset}USDT`,
    maker_fee_pct: config.takerFeePct,
    taker_fee_pct: config.takerFeePct,
  }])) as Record<TradeAsset, FeeRate>;
}

function finalClosePrices(dataset: HistoricalDataset, config: SimulationConfig): TickerPrices {
  const prices = { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 } satisfies TickerPrices;
  for (const asset of TRADE_ASSETS) {
    const candle = dataset.assets[asset].candles15m.find((item) => item.closeTime === config.endAt + FIFTEEN_MINUTES);
    if (!candle) throw new Error(`Final mark candle is unavailable for ${asset}.`);
    prices[asset] = candle.close;
  }
  return prices;
}

function boundaryPrices(dataset: HistoricalDataset, timestamp: number): TickerPrices {
  const prices = { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 } satisfies TickerPrices;
  for (const asset of TRADE_ASSETS) {
    const candle = dataset.assets[asset].candles15m
      .filter((item) => item.closeTime <= timestamp)
      .at(-1);
    if (!candle) throw new Error(`Benchmark start price is unavailable for ${asset}.`);
    prices[asset] = candle.close;
  }
  return prices;
}

function benchmarkValues(initial: number, start: TickerPrices, end: TickerPrices) {
  const btcBuyHoldUsdt = initial * (end.BTC / start.BTC);
  const equalWeightUsdt = initial * 0.25 + TRADE_ASSETS.reduce(
    (total, asset) => total + initial * 0.25 * (end[asset] / start[asset]),
    0,
  );
  return { cashUsdt: initial, btcBuyHoldUsdt, equalWeightUsdt };
}

function calculateMaxDrawdown(equities: number[]) {
  let peak = equities[0] ?? 0;
  let maximum = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) maximum = Math.max(maximum, ((peak - equity) / peak) * 100);
  }
  return maximum;
}

function buildSummary(args: {
  runId: string;
  startedAt: string;
  config: SimulationConfig;
  cycles: SimulationCycleRecord[];
  finalEquity: number;
  liquidationEquity: number;
  fees: number;
  slippage: number;
  benchmarks: SimulationSummary["benchmarks"];
}): SimulationSummary {
  const decisions = args.cycles.flatMap((cycle) => cycle.decisions);
  const executions = args.cycles.flatMap((cycle) => cycle.executions);
  const actionCounts = { buy: 0, sell: 0, hold: 0 };
  const regimeCounts: Record<string, number> = {};
  for (const decision of decisions) actionCounts[decision.action] += 1;
  for (const cycle of args.cycles) {
    for (const asset of TRADE_ASSETS) {
      const regime = cycle.marketState[asset].regime;
      regimeCounts[regime] = (regimeCounts[regime] ?? 0) + 1;
    }
  }
  return {
    runId: args.runId,
    status: "completed",
    startedAt: args.startedAt,
    completedAt: new Date().toISOString(),
    periodStart: new Date(args.config.startAt).toISOString(),
    periodEnd: new Date(args.config.endAt).toISOString(),
    cycles: args.cycles.length,
    assetDecisions: decisions.length,
    directionalSignals: decisions.filter((item) => item.judgments.direction.choice !== "unclear").length,
    policyOrders: decisions.filter((item) => item.action !== "hold").length,
    acceptedOrders: executions.filter((item) => item.status === "filled").length,
    filledOrders: executions.filter((item) => item.status === "filled").length,
    initialCapitalUsdt: args.config.initialCapitalUsdt,
    finalEquityUsdt: args.finalEquity,
    liquidationEquityUsdt: args.liquidationEquity,
    returnPct: ((args.liquidationEquity / args.config.initialCapitalUsdt) - 1) * 100,
    maxDrawdownPct: calculateMaxDrawdown([
      args.config.initialCapitalUsdt,
      ...args.cycles.map((cycle) => cycle.equityAfterUsdt),
      args.finalEquity,
    ]),
    totalFeesUsdt: args.fees,
    totalSlippageUsdt: args.slippage,
    turnoverUsdt: executions.reduce((sum, item) => sum + (item.status === "filled" ? item.grossValueUsdt : 0), 0),
    benchmarks: args.benchmarks,
    actionCounts,
    regimeCounts,
    model: args.cycles.at(-1)?.model ?? process.env.JEV_MODEL_NAME?.trim() ?? "unknown",
    inputTokens: args.cycles.reduce((sum, cycle) => sum + cycle.inputTokens, 0),
    outputTokens: args.cycles.reduce((sum, cycle) => sum + cycle.outputTokens, 0),
    assumptions: [
      "Signals use only candles closed at or before each decision boundary.",
      "Fills occur at the next 15-minute candle open with adverse configured slippage and taker fees.",
      "Historical order-book depth is unavailable through the REST source, so a neutral proxy is used and labeled.",
      "Historical trade flow is unavailable and is passed to Jev as unavailable, not inferred.",
      "Open interest is converted to a USDT estimate with the contemporaneous spot close.",
      "Macro rows are delayed by one calendar day to reduce publication-time lookahead.",
      "This two-day run is a pipeline diagnostic, not statistically sufficient evidence of profitability.",
    ],
  };
}

export async function runHistoricalSimulation(args: {
  config?: SimulationConfig;
  runId?: string;
  onProgress?: (message: string) => void;
} = {}) {
  const config = args.config ?? createSimulationConfig();
  const runId = args.runId ?? `sim-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const progress = args.onProgress ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const availableEngines = STRATEGY_ENGINE_IDS as readonly string[];
  const defaultEngine = availableEngines.includes("model1") ? "model1" : availableEngines[0];
  const engine = getStrategyEngine(process.env.BACKTEST_STRATEGY_ENGINE?.trim().toLowerCase() || defaultEngine);
  await beginSimulationRun(runId, new Date(config.startAt).toISOString(), new Date(config.endAt).toISOString(), config);
  try {
    const dataset = await fetchHistoricalDataset(config, progress);
    progress("Persisting immutable historical inputs in the simulation schema...");
    await saveHistoricalDataset(runId, dataset);

    const portfolio = createSimulationPortfolio(config.initialCapitalUsdt);
    const tradingConfig = getTradingConfig();
    const fees = feeRates(config);
    const cycleTimes = buildCycleTimes(config);
    const records: SimulationCycleRecord[] = [];
    const equityHistory: Array<{ timestamp: number; equity: number }> = [];
    let previousMarket: Record<TradeAsset, MarketIndicatorState> | null = null;

    for (let index = 0; index < cycleTimes.length; index += 1) {
      const cycleAt = cycleTimes[index];
      const marketState = buildCycleMarketState(dataset, cycleAt, config, previousMarket);
      previousMarket = marketState;
      const prices = pricesFromMarketState(marketState);
      const executionPrices = nextOpenPrices(dataset, cycleAt);
      const balancesBefore = balancesForPortfolio(portfolio, prices);
      const equityBefore = portfolioEquity(portfolio, prices);
      const positions = buildPositionContexts(balancesBefore, portfolio.orders, equityBefore, cycleAt);
      const portfolioRisk = buildSimulationRiskContext(equityBefore, equityHistory, portfolio, cycleAt);
      const macro = buildAsOfMacroState(dataset, cycleAt);
      const state: JevTradingState = {
        observedAt: new Date(cycleAt).toISOString(),
        blindEpisodeKey: runId,
        executionEnvironment: "demo",
        marketSource: "bybit-mainnet",
        balances: balancesBefore,
        prices,
        openOrders: [],
        indicators: marketState,
        positions,
        fees,
        portfolioRisk,
        macro,
      };
      const semanticState = engine.buildAuditState?.(state) ?? null;
      const jev = await engine.evaluate(state);
      const executions = [] as SimulationCycleRecord["executions"];
      let buysFilled = 0;
      for (const decision of rankDecisionsForExecution(jev.decisions)) {
        const currentBalances = balancesForPortfolio(portfolio, prices);
        const currentEquity = portfolioEquity(portfolio, prices);
        const currentPositions = buildPositionContexts(currentBalances, portfolio.orders, currentEquity, cycleAt);
        const plan = createExecutionPlan(decision, marketState[decision.asset], currentBalances, currentEquity, tradingConfig, {
          position: currentPositions[decision.asset],
          fee: fees[decision.asset],
          portfolioRisk: buildSimulationRiskContext(currentEquity, equityHistory, portfolio, cycleAt),
        }, cycleAt);
        if (decision.action === "buy" && plan.allowed && buysFilled >= tradingConfig.maxBuysPerCycle) {
          executions.push({
            asset: decision.asset, action: decision.action, status: "skipped",
            reason: "A higher-ranked buy already consumed the per-cycle buy limit.",
            decisionPrice: prices[decision.asset], fillPrice: null, quantity: 0,
            grossValueUsdt: 0, feeUsdt: 0, slippageUsdt: 0, orderId: null,
          });
          continue;
        }
        const execution = executeSimulationPlan({
          portfolio,
          decision,
          plan,
          decisionPrice: prices[decision.asset],
          nextOpenPrice: executionPrices[decision.asset],
          executionAt: cycleAt + 1,
          orderId: `${runId}-${cycleAt}-${decision.asset}-${decision.action}`,
          takerFeePct: config.takerFeePct,
          slippagePct: config.slippagePct,
        });
        executions.push(execution);
        if (execution.status === "filled" && execution.action === "buy") buysFilled += 1;
      }

      const balancesAfter = balancesForPortfolio(portfolio, prices);
      const equityAfter = portfolioEquity(portfolio, prices);
      equityHistory.push({ timestamp: cycleAt, equity: equityAfter });
      const record: SimulationCycleRecord = {
        runId,
        cycleAt: new Date(cycleAt).toISOString(),
        executionAt: new Date(cycleAt + 1).toISOString(),
        prices,
        balancesBefore,
        equityBeforeUsdt: equityBefore,
        portfolioRisk,
        macro,
        marketState,
        semanticState,
        model: `${engine.id}@${engine.version}:${jev.model}`,
        inputTokens: jev.usage.input_tokens,
        outputTokens: jev.usage.output_tokens,
        decisions: jev.decisions,
        executions,
        balancesAfter,
        equityAfterUsdt: equityAfter,
      };
      await saveSimulationCycle(record);
      records.push(record);
      if ((index + 1) % 8 === 0 || index === cycleTimes.length - 1) {
        progress(`Completed ${index + 1}/${cycleTimes.length} cycles; marked equity ${equityAfter.toFixed(2)} USDT.`);
      }
    }

    const finalPrices = finalClosePrices(dataset, config);
    const finalEquity = portfolioEquity(portfolio, finalPrices);
    const liquidationCostFraction = (config.takerFeePct + config.slippagePct) / 100;
    const investedValue = TRADE_ASSETS.reduce((sum, asset) => sum + portfolio.quantities[asset] * finalPrices[asset], 0);
    const liquidationEquity = portfolio.cashUsdt + investedValue * (1 - liquidationCostFraction);
    const summary = buildSummary({
      runId,
      startedAt,
      config,
      cycles: records,
      finalEquity,
      liquidationEquity,
      fees: portfolio.totalFeesUsdt,
      slippage: portfolio.totalSlippageUsdt,
      benchmarks: benchmarkValues(config.initialCapitalUsdt, boundaryPrices(dataset, config.startAt), finalPrices),
    });
    await completeSimulationRun(summary);
    return summary;
  } catch (error) {
    await failSimulationRun(runId, error);
    throw error;
  }
}
