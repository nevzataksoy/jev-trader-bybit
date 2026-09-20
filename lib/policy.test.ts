import { describe, expect, it } from "vitest";
import { getTradingConfig } from "./config";
import { buildPortfolioDecisions } from "./policy";
import type { JevAssetJudgments, MarketIndicatorState, PositionContext, TradeAsset } from "./types";
import { TRADE_ASSETS } from "./types";

function judgments(direction: "up" | "down" | "unclear", cutPosition = 0.05): JevAssetJudgments {
  const probabilities = direction === "up"
    ? { up: 0.92, down: 0.03, unclear: 0.05 }
    : direction === "down"
      ? { up: 0.03, down: 0.92, unclear: 0.05 }
      : { up: 0.2, down: 0.2, unclear: 0.6 };
  return {
    direction: { choice: direction, confidence: 0.92, probabilities },
    follow_through: { choice: "continuation", confidence: 0.9, probabilities: { continuation: 0.9, reversal: 0.03, no_pattern: 0.07 } },
    setup_quality: { score: 2.9, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.03, 2: 0.12, 3: 0.84 } },
    liquidity_ok: 0.95,
    disorderly: 0.05,
    cut_position: cutPosition,
  };
}

function market(asset: TradeAsset): MarketIndicatorState {
  return {
    symbol: `${asset}USDT`, regime: "bull_trend", countertrend_rebound_score: 0.8,
    realized_volatility_24h_pct: 3, mamis_phase: "returning_confidence", mamis_confidence: 0.8,
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

describe("deterministic target allocation policy", () => {
  const config = getTradingConfig();

  it("stays in USDT instead of selling an asset that is not held", () => {
    const decisions = buildPortfolioDecisions(
      { BTC: judgments("down"), ETH: judgments("unclear"), XAUT: judgments("unclear") },
      { BTC: market("BTC"), ETH: market("ETH"), XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 0), XAUT: position("XAUT", 0) },
      null,
      config,
    );
    expect(decisions.find((item) => item.asset === "BTC")?.action).toBe("hold");
    expect(decisions.find((item) => item.asset === "BTC")?.targetAllocationPct).toBe(0);
  });

  it("opens exposure for a coherent setup and reduces held exposure for coherent downside", () => {
    const decisions = buildPortfolioDecisions(
      { BTC: judgments("up"), ETH: judgments("down"), XAUT: judgments("unclear") },
      { BTC: market("BTC"), ETH: { ...market("ETH"), regime: "bear_trend" }, XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 30), XAUT: position("XAUT", 0) },
      null,
      config,
    );
    expect(decisions.find((item) => item.asset === "BTC")?.action).toBe("buy");
    expect(decisions.find((item) => item.asset === "ETH")?.action).toBe("sell");
  });

  it("normalizes aggregate targets to preserve the configured USDT reserve", () => {
    const records = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, judgments("up")])) as Record<TradeAsset, JevAssetJudgments>;
    const decisions = buildPortfolioDecisions(
      records,
      { BTC: market("BTC"), ETH: market("ETH"), XAUT: market("XAUT") },
      { BTC: position("BTC", 0), ETH: position("ETH", 0), XAUT: position("XAUT", 0) },
      null,
      config,
    );
    const totalTarget = decisions.reduce((sum, decision) => sum + decision.targetAllocationPct, 0);
    expect(totalTarget).toBeLessThanOrEqual((1 - config.minUsdtReservePct) * 100 + 0.0001);
  });
});
