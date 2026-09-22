import { getTradingConfig } from "../../config";
import type { JevAssetJudgments, TradeAsset } from "../../types";
import { TRADE_ASSETS } from "../../types";
import { buildBlindModel1State, evaluateBlindModel1Evidence } from "../model1-blind-evaluator";
import type { StrategyEngine } from "../types";
import { buildStatefulDecisions, buildStatefulPortfolioJudgments } from "../stateful-policy";

export const model1BlindV3Engine: StrategyEngine = {
  id: "model1-blind-v3",
  version: "model1-blind-v3",
  statefulConfirmation: true,
  buildAuditState: (state) => buildBlindModel1State(state).state,
  async evaluate(engineState) {
    const evidence = await evaluateBlindModel1Evidence(engineState);
    const judgments = evidence.judgments as Record<TradeAsset, JevAssetJudgments>;
    const config = getTradingConfig();
    const portfolioJudgments = buildStatefulPortfolioJudgments(judgments, config);
    const feePctByAsset = Object.fromEntries(TRADE_ASSETS.map((asset) => [
      asset,
      engineState.fees[asset].taker_fee_pct,
    ])) as Record<TradeAsset, number>;
    return {
      engineId: "model1-blind-v3",
      engineVersion: "model1-blind-v3",
      model: evidence.model,
      decisions: buildStatefulDecisions(
        { profile: "model1", revision: "V3" },
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

export default model1BlindV3Engine;
