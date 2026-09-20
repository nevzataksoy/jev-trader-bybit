import { describe, expect, it } from "vitest";
import { createExecutionPlan } from "./risk";
import type { JevDecision, MarketIndicatorState, SpotBalance } from "./types";

const config = {
  enabled: true,
  minConfidence: 0.72,
  buyPctOfUsdt: 0.2,
  sellPctOfHolding: 0.25,
  minTradeUsdt: 5,
  minUsdtReservePct: 0.2,
  maxAssetAllocationPct: 0.5,
  targetDailyVolatilityPct: 3,
  maxDailyVolatilityPct: 10,
  maxSpreadPct: 0.25,
  minBearReboundScore: 0.62,
};

const balances: SpotBalance[] = [
  { coin: "USDT", free: 600, locked: 0, total: 600, usdtValue: 600 },
  { coin: "BTC", free: 0.004, locked: 0, total: 0.004, usdtValue: 200 },
  { coin: "ETH", free: 0.05, locked: 0, total: 0.05, usdtValue: 100 },
  { coin: "XAUT", free: 0.03, locked: 0, total: 0.03, usdtValue: 100 },
];

const market = {
  observed_at: new Date().toISOString(),
  bid_ask_spread_pct: 0.02,
  realized_volatility_24h_pct: 4,
  regime: "bull_trend",
  countertrend_rebound_score: 0.4,
} as MarketIndicatorState;

function decision(action: JevDecision["action"], confidence = 0.8): JevDecision {
  return { asset: "BTC", action, confidence, probabilities: { buy: 0.8, hold: 0.1, sell: 0.1 } };
}

describe("deterministic execution risk gates", () => {
  it("volatility-scales buys while preserving the USDT reserve", () => {
    const plan = createExecutionPlan(decision("buy"), market, balances, 1_000, config);
    expect(plan.allowed).toBe(true);
    expect(plan.buyPctOfUsdt).toBeGreaterThan(0);
    expect(plan.buyPctOfUsdt).toBeLessThan(config.buyPctOfUsdt);
  });

  it("blocks a weak bear-market rebound buy", () => {
    const plan = createExecutionPlan(
      decision("buy"),
      { ...market, regime: "bear_trend", countertrend_rebound_score: 0.4 },
      balances,
      1_000,
      config,
    );
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toContain("rebound score");
  });

  it("permits risk-reduction sells even in high volatility", () => {
    const plan = createExecutionPlan(
      decision("sell"),
      { ...market, realized_volatility_24h_pct: 25 },
      balances,
      1_000,
      config,
    );
    expect(plan.allowed).toBe(true);
  });
});
