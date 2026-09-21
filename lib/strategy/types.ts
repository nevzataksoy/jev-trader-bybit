import type { JevTradingState } from "../jev";
import type { JevResponse } from "../types";

export type StrategyEngineId = "model1" | "model2";

export interface StrategyEngineResult extends JevResponse {
  engineId: StrategyEngineId;
  engineVersion: string;
  latencyMs: number;
}

export interface StrategyEngine {
  id: StrategyEngineId;
  version: string;
  evaluate(state: JevTradingState): Promise<StrategyEngineResult>;
}
