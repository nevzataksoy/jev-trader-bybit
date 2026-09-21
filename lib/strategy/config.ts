import { getTradingConfig } from "../config";
import { STRATEGY_ENGINE_IDS } from "./catalog.generated";
import type { StrategyEngineId } from "./types";

export type StrategyRunMode = StrategyEngineId | "ab_test";
export type ExchangeExecutionEngine = StrategyEngineId | "none";

const availableEngineIds = new Set<string>(STRATEGY_ENGINE_IDS);
const defaultEngineId: StrategyEngineId = availableEngineIds.has("model1") ? "model1" : STRATEGY_ENGINE_IDS[0];

function engineId(value: string | undefined): StrategyEngineId | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && availableEngineIds.has(normalized) ? normalized : null;
}

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function abEngineIds() {
  const preferredDefaults = ["model1-blind-v3", "model2-blind-v3"].filter((id) => availableEngineIds.has(id));
  const automaticDefaults = preferredDefaults.length === 2 ? preferredDefaults : [...STRATEGY_ENGINE_IDS].slice(0, 2);
  const configured = process.env.AB_ENGINE_IDS?.trim();
  const requested = (configured || automaticDefaults.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length !== 2 || new Set(requested).size !== 2) {
    throw new Error("AB_ENGINE_IDS must contain exactly two distinct strategy engine ids.");
  }
  const missing = requested.filter((id) => !availableEngineIds.has(id));
  if (missing.length) {
    throw new Error(`AB_ENGINE_IDS references unavailable strategy models: ${missing.join(", ")}. Available: ${STRATEGY_ENGINE_IDS.join(", ")}.`);
  }
  return requested as StrategyEngineId[];
}

export function getStrategyRuntimeConfig() {
  const requestedMode = process.env.STRATEGY_RUN_MODE?.trim().toLowerCase();
  if (requestedMode && requestedMode !== "ab_test" && !engineId(requestedMode)) {
    throw new Error(`STRATEGY_RUN_MODE references an unavailable model: ${requestedMode}. Available: ${STRATEGY_ENGINE_IDS.join(", ")}.`);
  }
  const runMode: StrategyRunMode = requestedMode === "ab_test"
    ? "ab_test"
    : engineId(requestedMode) ?? defaultEngineId;
  const requestedExecutionEngine = process.env.EXCHANGE_EXECUTION_ENGINE?.trim().toLowerCase();
  if (requestedExecutionEngine && requestedExecutionEngine !== "none" && !engineId(requestedExecutionEngine)) {
    throw new Error(`EXCHANGE_EXECUTION_ENGINE references an unavailable model: ${requestedExecutionEngine}. Available: ${STRATEGY_ENGINE_IDS.join(", ")}.`);
  }
  const executionEngine: ExchangeExecutionEngine = requestedExecutionEngine === "none"
    ? "none"
    : engineId(requestedExecutionEngine) ?? defaultEngineId;
  const initialCapitalUsdt = numberFromEnv("AB_INITIAL_CAPITAL_USDT", 1_000, 10, 10_000_000);
  const minimumDays = Math.round(numberFromEnv("AB_MIN_DAYS", 42, 7, 365));
  const activeEngines = runMode === "ab_test" ? abEngineIds() : [runMode];

  return {
    runMode,
    activeEngines,
    availableEngines: [...STRATEGY_ENGINE_IDS] as StrategyEngineId[],
    executionEngine,
    experimentId: process.env.AB_EXPERIMENT_ID?.trim() || `${activeEngines.join("-vs-")}-auto`,
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
