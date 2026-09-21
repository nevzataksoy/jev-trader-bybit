import { afterEach, describe, expect, it } from "vitest";
import { assertLocalBacktestDatabase } from "./db";
import { createSimulationPortfolio, executeSimulationPlan } from "./exchange";
import { buildCycleTimes } from "./features";
import { createSimulationConfig } from "./runner";
import type { JevDecision } from "../types";

const previousRemoteOverride = process.env.ALLOW_REMOTE_BACKTEST_DB;

afterEach(() => {
  if (previousRemoteOverride === undefined) delete process.env.ALLOW_REMOTE_BACKTEST_DB;
  else process.env.ALLOW_REMOTE_BACKTEST_DB = previousRemoteOverride;
});

function decision(action: "buy" | "sell" | "hold"): JevDecision {
  return {
    asset: "BTC",
    action,
    confidence: 0.9,
    probabilities: { buy: 0.9, sell: 0.05, hold: 0.05 },
    currentAllocationPct: action === "sell" ? 20 : 0,
    targetAllocationPct: action === "sell" ? 10 : 20,
    rebalanceDeltaPct: action === "sell" ? -10 : 20,
    selectedSetup: "trend_pullback",
    entryReadiness: "enter_now",
    expectedNetEdgePct: 0.5,
    opportunityScore: 0.7,
    grossRiskBudgetPct: 80,
    policyReason: "test",
    judgments: {
      regime: { choice: "uptrend", confidence: 0.9, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
      best_setup: { choice: "trend_pullback", confidence: 0.9, probabilities: { trend_pullback: 0.8, upside_breakout: 0.05, range_reversion: 0.03, bear_rebound: 0.02, reduce: 0.05, none: 0.05 } },
      entry_readiness: { choice: "enter_now", confidence: 0.9, probabilities: { enter_now: 0.8, wait_close: 0.05, wait_retest: 0.1, no_entry: 0.05 } },
      direction: { choice: "up", confidence: 0.9, probabilities: { up: 0.9, down: 0.05, unclear: 0.05 } },
      follow_through: { choice: "continuation", confidence: 0.9, probabilities: { continuation: 0.9, reversal: 0.05, no_pattern: 0.05 } },
      setup_quality: { score: 2.5, confidence: 0.9, probabilities: { 0: 0, 1: 0.1, 2: 0.3, 3: 0.6 } },
      false_breakout: 0.1,
      reversal_confirmation: 0.7,
      liquidity_ok: 0.9,
      disorderly: 0.05,
      cut_position: 0.05,
    },
  };
}

describe("historical simulation safety and execution", () => {
  it("creates exactly 192 quarter-hour decisions for a 48-hour window", () => {
    const config = createSimulationConfig({ hours: 48, endAt: Date.UTC(2026, 8, 20, 22, 0) });
    expect(buildCycleTimes(config)).toHaveLength(192);
    expect(buildCycleTimes(config).at(-1)).toBe(config.endAt);
  });

  it("refuses a remote simulation database unless explicitly overridden", () => {
    delete process.env.ALLOW_REMOTE_BACKTEST_DB;
    expect(assertLocalBacktestDatabase("postgresql://postgres:x@127.0.0.1:5432/local")).toContain("127.0.0.1");
    expect(() => assertLocalBacktestDatabase("postgresql://user:x@example.neon.tech/db")).toThrow(/local-only/);
    process.env.ALLOW_REMOTE_BACKTEST_DB = "true";
    expect(assertLocalBacktestDatabase("postgresql://user:x@example.neon.tech/db")).toContain("neon.tech");
  });

  it("fills at the next candle open with adverse slippage and deducts fees", () => {
    const portfolio = createSimulationPortfolio(1_000);
    const execution = executeSimulationPlan({
      portfolio,
      decision: decision("buy"),
      plan: { allowed: true, reason: "approved", buyPctOfUsdt: 0.2, sellPctOfHolding: 0 },
      decisionPrice: 99,
      nextOpenPrice: 100,
      executionAt: Date.UTC(2026, 8, 20, 12, 0),
      orderId: "test-buy",
      takerFeePct: 0.1,
      slippagePct: 0.05,
    });
    expect(execution.fillPrice).toBeCloseTo(100.05);
    expect(execution.feeUsdt).toBeCloseTo(0.2);
    expect(execution.slippageUsdt).toBeGreaterThan(0);
    expect(portfolio.cashUsdt).toBeCloseTo(799.8);
    expect(portfolio.quantities.BTC).toBeGreaterThan(0);
  });
});
