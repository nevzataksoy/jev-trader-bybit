import { getTradingConfig } from "../../config";
import type { TradeAsset } from "../../types";
import { TRADE_ASSETS } from "../../types";
import { finalizeBlindRotationEvidence } from "../blind-policy";
import { buildBlindModel2State, evaluateBlindModel2Evidence } from "../model2-blind-evaluator";
import { buildRotationJevJudgments } from "../model2-policy";
import type { StrategyEngine } from "../types";
import { buildStatefulDecisions, buildStatefulPortfolioJudgments } from "../stateful-policy";

export const model2BlindV3Engine: StrategyEngine = {
  id: "model2-blind-v3",
  version: "model2-rotation-blind-v3",
  statefulConfirmation: true,
  buildAuditState: (state) => buildBlindModel2State(state).state,
  async evaluate(engineState) {
    const evidence = await evaluateBlindModel2Evidence(engineState);
    const finalized = finalizeBlindRotationEvidence(evidence.evidence, engineState.indicators, engineState.positions);
    const config = getTradingConfig();
    const judgments = buildRotationJevJudgments(finalized.judgments, engineState.indicators);
    const portfolioJudgments = buildStatefulPortfolioJudgments(judgments, config);
    const feePctByAsset = Object.fromEntries(TRADE_ASSETS.map((asset) => [
      asset,
      engineState.fees[asset].taker_fee_pct,
    ])) as Record<TradeAsset, number>;
    return {
      engineId: "model2-blind-v3",
      engineVersion: "model2-rotation-blind-v3",
      model: evidence.model,
      decisions: buildStatefulDecisions(
        { profile: "model2", revision: "V3" },
        judgments,
        portfolioJudgments,
        engineState.indicators,
        engineState.positions,
        feePctByAsset,
        config,
      ),
      portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model2BlindV3Engine;
