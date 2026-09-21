import { getTradingConfig } from "../config";

export const STRATEGY_ENGINE_IDS = ["model1", "model2"] as const;
export type StrategyEngineId = (typeof STRATEGY_ENGINE_IDS)[number];
export type StrategyRunMode = StrategyEngineId | "ab_test";
export type ExchangeExecutionEngine = StrategyEngineId | "none";

function engineId(value: string | undefined): StrategyEngineId | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "model1" || normalized === "model2" ? normalized : null;
}

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getStrategyRuntimeConfig() {
  const requestedMode = process.env.STRATEGY_RUN_MODE?.trim().toLowerCase();
  const runMode: StrategyRunMode = requestedMode === "ab_test"
    ? "ab_test"
    : engineId(requestedMode) ?? "model1";
  const requestedExecutionEngine = process.env.EXCHANGE_EXECUTION_ENGINE?.trim().toLowerCase();
  const executionEngine: ExchangeExecutionEngine = requestedExecutionEngine === "none"
    ? "none"
    : engineId(requestedExecutionEngine) ?? "model1";
  const initialCapitalUsdt = numberFromEnv("AB_INITIAL_CAPITAL_USDT", 1_000, 10, 10_000_000);
  const minimumDays = Math.round(numberFromEnv("AB_MIN_DAYS", 42, 7, 365));

  return {
    runMode,
    activeEngines: (runMode === "ab_test" ? [...STRATEGY_ENGINE_IDS] : [runMode]) as StrategyEngineId[],
    executionEngine,
    experimentId: process.env.AB_EXPERIMENT_ID?.trim() || "model1-v1-vs-model2-v1",
    initialCapitalUsdt,
    minimumDays,
    minimumFilledOrdersPerEngine: Math.round(numberFromEnv("AB_MIN_FILLED_ORDERS_PER_ENGINE", 30, 1, 10_000)),
  };
}

export interface ExchangeRoutingState {
  allowed: boolean;
  reason: "allowed" | "ab_test_lock" | "trading_disabled" | "execution_engine_none" | "engine_not_selected";
}

export function getExchangeRoutingState(
  engine: StrategyEngineId,
  strategy = getStrategyRuntimeConfig(),
  tradingEnabled = getTradingConfig().enabled,
): ExchangeRoutingState {
  if (strategy.runMode === "ab_test") return { allowed: false, reason: "ab_test_lock" };
  if (!tradingEnabled) return { allowed: false, reason: "trading_disabled" };
  if (strategy.executionEngine === "none") return { allowed: false, reason: "execution_engine_none" };
  if (strategy.executionEngine !== engine) return { allowed: false, reason: "engine_not_selected" };
  return { allowed: true, reason: "allowed" };
}
