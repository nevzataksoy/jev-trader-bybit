import { choice, noul, score, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import type { JevTradingState } from "../../../../jev";
import type { JevAssetJudgments, TradeAsset } from "../../../../types";
import { assertBlindPayload, BLIND_SLOTS, buildBlindNumericState, type BlindCandidateNumericState, type BlindSlot } from "../../../platform/blind-market";

function movement(value: number, atr: number) {
  const normalized = value / Math.max(atr, 0.01);
  if (normalized >= 1.5) return "strong rise relative to typical range";
  if (normalized >= 0.45) return "moderate rise relative to typical range";
  if (normalized <= -1.5) return "strong fall relative to typical range";
  if (normalized <= -0.45) return "moderate fall relative to typical range";
  return "little movement relative to typical range";
}

function momentum(value: number) {
  if (value >= 70) return "statistically stretched upward";
  if (value <= 30) return "statistically stretched downward";
  if (value >= 55) return "positive without an extreme";
  if (value <= 45) return "negative without an extreme";
  return "neutral";
}

function channel(position: number) {
  if (position > 1) return "above the prior boundary";
  if (position >= 0.85) return "near the upper boundary";
  if (position >= 0.6) return "in the upper half";
  if (position >= 0.4) return "near the middle";
  if (position >= 0.15) return "in the lower half";
  if (position >= 0) return "near the lower boundary";
  return "below the prior boundary";
}

function semanticCandidate(candidate: BlindCandidateNumericState) {
  return {
    inventory: candidate.inventory,
    trend: candidate.trend.deterministic_regime.replaceAll("_", " "),
    behavioral_phase: {
      phase: candidate.risk_and_participation.behavioral_phase.replaceAll("_", " "),
      confidence: candidate.risk_and_participation.behavioral_phase_confidence,
    },
    price_action: {
      last_fifteen_minutes: movement(candidate.returns_pct.m15, candidate.risk_and_participation.atr_14_pct),
      last_hour: movement(candidate.returns_pct.h1, candidate.risk_and_participation.atr_14_pct),
      last_four_hours: movement(candidate.returns_pct.h4, candidate.risk_and_participation.atr_14_pct),
      last_day: movement(candidate.returns_pct.d1, candidate.risk_and_participation.atr_14_pct),
      relative_strength: candidate.returns_pct.relative_to_candidate_median_d1 > 0.25
        ? "stronger than the candidate median"
        : candidate.returns_pct.relative_to_candidate_median_d1 < -0.25
          ? "weaker than the candidate median" : "near the candidate median",
      momentum: momentum(candidate.trend.rsi_14),
      trend_character: candidate.trend.trend_efficiency_4h >= 0.65
        ? "orderly and directional"
        : candidate.trend.trend_efficiency_4h <= 0.3 ? "noisy and mean-reverting" : "mixed directional efficiency",
      structure: {
        prior_day_channel: channel(candidate.range_and_breakout.channel_24h_position),
        prior_three_day_channel: channel(candidate.range_and_breakout.channel_3d_position),
        prior_seven_day_channel: channel(candidate.range_and_breakout.channel_7d_position),
        swings: candidate.trend.structure_12h,
        volatility: candidate.range_and_breakout.bb_width_percentile_7d <= 0.2
          ? "compressed" : candidate.range_and_breakout.bb_width_percentile_7d >= 0.8 ? "expanded" : "middle range",
        upper_rejection: candidate.range_and_breakout.upper_wick_atr >= 0.6,
        lower_rejection: candidate.range_and_breakout.lower_wick_atr >= 0.6,
        support: {
          lower_distance_pct: candidate.range_and_breakout.support_zone_low_distance_pct,
          upper_distance_pct: candidate.range_and_breakout.support_zone_high_distance_pct,
          strength: candidate.range_and_breakout.support_strength,
        },
        resistance: {
          lower_distance_pct: candidate.range_and_breakout.resistance_zone_low_distance_pct,
          upper_distance_pct: candidate.range_and_breakout.resistance_zone_high_distance_pct,
          strength: candidate.range_and_breakout.resistance_strength,
          secondary_distance_pct: candidate.range_and_breakout.secondary_resistance_distance_pct,
        },
      },
    },
    participation_and_risk: {
      traded_activity: candidate.risk_and_participation.volume_zscore_20 >= 1.5
        ? "exceptionally high" : candidate.risk_and_participation.volume_zscore_20 >= 0.5
          ? "above normal" : candidate.risk_and_participation.volume_zscore_20 <= -1 ? "unusually light" : "near normal",
      downside_volatility_dominant: candidate.risk_and_participation.downside_volatility_24h_pct
        > candidate.risk_and_participation.realized_volatility_24h_pct * 0.8,
      recent_drawdown_pct: candidate.risk_and_participation.drawdown_20d_pct,
      volatility_context: {
        atr_15m_pct: candidate.risk_and_participation.atr_14_pct,
        atr_1h_pct: candidate.risk_and_participation.atr_14_1h_pct,
        atr_4h_pct: candidate.risk_and_participation.atr_14_4h_pct,
        atr_percentile: candidate.risk_and_participation.atr_15m_percentile,
      },
    },
    execution: {
      flow: candidate.execution.trade_flow_imbalance,
      resting_liquidity_imbalance: candidate.execution.orderbook_imbalance,
      depth_ratio: candidate.execution.depth_ratio,
      round_trip_cost_pct: candidate.execution.round_trip_cost_pct,
      atr_to_cost_ratio: candidate.execution.atr_to_cost_ratio,
      wall_bias: candidate.execution.orderbook_wall_bias,
      bid_wall: {
        distance_pct: candidate.execution.bid_wall_distance_pct,
        share: candidate.execution.bid_wall_share,
        persistence: candidate.execution.bid_wall_persistence,
      },
      ask_wall: {
        distance_pct: candidate.execution.ask_wall_distance_pct,
        share: candidate.execution.ask_wall_share,
        persistence: candidate.execution.ask_wall_persistence,
      },
      provenance: candidate.execution.microstructure_provenance,
    },
    leveraged_positioning: candidate.leveraged_positioning,
  };
}

export function buildBlindModel1State(state: JevTradingState) {
  const blind = buildBlindNumericState(state);
  const semantic = {
    schema_version: blind.state.schema_version,
    evaluator_role: blind.state.evaluator_role,
    time_context: blind.state.time_context,
    global_context: blind.state.global_context,
    candidates: Object.fromEntries(BLIND_SLOTS.map((slot) => [slot, semanticCandidate(blind.state.candidates[slot])])),
  };
  assertBlindPayload(semantic);
  return { aliases: blind.aliases, state: semantic };
}

function regimeQuestion(slot: BlindSlot) {
  return choice({ objective: `Classify the executable regime in state.candidates.${slot}.`, constraints: ["Use only supplied evidence.", "Choose transition when material evidence conflicts.", "Do not infer instrument or calendar identity."] }, { uptrend: "Persistent higher structure.", downtrend: "Persistent lower structure.", range: "Stable mean-reverting boundaries.", compression: "Compressed volatility awaiting confirmation.", transition: "Changing or conflicting structure." });
}

function setupQuestion(slot: BlindSlot) {
  return choice({ objective: `Select the best long-only setup supported by state.candidates.${slot}.`, constraints: ["Select none without positive executable evidence.", "Prefer entries near a supported structural zone or after accepted resistance breakout.", "A range entry belongs near support; a breakout needs participation and acceptance.", "Do not output an order."] }, { trend_pullback: "Orderly pullback in an intact rise.", upside_breakout: "Accepted upper-boundary break.", range_reversion: "Supported lower-boundary mean reversion.", bear_rebound: "Confirmed tactical rebound in a decline.", reduce: "Existing long thesis is deteriorating.", none: "No executable setup." });
}

function readinessQuestion(slot: BlindSlot) {
  return choice({ objective: `Judge entry readiness for state.candidates.${slot}.`, constraints: ["Closed evidence must confirm enter_now.", "Do not infer identity."] }, { enter_now: "Confirmed now.", wait_close: "Needs another close.", wait_retest: "Needs a retest.", no_entry: "No acceptable entry." });
}

function directionQuestion(slot: BlindSlot) {
  return choice({ objective: `Judge executable direction for state.candidates.${slot} over the next one to four decision cycles.`, constraints: ["Use unclear when evidence conflicts.", "Use target room, invalidation structure, persistent liquidity and round-trip cost together; ATR alone is not a trade target."] }, { up: "Higher after costs is more likely.", down: "Lower is more likely.", unclear: "No separated direction." });
}

function followThroughQuestion(slot: BlindSlot) {
  return choice({ objective: `Judge persistence of the visible move in state.candidates.${slot}.`, constraints: ["Separate persistence from direction."] }, { continuation: "Structure supports persistence.", reversal: "Exhaustion or contradiction supports reversal.", no_pattern: "No stable pattern." });
}

function setupQualityQuestion(slot: BlindSlot) {
  return score({ objective: `Score setup quality for state.candidates.${slot}.`, constraints: ["Score multi-timeframe support/resistance agreement, price action, participation, persistent liquidity and positioning.", "Global macro evidence is a modifier, not a standalone trigger.", "Score evidence agreement and tradability, not excitement."] }, ["No usable setup.", "Weak setup.", "Developing setup.", "Coherent setup.", "Exceptional setup."]);
}

function falseBreakoutQuestion(slot: BlindSlot) {
  return noul({ objective: `Is an upper-boundary test in state.candidates.${slot} likely to fail?`, constraints: ["Use acceptance, participation and rejection shape."] });
}

function reversalQuestion(slot: BlindSlot) {
  return noul({ objective: `Is an upward reversal in state.candidates.${slot} sufficiently confirmed?`, constraints: ["Oversold status alone is insufficient."] });
}

function liquidityQuestion(slot: BlindSlot) {
  return noul({ objective: `Is state.candidates.${slot} executable after spread, fees, slippage and available liquidity?`, constraints: ["Unavailable optional positioning data alone is not illiquidity."] });
}

function disorderQuestion(slot: BlindSlot) {
  return noul({ objective: `Is state.candidates.${slot} disorderly enough to block new exposure?`, constraints: ["Use volatility, flow, liquidity and price discovery together."] });
}

function invalidationQuestion(slot: BlindSlot) {
  return noul({ objective: `Is the long thesis in state.candidates.${slot} invalidated?`, constraints: ["Judge evidence only; deterministic policy decides any action."] });
}

export async function evaluateBlindModel1Evidence(engineState: JevTradingState) {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");
  const model = process.env.JEV_MODEL_NAME?.trim() || "jev-1.13.0";
  const client = new TypeSafeClient({ apiKey, defaultModel: model, timeout: 12_000, retry: { maxRetries: 1 }, logLevel: "warn" });
  const blind = buildBlindModel1State(engineState);
  const questions = {
    c1_regime: regimeQuestion("candidate_1"), c1_setup: setupQuestion("candidate_1"), c1_readiness: readinessQuestion("candidate_1"), c1_direction: directionQuestion("candidate_1"), c1_follow: followThroughQuestion("candidate_1"), c1_quality: setupQualityQuestion("candidate_1"), c1_false_breakout: falseBreakoutQuestion("candidate_1"), c1_reversal: reversalQuestion("candidate_1"), c1_liquidity: liquidityQuestion("candidate_1"), c1_disorder: disorderQuestion("candidate_1"), c1_invalidation: invalidationQuestion("candidate_1"),
    c2_regime: regimeQuestion("candidate_2"), c2_setup: setupQuestion("candidate_2"), c2_readiness: readinessQuestion("candidate_2"), c2_direction: directionQuestion("candidate_2"), c2_follow: followThroughQuestion("candidate_2"), c2_quality: setupQualityQuestion("candidate_2"), c2_false_breakout: falseBreakoutQuestion("candidate_2"), c2_reversal: reversalQuestion("candidate_2"), c2_liquidity: liquidityQuestion("candidate_2"), c2_disorder: disorderQuestion("candidate_2"), c2_invalidation: invalidationQuestion("candidate_2"),
    c3_regime: regimeQuestion("candidate_3"), c3_setup: setupQuestion("candidate_3"), c3_readiness: readinessQuestion("candidate_3"), c3_direction: directionQuestion("candidate_3"), c3_follow: followThroughQuestion("candidate_3"), c3_quality: setupQualityQuestion("candidate_3"), c3_false_breakout: falseBreakoutQuestion("candidate_3"), c3_reversal: reversalQuestion("candidate_3"), c3_liquidity: liquidityQuestion("candidate_3"), c3_disorder: disorderQuestion("candidate_3"), c3_invalidation: invalidationQuestion("candidate_3"),
  } as const;
  const startedAt = Date.now();
  const response = await client.systemOne({ model, state: blind.state as unknown as EntryType, questions });
  const bySlot = {
    candidate_1: { regime: response.answers.c1_regime, best_setup: response.answers.c1_setup, entry_readiness: response.answers.c1_readiness, direction: response.answers.c1_direction, follow_through: response.answers.c1_follow, setup_quality: response.answers.c1_quality, false_breakout: response.answers.c1_false_breakout.noul, reversal_confirmation: response.answers.c1_reversal.noul, liquidity_ok: response.answers.c1_liquidity.noul, disorderly: response.answers.c1_disorder.noul, cut_position: response.answers.c1_invalidation.noul },
    candidate_2: { regime: response.answers.c2_regime, best_setup: response.answers.c2_setup, entry_readiness: response.answers.c2_readiness, direction: response.answers.c2_direction, follow_through: response.answers.c2_follow, setup_quality: response.answers.c2_quality, false_breakout: response.answers.c2_false_breakout.noul, reversal_confirmation: response.answers.c2_reversal.noul, liquidity_ok: response.answers.c2_liquidity.noul, disorderly: response.answers.c2_disorder.noul, cut_position: response.answers.c2_invalidation.noul },
    candidate_3: { regime: response.answers.c3_regime, best_setup: response.answers.c3_setup, entry_readiness: response.answers.c3_readiness, direction: response.answers.c3_direction, follow_through: response.answers.c3_follow, setup_quality: response.answers.c3_quality, false_breakout: response.answers.c3_false_breakout.noul, reversal_confirmation: response.answers.c3_reversal.noul, liquidity_ok: response.answers.c3_liquidity.noul, disorderly: response.answers.c3_disorder.noul, cut_position: response.answers.c3_invalidation.noul },
  } satisfies Record<BlindSlot, JevAssetJudgments>;
  const judgments = Object.fromEntries(BLIND_SLOTS.map((slot) => [blind.aliases.slotToAsset[slot], bySlot[slot]])) as unknown as Record<TradeAsset, JevAssetJudgments>;
  return { model: response.model, judgments, usage: response.usage, latencyMs: Date.now() - startedAt };
}
