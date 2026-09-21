import { choice, noul, score, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import { getTradingConfig } from "../../config";
import type { TradeAsset } from "../../types";
import { assertBlindPayload, BLIND_SLOTS, buildBlindNumericState, type BlindSlot } from "../blind";
import {
  finalizeBlindRotationEvidence,
  type BlindRotationEvidence,
} from "../blind-policy";
import { buildRotationDecisions } from "../model2-policy";
import type { StrategyEngine } from "../types";

function regimeQuestion(slot: BlindSlot) {
  return choice(
    {
      objective: `Classify the rotation regime for state.candidates.${slot} over the next four to sixteen decision cycles.`,
      constraints: ["Use only normalized market evidence.", "Accumulation requires a base, improving structure and declining downside pressure.", "Do not infer instrument or date identity."],
    },
    { bull: "Orderly positive trend.", bear: "Persistent negative structure.", range: "Stable mean-reverting boundaries.", accumulation: "Improving post-decline base.", uncertain: "Conflicting evidence." },
  );
}

function suitabilityQuestion(slot: BlindSlot) {
  return choice(
    {
      objective: `Classify long-entry suitability for state.candidates.${slot}; this is evidence, not an order.`,
      constraints: ["Strong requires structure, timing, participation and positive cost-adjusted opportunity.", "Near an upper range boundary requires an accepted breakout.", "Do not become optimistic because application code owns risk."],
    },
    { strong: "Coherent and executable now.", moderate: "Promising but not exceptional.", watch: "Developing and needs confirmation.", reject: "No justified risk-increasing entry." },
  );
}

function thesisHealthQuestion(slot: BlindSlot) {
  return choice(
    { objective: `Classify long-thesis health for state.candidates.${slot}, independent of position sizing.`, constraints: ["Use invalid only when the evidence coherently breaks the thesis."] },
    { healthy: "Structure remains supportive.", weakening: "Material deterioration but not full invalidation.", invalid: "The long thesis is broken.", uncertain: "Evidence is inconclusive." },
  );
}

function timingQuestion(slot: BlindSlot) {
  return choice(
    { objective: `Judge timing for state.candidates.${slot} at this closed-candle boundary.`, constraints: ["A moving price alone is not confirmation."] },
    { enter_now: "Confirmed now.", wait_close: "Needs another close.", wait_retest: "Needs boundary retest.", no_entry: "No risk-increasing entry." },
  );
}

function directionQuestion(slot: BlindSlot) {
  return choice(
    { objective: `Judge cost-adjusted direction for state.candidates.${slot} over the next one to four hours.`, constraints: ["Choose unclear when evidence is not separated."] },
    { up: "Upside more likely.", down: "Downside more likely.", unclear: "No separated direction." },
  );
}

function planQualityQuestion(slot: BlindSlot) {
  return score(
    { objective: `Score evidence quality for a possible long plan in state.candidates.${slot}.`, constraints: ["Do not choose position size or authorize a trade."] },
    ["No defensible setup.", "Weak setup.", "Developing setup.", "Coherent setup.", "Exceptional multi-factor setup."],
  );
}

function invalidationQuestion(slot: BlindSlot) {
  return noul({ objective: `Is the long thesis in state.candidates.${slot} invalidated?`, constraints: ["Use structure, downside distribution, volatility and flow together."] });
}

function liquidityQuestion(slot: BlindSlot) {
  return noul({ objective: `Can state.candidates.${slot} support a normal application-sized spot change after costs?`, constraints: ["Unavailable optional leveraged-positioning data alone is not illiquidity."] });
}

export function buildBlindModel2State(state: Parameters<StrategyEngine["evaluate"]>[0]) {
  const blind = buildBlindNumericState(state);
  assertBlindPayload(blind.state);
  return blind;
}

export const model2BlindEngine: StrategyEngine = {
  id: "model2-blind",
  version: "model2-rotation-blind-v2",
  buildAuditState: (state) => buildBlindModel2State(state).state,
  async evaluate(engineState) {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim();
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");
    const model = process.env.JEV_MODEL_NAME?.trim() || "jev-1.13.0";
    const client = new TypeSafeClient({ apiKey, defaultModel: model, timeout: 12_000, retry: { maxRetries: 1 }, logLevel: "warn" });
    const blind = buildBlindModel2State(engineState);
    const questions = {
      c1_regime: regimeQuestion("candidate_1"), c1_suitability: suitabilityQuestion("candidate_1"), c1_thesis: thesisHealthQuestion("candidate_1"), c1_timing: timingQuestion("candidate_1"), c1_direction: directionQuestion("candidate_1"), c1_quality: planQualityQuestion("candidate_1"), c1_invalidation: invalidationQuestion("candidate_1"), c1_liquidity: liquidityQuestion("candidate_1"),
      c2_regime: regimeQuestion("candidate_2"), c2_suitability: suitabilityQuestion("candidate_2"), c2_thesis: thesisHealthQuestion("candidate_2"), c2_timing: timingQuestion("candidate_2"), c2_direction: directionQuestion("candidate_2"), c2_quality: planQualityQuestion("candidate_2"), c2_invalidation: invalidationQuestion("candidate_2"), c2_liquidity: liquidityQuestion("candidate_2"),
      c3_regime: regimeQuestion("candidate_3"), c3_suitability: suitabilityQuestion("candidate_3"), c3_thesis: thesisHealthQuestion("candidate_3"), c3_timing: timingQuestion("candidate_3"), c3_direction: directionQuestion("candidate_3"), c3_quality: planQualityQuestion("candidate_3"), c3_invalidation: invalidationQuestion("candidate_3"), c3_liquidity: liquidityQuestion("candidate_3"),
    } as const;
    const startedAt = Date.now();
    const response = await client.systemOne({ model, state: blind.state as unknown as EntryType, questions });
    const bySlot = {
      candidate_1: { regime: response.answers.c1_regime, suitability: response.answers.c1_suitability, thesisHealth: response.answers.c1_thesis, timing: response.answers.c1_timing, direction: response.answers.c1_direction, planQuality: response.answers.c1_quality, invalidationRisk: response.answers.c1_invalidation.noul, liquidityOk: response.answers.c1_liquidity.noul },
      candidate_2: { regime: response.answers.c2_regime, suitability: response.answers.c2_suitability, thesisHealth: response.answers.c2_thesis, timing: response.answers.c2_timing, direction: response.answers.c2_direction, planQuality: response.answers.c2_quality, invalidationRisk: response.answers.c2_invalidation.noul, liquidityOk: response.answers.c2_liquidity.noul },
      candidate_3: { regime: response.answers.c3_regime, suitability: response.answers.c3_suitability, thesisHealth: response.answers.c3_thesis, timing: response.answers.c3_timing, direction: response.answers.c3_direction, planQuality: response.answers.c3_quality, invalidationRisk: response.answers.c3_invalidation.noul, liquidityOk: response.answers.c3_liquidity.noul },
    } satisfies Record<BlindSlot, BlindRotationEvidence>;
    const evidence = Object.fromEntries(BLIND_SLOTS.map((slot) => [blind.aliases.slotToAsset[slot], bySlot[slot]])) as unknown as Record<TradeAsset, BlindRotationEvidence>;
    const finalized = finalizeBlindRotationEvidence(evidence, engineState.indicators, engineState.positions);
    return {
      engineId: "model2-blind",
      engineVersion: "model2-rotation-blind-v2",
      model: response.model,
      decisions: buildRotationDecisions(finalized.judgments, finalized.portfolioJudgments, engineState.indicators, engineState.positions, getTradingConfig()),
      portfolioJudgments: finalized.portfolioJudgments,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    };
  },
};

export default model2BlindEngine;
