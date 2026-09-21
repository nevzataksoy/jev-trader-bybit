import { evaluateTradingState } from "../jev";
import type { StrategyEngine } from "./types";

export const model1Engine: StrategyEngine = {
  id: "model1",
  version: "model1-v1",
  async evaluate(state) {
    const startedAt = Date.now();
    const response = await evaluateTradingState(state);
    return {
      ...response,
      engineId: "model1",
      engineVersion: "model1-v1",
      latencyMs: Date.now() - startedAt,
    };
  },
};
