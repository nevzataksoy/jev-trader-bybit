import { describe, expect, it } from "vitest";
import { getTradingConfig } from "../config";
import type { JevAssetJudgments, MarketIndicatorState, PositionContext, TradeAsset } from "../types";
import { TRADE_ASSETS } from "../types";
import { buildV3Decisions, buildV3PortfolioJudgments, unifiedRiskFraction } from "./v3-policy";

function evidence(readiness: "enter_now" | "wait_close" | "wait_retest" | "no_entry"): JevAssetJudgments {
  const probabilities = readiness === "enter_now"
    ? { enter_now: 0.62, wait_close: 0.18, wait_retest: 0.12, no_entry: 0.08 }
    : readiness === "wait_close"
      ? { enter_now: 0.25, wait_close: 0.5, wait_retest: 0.2, no_entry: 0.05 }
      : readiness === "wait_retest"
        ? { enter_now: 0.2, wait_close: 0.15, wait_retest: 0.6, no_entry: 0.05 }
        : { enter_now: 0.05, wait_close: 0.05, wait_retest: 0.05, no_entry: 0.85 };
  return {
    regime: { choice: "uptrend", confidence: 0.85, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
    best_setup: { choice: "trend_pullback", confidence: 0.82, probabilities: { trend_pullback: 0.8, upside_breakout: 0.05, range_reversion: 0.03, bear_rebound: 0.02, reduce: 0.02, none: 0.08 } },
    entry_readiness: { choice: readiness, confidence: 0.8, probabilities },
    direction: { choice: "up", confidence: 0.84, probabilities: { up: 0.76, down: 0.09, unclear: 0.15 } },
    follow_through: { choice: "continuation", confidence: 0.8, probabilities: { continuation: 0.72, reversal: 0.1, no_pattern: 0.18 } },
    setup_quality: { score: 3.2, confidence: 0.82, probabilities: {} },
    false_breakout: 0.16,
    reversal_confirmation: 0.7,
    liquidity_ok: 0.88,
    disorderly: 0.12,
    cut_position: 0.08,
  };
}

function market(asset: TradeAsset): MarketIndicatorState {
  return {
    symbol: `${asset}USDT`, last_price: 100, ema_21: 99, ema_200: 90,
    regime: "bull_trend", channel_24h_position: 0.55, price_zscore_20: -0.2,
    distance_to_24h_high_atr: 2, atr_14_pct: 1.5, bid_ask_spread_pct: 0.02,
    volume_ratio_20: 1.1, return_15m_pct: 0.2, return_1h_pct: 0.5,
    countertrend_rebound_score: 0.8,
  } as MarketIndicatorState;
}

function flat(asset: TradeAsset): PositionContext {
  return {
    asset, status: "flat", quantity: 0, value_usdt: 0, allocation_pct: 0,
    average_entry_price: null, unrealized_pnl_pct: null, cost_basis_quality: "unavailable",
    last_trade_action: null, last_trade_at: null, minutes_since_last_trade: null,
  };
}

function run(readiness: Parameters<typeof evidence>[0], profile: "model1" | "model2" = "model1") {
  const config = getTradingConfig();
  const judgments = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, evidence(asset === "BTC" ? readiness : "no_entry")])) as Record<TradeAsset, JevAssetJudgments>;
  const indicators = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, market(asset)])) as Record<TradeAsset, MarketIndicatorState>;
  const positions = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, flat(asset)])) as Record<TradeAsset, PositionContext>;
  const portfolio = buildV3PortfolioJudgments(judgments, config);
  return buildV3Decisions(profile, judgments, portfolio, indicators, positions, { BTC: 0.1, ETH: 0.1, XAUT: 0.1 }, config)[0];
}

describe("V3 stateful allocation policy", () => {
  it("reserves risk and emits a pending close signal instead of rejecting it", () => {
    const decision = run("wait_close");
    expect(decision.action).toBe("hold");
    expect(decision.signalState).toBe("pending");
    expect(decision.blockedBy).toContain("PENDING_CLOSE");
    expect(decision.grossRiskBudgetPct).toBeGreaterThan(0);
    expect(decision.targetAllocationPct).toBeGreaterThan(0);
  });

  it("allows an immediately ready setup through to a staged buy", () => {
    const decision = run("enter_now", "model2");
    expect(decision.action).toBe("buy");
    expect(decision.blockedBy).toEqual([]);
    expect(decision.targetAllocationPct).toBeGreaterThanOrEqual(15);
    expect(decision.targetAllocationPct).toBeLessThanOrEqual(20);
  });

  it("keeps no-entry as a hard veto with an explicit blocker", () => {
    const decision = run("no_entry");
    expect(decision.action).toBe("hold");
    expect(decision.blockedBy).toContain("JEV_NO_ENTRY");
  });

  it("uses one shared risk conversion for both V3 engines", () => {
    expect(unifiedRiskFraction("zero")).toBe(0);
    expect(unifiedRiskFraction("low")).toBe(0.25);
    expect(unifiedRiskFraction("medium")).toBe(0.5);
    expect(unifiedRiskFraction("high")).toBe(0.8);
  });
});
