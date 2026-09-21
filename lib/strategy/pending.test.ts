import { describe, expect, it } from "vitest";
import type { JevDecision, MarketIndicatorState } from "../types";
import {
  buildConfirmedDecision,
  evaluatePendingConfirmation,
  type PendingSignal,
} from "./pending";

const sourceCandleAt = "2026-09-21T12:00:00.000Z";
const baseSignal = {
  id: 1,
  scopeId: "test",
  experimentId: null,
  engineId: "model1-blind-v3",
  asset: "BTC",
  setup: "upside_breakout",
  readiness: "wait_close",
  status: "active",
  sourceCycleKey: sourceCandleAt,
  sourceCandleAt,
  createdAt: sourceCandleAt,
  expiresAt: "2026-09-21T14:00:00.000Z",
  triggerPrice: 100,
  anchorPrice: 101,
  atrPct: 1.5,
  sourceDecision: {} as PendingSignal["sourceDecision"],
  retestSeenAt: null,
} satisfies PendingSignal;

function market(candleAt: string, lastPrice = 101): MarketIndicatorState {
  return {
    last_closed_15m_at: candleAt,
    last_price: lastPrice,
    return_15m_pct: 0.3,
    return_1h_pct: 0.5,
    volume_ratio_20: 1.1,
    upper_wick_atr: 0.2,
    structure_12h: "higher",
    channel_24h_position: 1.01,
    countertrend_rebound_score: 0.8,
    ema_21: 99,
    ema_200: 90,
  } as MarketIndicatorState;
}

function pendingDecision(): JevDecision {
  return {
    asset: "BTC",
    action: "hold",
    confidence: 0.5375,
    probabilities: { buy: 0.266, hold: 0.734, sell: 0 },
    currentAllocationPct: 0,
    targetAllocationPct: 14.285,
    rebalanceDeltaPct: 14.285,
    selectedSetup: "trend_pullback",
    entryReadiness: "wait_retest",
    expectedNetEdgePct: 0.396,
    opportunityScore: 0.91,
    grossRiskBudgetPct: 25,
    readinessScore: 0.4515,
    signalState: "pending",
    blockedBy: ["PENDING_RETEST"],
    policyReason: "Awaiting retest.",
    judgments: {
      regime: { choice: "uptrend", confidence: 0.64, probabilities: { uptrend: 0.71, downtrend: 0, range: 0, compression: 0.26, transition: 0.03 } },
      best_setup: { choice: "trend_pullback", confidence: 0.31, probabilities: { trend_pullback: 1, upside_breakout: 0, range_reversion: 0, bear_rebound: 0, reduce: 0, none: 0 } },
      entry_readiness: { choice: "wait_retest", confidence: 0.33, probabilities: { enter_now: 0.09, wait_close: 0.38, wait_retest: 0.5, no_entry: 0.03 } },
      direction: { choice: "up", confidence: 0.63, probabilities: { up: 0.76, down: 0.03, unclear: 0.21 } },
      follow_through: { choice: "continuation", confidence: 0.63, probabilities: { continuation: 0.76, reversal: 0.03, no_pattern: 0.21 } },
      setup_quality: { score: 3.12, confidence: 0.74, probabilities: { 0: 0, 1: 0.01, 2: 0.07, 3: 0.7, 4: 0.22 } },
      false_breakout: 0.5,
      reversal_confirmation: 0.5,
      liquidity_ok: 0.78,
      disorderly: 0.21,
      cut_position: 0.21,
    },
  };
}

describe("pending signal confirmation", () => {
  it("never confirms against the same closed candle", () => {
    expect(evaluatePendingConfirmation(baseSignal, market(sourceCandleAt)).confirmed).toBe(false);
  });

  it("confirms a later breakout close", () => {
    expect(evaluatePendingConfirmation(baseSignal, market("2026-09-21T12:15:00.000Z")).confirmed).toBe(true);
  });

  it("requires a retest near the stored trigger", () => {
    const retest = { ...baseSignal, readiness: "wait_retest" as const };
    expect(evaluatePendingConfirmation(retest, market("2026-09-21T12:15:00.000Z", 104))).toEqual({ touched: false, confirmed: false });
    expect(evaluatePendingConfirmation(retest, market("2026-09-21T12:15:00.000Z", 100.2))).toEqual({ touched: true, confirmed: true });
  });

  it("recalibrates a deterministically confirmed V4 signal from evidence probabilities", () => {
    const decision = pendingDecision();
    const signal = { ...baseSignal, setup: "trend_pullback" as const, readiness: "wait_retest" as const, sourceDecision: decision };
    const confirmed = buildConfirmedDecision(decision, decision, signal, "evidence_weighted");

    expect(confirmed.action).toBe("buy");
    expect(confirmed.signalState).toBe("confirmed");
    expect(confirmed.confidence).toBeGreaterThan(0.72);
    expect(confirmed.probabilities.buy).toBe(confirmed.confidence);
    expect(confirmed.probabilities.hold).toBeCloseTo(1 - confirmed.confidence);
    expect(confirmed.blockedBy).toEqual([]);
  });

  it("keeps V3 legacy confirmation confidence unchanged", () => {
    const decision = pendingDecision();
    const signal = { ...baseSignal, setup: "trend_pullback" as const, readiness: "wait_retest" as const, sourceDecision: decision };
    const confirmed = buildConfirmedDecision(decision, decision, signal, "legacy");

    expect(confirmed.confidence).toBe(0.5375);
    expect(confirmed.probabilities).toEqual(decision.probabilities);
  });
});
