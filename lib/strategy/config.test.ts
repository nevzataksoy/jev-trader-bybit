import { afterEach, describe, expect, it } from "vitest";
import { getExchangeRoutingState, getStrategyRuntimeConfig } from "./config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("strategy runtime configuration", () => {
  it("keeps model1 as the backward-compatible default", () => {
    delete process.env.STRATEGY_RUN_MODE;
    delete process.env.EXCHANGE_EXECUTION_ENGINE;
    expect(getStrategyRuntimeConfig()).toMatchObject({
      runMode: "model1",
      activeEngines: ["model1"],
      executionEngine: "model1",
    });
  });

  it("forces exchange routing off in A/B mode even when trading is enabled", () => {
    process.env.STRATEGY_RUN_MODE = "ab_test";
    process.env.EXCHANGE_EXECUTION_ENGINE = "model1";
    const strategy = getStrategyRuntimeConfig();
    expect(getExchangeRoutingState("model1", strategy, true)).toEqual({
      allowed: false,
      reason: "ab_test_lock",
    });
    expect(getExchangeRoutingState("model2", strategy, true).allowed).toBe(false);
  });

  it("routes only the explicitly selected engine outside A/B mode", () => {
    process.env.STRATEGY_RUN_MODE = "model2";
    process.env.EXCHANGE_EXECUTION_ENGINE = "model2";
    const strategy = getStrategyRuntimeConfig();
    expect(getExchangeRoutingState("model2", strategy, true).allowed).toBe(true);
    expect(getExchangeRoutingState("model1", strategy, true).reason).toBe("engine_not_selected");
  });
});
