import { TRADE_ASSETS } from "../../../../types";
import type { TradeAsset } from "../../../../types";
import type { StrategyEngine } from "../../../types";
import { finalizeBlindRotationEvidence } from "./analysis";
import { applyConfirmation } from "./confirmation";
import { getModelConfig } from "./config";
import { buildBlindModel2State, evaluateBlindModel2Evidence } from "./evaluator";
import { orderDecisions, planExecution as planModelExecution } from "./execution";
import { buildRotationJevJudgments } from "./normalizer";
import { buildDecisions } from "./policy";

export const model2V2Engine: StrategyEngine = {
  id: "model2-v2",
  family: "model2",
  version: "v2",
  policyRevision: "structure-economics-r3",
  configRevision: "2026-09-24-r1",
  orderDecisions,
  planExecution: (decision, context) => planModelExecution(decision, context, getModelConfig()),
  buildAuditState: (state) => buildBlindModel2State(state).state,
  async evaluate(engineState, runtime) {
    const evidence = await evaluateBlindModel2Evidence(engineState);
    const finalized = finalizeBlindRotationEvidence(
      evidence.evidence,
      engineState.indicators,
      engineState.positions,
    );
    const config = getModelConfig();
    const judgments = buildRotationJevJudgments(finalized.judgments, engineState.indicators);
    const feePctByAsset = Object.fromEntries(TRADE_ASSETS.map((asset) => [
      asset,
      engineState.fees[asset].taker_fee_pct,
    ])) as Record<TradeAsset, number>;
    const preliminary = buildDecisions(
      judgments,
      finalized.judgments,
      finalized.portfolioJudgments,
      engineState.indicators,
      engineState.positions,
      feePctByAsset,
      config,
    );
    const decisions = await applyConfirmation({
      scopeId: runtime.scopeId,
      experimentId: runtime.experimentId,
      engineId: "model2-v2",
      cycleKey: runtime.cycleKey,
      capturedAt: runtime.capturedAt,
      decisions: preliminary,
      indicators: engineState.indicators,
    });
    return {
      engineId: "model2-v2",
      engineVersion: "v2",
      model: evidence.model,
      decisions,
      portfolioJudgments: finalized.portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model2V2Engine;
