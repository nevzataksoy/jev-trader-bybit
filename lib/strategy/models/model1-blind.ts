import { getTradingConfig } from "../../config";
import { buildPortfolioDecisions } from "../../policy";
import type { TradeAsset } from "../../types";
import { TRADE_ASSETS } from "../../types";
import { buildDeterministicPortfolioJudgments } from "../blind-policy";
import { buildBlindModel1State, evaluateBlindModel1Evidence } from "../model1-blind-evaluator";
import type { StrategyEngine } from "../types";

export { buildBlindModel1State } from "../model1-blind-evaluator";

export const model1BlindEngine: StrategyEngine = {
  id: "model1-blind",
  version: "model1-blind-v2",
  buildAuditState: (state) => buildBlindModel1State(state).state,
  async evaluate(engineState) {
    const evidence = await evaluateBlindModel1Evidence(engineState);
    const portfolioJudgments = buildDeterministicPortfolioJudgments(evidence.judgments);
    const feePctByAsset = Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, engineState.fees[asset].taker_fee_pct])) as Record<TradeAsset, number>;
    return {
      engineId: "model1-blind",
      engineVersion: "model1-blind-v2",
      model: evidence.model,
      decisions: buildPortfolioDecisions(evidence.judgments, portfolioJudgments, engineState.indicators, engineState.positions, engineState.macro, feePctByAsset, getTradingConfig()),
      portfolioJudgments,
      usage: evidence.usage,
      latencyMs: evidence.latencyMs,
    };
  },
};

export default model1BlindEngine;
