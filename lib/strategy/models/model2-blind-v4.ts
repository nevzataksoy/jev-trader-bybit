import { getTradingConfig } from "../../config";
import type { TradeAsset } from "../../types";
import { TRADE_ASSETS } from "../../types";
import { finalizeBlindRotationEvidence } from "../blind-policy";
import { buildBlindModel2State, evaluateBlindModel2Evidence } from "../model2-blind-evaluator";
import { buildRotationJevJudgments } from "../model2-policy";
import type { StrategyEngine } from "../types";
import { buildStatefulDecisions, buildStatefulPortfolioJudgments } from "../stateful-policy";

export const model2BlindV4Engine: StrategyEngine = {
  id: "model2-blind-v4",
  version: "model2-rotation-blind-v4-evidence-confirmation",
  statefulConfirmation: true,
  confirmationConfidence: "evidence_weighted",
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
      engineId: "model2-blind-v4",
      engineVersion: "model2-rotation-blind-v4-evidence-confirmation",
      model: evidence.model,
      decisions: buildStatefulDecisions(
        { profile: "model2", revision: "V4" },
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

export default model2BlindV4Engine;
