import { getTradingConfig } from "../config";
import { getSql } from "../db";
import { asPostgresJson } from "../postgres-json";
import type {
  DecisionBlocker,
  JevDecision,
  MarketIndicatorState,
  TradeAsset,
  TradingSetup,
} from "../types";
import type { StrategyEngine } from "./types";

export type PendingSignalStatus = "active" | "confirmed" | "invalidated" | "expired" | "replaced";

export interface PendingSignal {
  id: number;
  scopeId: string;
  experimentId: string | null;
  engineId: string;
  asset: TradeAsset;
  setup: TradingSetup;
  readiness: "wait_close" | "wait_retest";
  status: PendingSignalStatus;
  sourceCycleKey: string;
  sourceCandleAt: string;
  createdAt: string;
  expiresAt: string;
  triggerPrice: number;
  anchorPrice: number;
  atrPct: number;
  sourceDecision: JevDecision;
  retestSeenAt: string | null;
}

const fatalBlockers = new Set<DecisionBlocker>([
  "JEV_NO_ENTRY",
  "STRUCTURE_REJECTED",
  "DIRECTIONAL_EDGE_LOW",
  "SETUP_QUALITY_LOW",
  "NET_EDGE_LOW",
  "LIQUIDITY_LOW",
  "DISORDERLY_MARKET",
  "RISK_BUDGET_ZERO",
]);

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") return value as T;
  return JSON.parse(value) as T;
}

