import { getTradingConfig } from "../../config";
import { finalizeBlindRotationEvidence } from "../blind-policy";
import { buildBlindModel2State, evaluateBlindModel2Evidence } from "../model2-blind-evaluator";
import { buildRotationDecisions } from "../model2-policy";
import type { StrategyEngine } from "../types";

export { buildBlindModel2State } from "../model2-blind-evaluator";

export const model2BlindEngine: StrategyEngine = {
  id: "model2-blind",
  version: "model2-rotation-blind-v2",
  buildAuditState: (state) => buildBlindModel2State(state).state,
  async evaluate(engineState) {
    const evidence = await evaluateBlindModel2Evidence(engineState);
    const finalized = finalizeBlindRotationEvidence(evidence.evidence, engineState.indicators, engineState.positions);
    return {
      engineId: "model2-blind",
      engineVersion: "model2-rotation-blind-v2",
      model: evidence.model,
      decisions: buildRotationDecisions(finalized.judgments, finalized.portfolioJudgments, engineState.indicators, engineState.positions, getTradingConfig()),
      portfolioJudgments: finalized.portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model2BlindEngine;
