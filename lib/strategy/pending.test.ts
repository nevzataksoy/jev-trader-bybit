import { describe, expect, it } from "vitest";
import type { MarketIndicatorState } from "../types";
import { evaluatePendingConfirmation, type PendingSignal } from "./pending";

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
});
