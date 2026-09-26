import { choice, noul, score, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import type { JevTradingState } from "../../../../jev";
import type { TradeAsset } from "../../../../types";
import { assertBlindPayload, BLIND_SLOTS, buildBlindNumericState, type BlindSlot } from "../../../platform/blind-market";
import type { BlindRotationEvidence } from "./analysis";

function regimeQuestion(slot: BlindSlot) {
  return choice(
    { objective: `Classify the rotation regime for state.candidates.${slot} over the next four to sixteen decision cycles.`, constraints: ["Use only normalized market evidence.", "Accumulation requires a base, improving structure and declining downside pressure.", "Do not infer instrument or date identity."] },
    { bull: "Orderly positive trend.", bear: "Persistent negative structure.", range: "Stable mean-reverting boundaries.", accumulation: "Improving post-decline base.", uncertain: "Conflicting evidence." },
  );
}

function suitabilityQuestion(slot: BlindSlot) {
  return choice(
    { objective: `Classify the long-entry suitability of state.candidates.${slot}.candidate_plan; this is evidence, not an order.`, constraints: ["candidate_plan is deterministic support-to-resistance geometry supplied before this judgment.", "Strong requires coherent structure, timing, participation and positive cost-adjusted target room.", "A structurally coherent plan may still be watch when economics or timing are not ready.", "Use persistent orderbook walls, trade flow, open interest and squeeze risk as confirmation rather than standalone signals.", "Near or inside resistance requires accepted breakout evidence before risk increases.", "Do not become optimistic because application code owns risk."] },
    { strong: "Candidate plan is coherent and executable now.", moderate: "Candidate plan is coherent but not exceptional.", watch: "Candidate plan exists but needs confirmation or better economics.", reject: "No justified risk-increasing use of the candidate plan." },
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
    { objective: `Judge timing for state.candidates.${slot}.candidate_plan at this closed-candle boundary.`, constraints: ["If candidate_plan.status is unavailable choose no_entry.", "A moving price alone is not confirmation.", "wait_retest means a retest of candidate-plan support.", "wait_close means another close or resistance-acceptance confirmation is required.", "Use flow, participation and positioning as confirmation rather than standalone triggers."] },
    { enter_now: "Candidate plan is confirmed now.", wait_close: "Candidate plan needs another close.", wait_retest: "Candidate plan needs a support retest.", no_entry: "Candidate plan should not increase risk." },
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
    { objective: `Score the evidence quality of state.candidates.${slot}.candidate_plan.`, constraints: ["Judge the supplied plan rather than inventing a different entry, stop or target.", "Use structural location, support/resistance strength, price action, execution evidence and leveraged positioning.", "Do not choose position size or authorize a trade."] },
    ["No defensible plan.", "Weak plan.", "Developing plan.", "Coherent plan.", "Exceptional multi-factor plan."],
  );
}

function invalidationQuestion(slot: BlindSlot) {
  return noul({ objective: `Is the long thesis in state.candidates.${slot} invalidated?`, constraints: ["Use support failure, resistance rejection, downside distribution, volatility, flow and positioning together."] });
}

function liquidityQuestion(slot: BlindSlot) {
  return noul({ objective: `Can state.candidates.${slot} support a normal application-sized spot change after costs?`, constraints: ["Unavailable optional leveraged-positioning data alone is not illiquidity."] });
}

export function buildBlindModel2State(state: JevTradingState) {
  const blind = buildBlindNumericState(state);
  assertBlindPayload(blind.state);
  return blind;
}

export async function evaluateBlindModel2Evidence(engineState: JevTradingState) {
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
  return { model: response.model, evidence, usage: response.usage, latencyMs: Date.now() - startedAt };
}
