import type { JevAssetJudgments, TradeAsset } from "../../../../types";
import { TRADE_ASSETS } from "../../../../types";
import type { StrategyEngine } from "../../../types";
import { applyConfirmation } from "./confirmation";
import { getModelConfig } from "./config";
import { buildBlindModel1State, evaluateBlindModel1Evidence } from "./evaluator";
import { orderDecisions, planExecution as planModelExecution } from "./execution";
import { buildDecisions, buildPortfolioJudgments } from "./policy";

export const model1V1Engine: StrategyEngine = {
  id: "model1-v1",
  family: "model1",
  version: "v1",
  policyRevision: "structure-economics-r4",
  configRevision: "2026-09-24-r1",
  orderDecisions,
  planExecution: (decision, context) => planModelExecution(decision, context, getModelConfig()),
  buildAuditState: (state) => buildBlindModel1State(state).state,
  async evaluate(engineState, runtime) {
    const evidence = await evaluateBlindModel1Evidence(engineState);
    const judgments = evidence.judgments as Record<TradeAsset, JevAssetJudgments>;
    const config = getModelConfig();
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
      engineId: "model1-v1",
      cycleKey: runtime.cycleKey,
      capturedAt: runtime.capturedAt,
      decisions: preliminary,
      indicators: engineState.indicators,
    });
    return {
      engineId: "model1-v1",
      engineVersion: "v1",
      model: evidence.model,
      decisions,
      portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model1V1Engine;
