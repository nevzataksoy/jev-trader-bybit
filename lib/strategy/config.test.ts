import { afterEach, describe, expect, it } from "vitest";
import { getExchangeRoutingState, getStrategyRuntimeConfig } from "./config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("strategy runtime configuration", () => {
  it("uses the clean-baseline Model1 V1 as the default", () => {
    delete process.env.STRATEGY_RUN_MODE;
    delete process.env.EXCHANGE_EXECUTION_ENGINE;
    expect(getStrategyRuntimeConfig()).toMatchObject({
      runMode: "model1-v1",
      activeEngines: ["model1-v1"],
      executionEngine: "model1-v1",
    });
  });

  it("forces exchange routing off in A/B mode even when trading is enabled", () => {
    process.env.STRATEGY_RUN_MODE = "ab_test";
    process.env.AB_ENGINE_IDS = "model1-v1,model2-v1";
    process.env.EXCHANGE_EXECUTION_ENGINE = "model1-v1";
    const strategy = getStrategyRuntimeConfig();
    expect(strategy.activeEngines).toEqual(["model1-v1", "model2-v1"]);
    expect(getExchangeRoutingState("model1-v1", strategy, true)).toEqual({
      allowed: false,
      reason: "ab_test_lock",
    });
    expect(getExchangeRoutingState("model2-v1", strategy, true).allowed).toBe(false);
  });

  it("rejects missing or duplicate A/B model files", () => {
    process.env.STRATEGY_RUN_MODE = "ab_test";
    process.env.AB_ENGINE_IDS = "model1-v1,model1-v1";
    expect(() => getStrategyRuntimeConfig()).toThrow("exactly two distinct");
    process.env.AB_ENGINE_IDS = "model1-v1,missing-model";
    expect(() => getStrategyRuntimeConfig()).toThrow("unavailable strategy models");
  });

  it("routes only the explicitly selected engine outside A/B mode", () => {
    process.env.STRATEGY_RUN_MODE = "model2-v1";
    process.env.EXCHANGE_EXECUTION_ENGINE = "model2-v1";
    const strategy = getStrategyRuntimeConfig();
    expect(getExchangeRoutingState("model2-v1", strategy, true).allowed).toBe(true);
    expect(getExchangeRoutingState("model1-v1", strategy, true).reason).toBe("engine_not_selected");
  });

  it("fails closed instead of silently selecting another deleted model", () => {
    process.env.STRATEGY_RUN_MODE = "deleted-model";
    expect(() => getStrategyRuntimeConfig()).toThrow("unavailable model");
  });
});
