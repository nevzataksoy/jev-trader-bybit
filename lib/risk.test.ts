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
  estimatedSlippagePct: 0.03,
  maxMarketSlippagePct: 0.2,
  minTradableRangeToCostRatio: 2.5,
  maxPortfolioDrawdownPct: 3,
  assetCooldownMinutes: 60,
  maxCompletedOrders24h: 8,
  maxBuysPerCycle: 1,
  allocationDeadbandPct: 3,
  minPolicyConfidence: 0.58,
  minSellConfidence: 0.6,
  minDirectionalEdge: 0.15,
  minSetupScore: 1.5,
  minLiquidityProbability: 0.55,
  disorderlyProbability: 0.7,
  cutPositionProbability: 0.72,
  macroCacheHours: 6,
};

const balances: SpotBalance[] = [
  { coin: "USDT", free: 600, locked: 0, total: 600, usdtValue: 600 },
  { coin: "BTC", free: 0.004, locked: 0, total: 0.004, usdtValue: 200 },
  { coin: "ETH", free: 0.05, locked: 0, total: 0.05, usdtValue: 100 },
  { coin: "XAUT", free: 0.03, locked: 0, total: 0.03, usdtValue: 100 },
];

const market = {
  observed_at: new Date().toISOString(),
  last_closed_15m_at: new Date(Date.now() - 15 * 60 * 1_000).toISOString(),
  bid_ask_spread_pct: 0.02,
  atr_14_pct: 1,
  realized_volatility_24h_pct: 4,
  regime: "bull_trend",
  countertrend_rebound_score: 0.4,
} as MarketIndicatorState;

const context = {
  position: {
    asset: "BTC" as const,
    status: "held" as const,
    quantity: 0.004,
    value_usdt: 200,
    allocation_pct: 20,
    average_entry_price: 45_000,
    unrealized_pnl_pct: 10,
    cost_basis_quality: "complete" as const,
    last_trade_action: null,
    last_trade_at: null,
    minutes_since_last_trade: null,
  },
  fee: { symbol: "BTCUSDT", maker_fee_pct: 0.1, taker_fee_pct: 0.1 },
  portfolioRisk: {
    window_hours: 24 as const,
    starting_equity_usdt: 1_000,
    peak_equity_usdt: 1_010,
    current_drawdown_pct: 0.99,
    completed_orders_24h: 0,
  },
};

function decision(action: JevDecision["action"], confidence = 0.8): JevDecision {
  const target = action === "buy" ? 30 : action === "sell" ? 10 : 20;
  return {
    asset: "BTC", action, confidence, probabilities: { buy: 0.8, hold: 0.1, sell: 0.1 },
    currentAllocationPct: 20, targetAllocationPct: target, rebalanceDeltaPct: target - 20,
    policyReason: "test",
    judgments: {
      direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.8, down: 0.1, unclear: 0.1 } },
      follow_through: { choice: "continuation", confidence: 0.8, probabilities: { continuation: 0.8, reversal: 0.1, no_pattern: 0.1 } },
      setup_quality: { score: 2.5, confidence: 0.8, probabilities: { 0: 0.05, 1: 0.1, 2: 0.25, 3: 0.6 } },
      liquidity_ok: 0.9, disorderly: 0.1, cut_position: action === "sell" ? 0.8 : 0.1,
    },
  };
}

describe("deterministic execution risk gates", () => {
  it("volatility-scales buys while preserving the USDT reserve", () => {
    const plan = createExecutionPlan(decision("buy"), market, balances, 1_000, config, context);
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
      context,
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
      context,
    );
    expect(plan.allowed).toBe(true);
  });

  it("does not allow a sell when the asset is not held", () => {
    const flatBalances = balances.map((balance) => balance.coin === "BTC"
      ? { ...balance, free: 0, total: 0, usdtValue: 0 }
      : balance);
    const plan = createExecutionPlan(decision("sell"), market, flatBalances, 800, config, {
      ...context,
      position: { ...context.position, status: "flat", quantity: 0, value_usdt: 0 },
    });
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toContain("below the minimum");
  });

  it("blocks new buys during a portfolio drawdown circuit breaker", () => {
    const plan = createExecutionPlan(decision("buy"), market, balances, 1_000, config, {
      ...context,
      portfolioRisk: { ...context.portfolioRisk, current_drawdown_pct: 3.1 },
    });
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toContain("drawdown");
  });

  it("blocks a buy whose tradable range is too small for round-trip costs", () => {
    const plan = createExecutionPlan(
      decision("buy"),
      { ...market, atr_14_pct: 0.2 },
      balances,
      1_000,
      config,
      context,
    );
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toContain("ATR-to-cost");
  });
});