function mapPendingSignal(row: Record<string, unknown>): PendingSignal {
  return {
    id: Number(row.id),
    scopeId: String(row.scope_id),
    experimentId: row.experiment_id ? String(row.experiment_id) : null,
    engineId: String(row.engine_id),
    asset: String(row.asset) as TradeAsset,
    setup: String(row.setup) as TradingSetup,
    readiness: String(row.readiness) as PendingSignal["readiness"],
    status: String(row.status) as PendingSignalStatus,
    sourceCycleKey: String(row.source_cycle_key),
    sourceCandleAt: new Date(String(row.source_candle_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    triggerPrice: Number(row.trigger_price),
    anchorPrice: Number(row.anchor_price),
    atrPct: Number(row.atr_pct),
    sourceDecision: parseJson<JevDecision>(row.source_decision),
    retestSeenAt: row.retest_seen_at ? new Date(String(row.retest_seen_at)).toISOString() : null,
  };
}

function triggerPrice(setup: TradingSetup, market: MarketIndicatorState) {
  if (setup === "upside_breakout") return market.channel_24h_high;
  if (setup === "range_reversion") return market.channel_24h_low;
  if (setup === "bear_rebound") return market.ema_9;
  return market.ema_21;
}

function hasFatalBlocker(decision: JevDecision) {
  return (decision.blockedBy ?? []).some((blocker) => fatalBlockers.has(blocker));
}

function hasPendingBlocker(decision: JevDecision) {
  if (decision.blockedBy?.includes("PENDING_CLOSE")) return "wait_close" as const;
  if (decision.blockedBy?.includes("PENDING_RETEST")) return "wait_retest" as const;
  return null;
}

function nextClosedCandle(signal: PendingSignal, market: MarketIndicatorState) {
  return Date.parse(market.last_closed_15m_at) > Date.parse(signal.sourceCandleAt);
}

function closeConfirmation(signal: PendingSignal, market: MarketIndicatorState, minBearReboundScore: number) {
  if (signal.setup === "upside_breakout") {
    return market.last_price > signal.triggerPrice
      && market.return_15m_pct >= 0
      && market.volume_ratio_20 >= 0.9
      && market.upper_wick_atr < 0.75;
  }
  if (signal.setup === "range_reversion") {
    return market.channel_24h_position <= 0.5
      && market.return_15m_pct > 0
      && market.structure_12h !== "lower";
  }
  if (signal.setup === "bear_rebound") {
    return market.countertrend_rebound_score >= minBearReboundScore
      && market.return_15m_pct > 0
      && market.return_1h_pct > 0;
  }
  return market.last_price > market.ema_21
    && market.last_price > market.ema_200
    && market.return_15m_pct > 0
    && market.structure_12h !== "lower";
}

function retestConfirmation(signal: PendingSignal, market: MarketIndicatorState) {
  const absoluteAtr = signal.anchorPrice * Math.max(signal.atrPct, 0.1) / 100;
  const tolerance = Math.max(absoluteAtr * 0.35, signal.anchorPrice * 0.001);
  const touched = Math.abs(market.last_price - signal.triggerPrice) <= tolerance
    || (signal.setup === "upside_breakout"
      && market.last_price >= signal.triggerPrice
      && market.last_price <= signal.triggerPrice + tolerance);
  if (!touched) return { touched: false, confirmed: false };
  const confirmed = signal.setup === "range_reversion"
    ? market.last_price >= signal.triggerPrice && market.return_15m_pct > 0
    : market.last_price >= signal.triggerPrice
      && market.return_15m_pct >= 0
      && market.upper_wick_atr < 0.75;
  return { touched: true, confirmed };
}

export function evaluatePendingConfirmation(signal: PendingSignal, market: MarketIndicatorState) {
  if (!nextClosedCandle(signal, market)) return { touched: false, confirmed: false };
  if (signal.readiness === "wait_retest") return retestConfirmation(signal, market);
  return {
    touched: false,
    confirmed: closeConfirmation(signal, market, getTradingConfig().minBearReboundScore),
  };
}

async function getActiveSignals(scopeId: string, engineId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM engine_pending_signals
    WHERE scope_id = ${scopeId} AND engine_id = ${engineId} AND status = 'active'
  `;
  return rows.map((row) => mapPendingSignal(row as Record<string, unknown>));
}

async function resolveSignal(id: number, status: Exclude<PendingSignalStatus, "active">, cycleKey: string, reason: string) {
  const sql = getSql();
  await sql`
    UPDATE engine_pending_signals
    SET status = ${status}, resolved_at = NOW(), resolution_cycle_key = ${cycleKey}, resolution_reason = ${reason}
    WHERE id = ${id} AND status = 'active'
  `;
}

async function markRetestSeen(id: number, capturedAt: string) {
  const sql = getSql();
  await sql`
    UPDATE engine_pending_signals
    SET retest_seen_at = COALESCE(retest_seen_at, ${capturedAt}::timestamptz)
    WHERE id = ${id} AND status = 'active'
  `;
}

async function createPendingSignal(input: {
  scopeId: string;
  experimentId: string | null;
  engineId: string;
  cycleKey: string;
  capturedAt: string;
  decision: JevDecision;
  market: MarketIndicatorState;
  readiness: PendingSignal["readiness"];
}) {
  const sql = getSql();
  const config = getTradingConfig();
  const ttlMinutes = input.readiness === "wait_close" ? config.waitCloseTtlMinutes : config.waitRetestTtlMinutes;
  await sql`
    INSERT INTO engine_pending_signals (
      scope_id, experiment_id, engine_id, asset, setup, readiness, status, source_cycle_key,
      source_candle_at, created_at, expires_at, trigger_price, anchor_price, atr_pct, source_decision
    ) VALUES (
      ${input.scopeId}, ${input.experimentId}, ${input.engineId}, ${input.decision.asset},
      ${input.decision.selectedSetup}, ${input.readiness}, 'active', ${input.cycleKey},
      ${input.market.last_closed_15m_at}::timestamptz, ${input.capturedAt}::timestamptz,
      ${input.capturedAt}::timestamptz + (${ttlMinutes} * INTERVAL '1 minute'),
      ${triggerPrice(input.decision.selectedSetup, input.market)}, ${input.market.last_price},
      ${input.market.atr_14_pct}, ${sql.json(asPostgresJson(input.decision))}
    )
    ON CONFLICT (scope_id, engine_id, asset) WHERE status = 'active' DO NOTHING
  `;
}

function confirmedDecision(current: JevDecision, source: JevDecision, signal: PendingSignal) {
  const target = Math.max(current.targetAllocationPct, source.targetAllocationPct);
  const delta = target - current.currentAllocationPct;
  if (delta < getTradingConfig().allocationDeadbandPct) {
    return {
      ...current,
      targetAllocationPct: target,
      rebalanceDeltaPct: delta,
      action: "hold" as const,
      signalState: "confirmed" as const,
      blockedBy: ["ALLOCATION_DEADBAND" as const],
      policyReason: `${current.policyReason} Pending ${signal.readiness} confirmation completed, but the remaining allocation delta is inside the deadband.`,
    };
  }
  return {
    ...current,
    action: "buy" as const,
    confidence: Math.max(current.confidence, source.confidence),
    targetAllocationPct: target,
    rebalanceDeltaPct: delta,
    signalState: "confirmed" as const,
    blockedBy: [],
    policyReason: `${current.policyReason} Pending ${signal.readiness} signal was confirmed by a later closed candle.`,
  };
}

export async function applyStatefulConfirmation(input: {
  scopeId: string;
  experimentId?: string | null;
  engine: StrategyEngine;
  cycleKey: string;
  capturedAt: string;
  decisions: JevDecision[];
  indicators: Record<TradeAsset, MarketIndicatorState>;
}) {
  if (!input.engine.statefulConfirmation) return input.decisions;
  const active = await getActiveSignals(input.scopeId, input.engine.id);
  const byAsset = new Map(active.map((signal) => [signal.asset, signal]));
  const output: JevDecision[] = [];

  for (const original of input.decisions) {
    let decision = original;
    let signal = byAsset.get(decision.asset);
    const now = Date.parse(input.capturedAt);
    if (signal && now >= Date.parse(signal.expiresAt)) {
      await resolveSignal(signal.id, "expired", input.cycleKey, "Confirmation time-to-live elapsed.");
      signal = undefined;
      decision = { ...decision, signalState: "expired" };
    }
    if (signal && (hasFatalBlocker(decision) || decision.selectedSetup !== signal.setup)) {
      await resolveSignal(signal.id, "invalidated", input.cycleKey, "Fresh evidence invalidated or replaced the setup.");
      signal = undefined;
      decision = { ...decision, signalState: "invalidated" };
    }
    if (signal) {
      const confirmation = evaluatePendingConfirmation(signal, input.indicators[decision.asset]);
      if (confirmation.touched) await markRetestSeen(signal.id, input.capturedAt);
      if (confirmation.confirmed) {
        await resolveSignal(signal.id, "confirmed", input.cycleKey, "A later closed candle passed deterministic confirmation.");
        decision = confirmedDecision(decision, signal.sourceDecision, signal);
        signal = undefined;
      } else {
        const pendingBlocker: DecisionBlocker = signal.readiness === "wait_close" ? "PENDING_CLOSE" : "PENDING_RETEST";
        const pendingBlockers: DecisionBlocker[] = [
          ...(decision.blockedBy ?? []).filter((item) => !fatalBlockers.has(item)),
          pendingBlocker,
        ];
        decision = {
          ...decision,
          action: "hold",
          signalState: "pending",
          blockedBy: [...new Set(pendingBlockers)],
          policyReason: `${decision.policyReason} An active ${signal.readiness} signal is awaiting a later closed-candle confirmation.`,
        };
      }
    }

    const readiness = hasPendingBlocker(decision);
    if (!signal && decision.signalState !== "confirmed" && readiness && !hasFatalBlocker(decision)) {
      await createPendingSignal({
        scopeId: input.scopeId,
        experimentId: input.experimentId ?? null,
        engineId: input.engine.id,
        cycleKey: input.cycleKey,
        capturedAt: input.capturedAt,
        decision,
        market: input.indicators[decision.asset],
        readiness,
      });
      decision = { ...decision, action: "hold", signalState: "pending" };
    }
    output.push(decision);
  }
  return output;
}
