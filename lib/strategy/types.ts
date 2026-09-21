import type { JevTradingState } from "../jev";
import type { JevResponse } from "../types";

export type StrategyEngineId = string;

export interface StrategyEngineResult extends JevResponse {
  engineId: StrategyEngineId;
  engineVersion: string;
  latencyMs: number;
}

export interface StrategyEngine {
  id: StrategyEngineId;
  version: string;
  statefulConfirmation?: boolean;
  buildAuditState?(state: JevTradingState): unknown;
  evaluate(state: JevTradingState): Promise<StrategyEngineResult>;
}
