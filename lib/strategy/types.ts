import type { JevTradingState } from "../jev";
import type { JevResponse } from "../types";

export type StrategyEngineId = string;

export interface StrategyRuntimeContext {
  scopeId: string;
  experimentId: string | null;
  cycleKey: string;
  capturedAt: string;
}

export interface StrategyEngineResult extends JevResponse {
  engineId: StrategyEngineId;
  engineVersion: string;
  latencyMs: number;
}

export interface StrategyEngine {
  id: StrategyEngineId;
  family: string;
  version: string;
  buildAuditState?(state: JevTradingState): unknown;
  evaluate(state: JevTradingState, runtime: StrategyRuntimeContext): Promise<StrategyEngineResult>;
}
