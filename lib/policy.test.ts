import { describe, expect, it } from "vitest";
import { getTradingConfig } from "./config";
import { buildPortfolioDecisions } from "./policy";
import type { JevAssetJudgments, JevPortfolioJudgments, MarketIndicatorState, PositionContext, TradeAsset } from "./types";
import { TRADE_ASSETS } from "./types";

function judgments(direction: "up" | "down" | "unclear", cutPosition = 0.05): JevAssetJudgments {
  const probabilities = direction === "up"
    ? { up: 0.92, down: 0.03, unclear: 0.05 }
    : direction === "down"
      ? { up: 0.03, down: 0.92, unclear: 0.05 }
      : { up: 0.2, down: 0.2, unclear: 0.6 };
  const setup = direction === "up" ? "trend_pullback" as const : direction === "down" ? "reduce" as const : "none" as const;
  const readiness = direction === "up" ? "enter_now" as const : "no_entry" as const;
  return {
    regime: { choice: direction === "up" ? "uptrend" : direction === "down" ? "downtrend" : "transition", confidence: 0.9, probabilities: { uptrend: 0.8, downtrend: 0.05, range: 0.05, compression: 0.05, transition: 0.05 } },
    best_setup: { choice: setup, confidence: 0.9, probabilities: { trend_pullback: direction === "up" ? 0.8 : 0.05, upside_breakout: 0.05, range_reversion: 0.03, bear_rebound: 0.02, reduce: direction === "down" ? 0.8 : 0.05, none: direction === "unclear" ? 0.8 : 0.05 } },
    entry_readiness: { choice: readiness, confidence: 0.9, probabilities: { enter_now: direction === "up" ? 0.9 : 0.05, wait_close: 0.02, wait_retest: 0.03, no_entry: direction === "up" ? 0.05 : 0.9 } },
    direction: { choice: direction, confidence: 0.92, probabilities },
    follow_through: { choice: "continuation", confidence: 0.9, probabilities: { continuation: 0.9, reversal: 0.03, no_pattern: 0.07 } },
    setup_quality: { score: 3.7, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.02, 2: 0.05, 3: 0.2, 4: 0.72 } },
    false_breakout: 0.1,
    reversal_confirmation: 0.75,
    liquidity_ok: 0.95,
    disorderly: 0.05,
    cut_position: cutPosition,
  };
}

function market(asset: TradeAsset): MarketIndicatorState {
  return {
    symbol: `${asset}USDT`, regime: "bull_trend", countertrend_rebound_score: 0.8,
    realized_volatility_24h_pct: 3, mamis_phase: "returning_confidence", mamis_confidence: 0.8,
    last_price: 100, ema_200: 90, price_zscore_20: -0.2, channel_24h_position: 0.55,
    distance_to_24h_high_atr: 2, atr_14_pct: 1.5, bid_ask_spread_pct: 0.02,
    volume_ratio_20: 1.1, return_15m_pct: 0.2, return_1h_pct: 0.5,
  } as MarketIndicatorState;
}

function position(asset: TradeAsset, allocationPct: number): PositionContext {
  return {
    asset, status: allocationPct > 0 ? "held" : "flat", quantity: allocationPct > 0 ? 1 : 0,
    value_usdt: allocationPct * 10, allocation_pct: allocationPct, average_entry_price: null,
    unrealized_pnl_pct: null, cost_basis_quality: "unavailable", last_trade_action: null,
    last_trade_at: null, minutes_since_last_trade: null,
  };
}

function portfolio(preferred: "USDT" | TradeAsset = "BTC"): JevPortfolioJudgments {
  return {
    preferred_destination: { choice: preferred, confidence: 0.9, probabilities: { USDT: preferred === "USDT" ? 0.8 : 0.05, BTC: preferred === "BTC" ? 0.8 : 0.05, ETH: preferred === "ETH" ? 0.8 : 0.05, XAUT: preferred === "XAUT" ? 0.8 : 0.05 } },
    gross_risk_budget: { choice: preferred === "USDT" ? "zero" : "high", confidence: 0.9, probabilities: { zero: preferred === "USDT" ? 0.9 : 0.02, low: 0.03, medium: 0.05, high: preferred === "USDT" ? 0.02 : 0.9 } },
    opportunity_separation: { score: 2.5, confidence: 0.8, probabilities: { 0: 0.05, 1: 0.1, 2: 0.3, 3: 0.55 } },
  };
}

const fees = { BTC: 0.1, ETH: 0.1, XAUT: 0.1 };

describe("regime and setup-aware target allocation policy", () => {
  const config = getTradingConfig();

  it("stays in USDT instead of selling an asset that is not held", () => {
    const decisions = buildPortfolioDecisions(
      { BTC: judgments("down"), ETH: judgments("unclear"), XAUT: judgments("unclear") }, portfolio("USDT"),
      { BTC: market("BTC"), ETH: market("ETH"), XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 0), XAUT: position("XAUT", 0) }, null, fees, config,
    );
    expect(decisions.find((item) => item.asset === "BTC")?.action).toBe("hold");
    expect(decisions.find((item) => item.asset === "BTC")?.targetAllocationPct).toBe(0);
  });

  it("opens a qualified pullback and reduces coherently bearish held exposure", () => {
    const decisions = buildPortfolioDecisions(
      { BTC: judgments("up"), ETH: judgments("down", 0.8), XAUT: judgments("unclear") }, portfolio("BTC"),
      { BTC: market("BTC"), ETH: { ...market("ETH"), regime: "bear_trend" }, XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 30), XAUT: position("XAUT", 0) }, null, fees, config,
    );
    expect(decisions.find((item) => item.asset === "BTC")?.action).toBe("buy");
    expect(decisions.find((item) => item.asset === "ETH")?.action).toBe("sell");
  });

  it("blocks a range-reversion buy near the upper channel", () => {
    const rangeJudgment = judgments("up");
    rangeJudgment.regime.choice = "range";
    rangeJudgment.best_setup.choice = "range_reversion";
    const decisions = buildPortfolioDecisions(
      { BTC: rangeJudgment, ETH: judgments("unclear"), XAUT: judgments("unclear") }, portfolio("BTC"),
      { BTC: { ...market("BTC"), regime: "range", channel_24h_position: 0.9 }, ETH: market("ETH"), XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 0), XAUT: position("XAUT", 0) }, null, fees, config,
    );
    expect(decisions[0].action).toBe("hold");
    expect(decisions[0].policyReason).toContain("market-structure gate");
  });

  it("preserves the configured USDT reserve across qualified assets", () => {
    const records = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, judgments("up")])) as Record<TradeAsset, JevAssetJudgments>;
    const decisions = buildPortfolioDecisions(
      records, portfolio("BTC"),
      { BTC: market("BTC"), ETH: market("ETH"), XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 0), XAUT: position("XAUT", 0) }, null, fees, config,
    );
    const totalTarget = decisions.reduce((sum, decision) => sum + decision.targetAllocationPct, 0);
    expect(totalTarget).toBeLessThanOrEqual((1 - config.minUsdtReservePct) * 100 + 0.0001);
  });
});
