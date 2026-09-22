import { TRADE_ASSETS } from "../../../../types";
import type { TradeAsset } from "../../../../types";
import type { StrategyEngine } from "../../../types";
import { finalizeBlindRotationEvidence } from "./analysis";
import { applyConfirmation } from "./confirmation";
import { getModelConfig } from "./config";
import { buildBlindModel2State, evaluateBlindModel2Evidence } from "./evaluator";
import { buildRotationJevJudgments } from "./normalizer";
import { buildDecisions, buildPortfolioJudgments } from "./policy";

export const model2V1Engine: StrategyEngine = {
  id: "model2-v1",
  family: "model2",
  version: "v1",
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
    const portfolioJudgments = buildPortfolioJudgments(judgments, config);
    const feePctByAsset = Object.fromEntries(TRADE_ASSETS.map((asset) => [
      asset,
      engineState.fees[asset].taker_fee_pct,
    ])) as Record<TradeAsset, number>;
    const preliminary = buildDecisions(
      judgments,
      portfolioJudgments,
      engineState.indicators,
      engineState.positions,
      feePctByAsset,
      config,
    );
    const decisions = await applyConfirmation({
      scopeId: runtime.scopeId,
      experimentId: runtime.experimentId,
      engineId: "model2-v1",
      cycleKey: runtime.cycleKey,
      capturedAt: runtime.capturedAt,
      decisions: preliminary,
      indicators: engineState.indicators,
    });
    return {
      engineId: "model2-v1",
      engineVersion: "v1",
      model: evidence.model,
      decisions,
      portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model2V1Engine;
