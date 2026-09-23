import type { JevTradingState } from "../jev";
import type {
  JevDecision,
  JevResponse,
  MarketIndicatorState,
  PositionContext,
  SpotBalance,
} from "../types";

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

export interface StrategyExecutionContext {
  market: MarketIndicatorState;
  balances: SpotBalance[];
  totalPortfolioUsdt: number;
  position: PositionContext;
  minTradeUsdt: number;
}

export interface StrategyExecutionIntent {
  allowed: boolean;
  reason: string;
  buyPctOfUsdt: number;
  sellPctOfHolding: number;
}

export interface StrategyEngine {
  id: StrategyEngineId;
  family: string;
  version: string;
  policyRevision?: string;
  getRevisionConfig?(): unknown;
  buildAuditState?(state: JevTradingState): unknown;
  orderDecisions(decisions: JevDecision[]): JevDecision[];
  planExecution(decision: JevDecision, context: StrategyExecutionContext): StrategyExecutionIntent;
  evaluate(state: JevTradingState, runtime: StrategyRuntimeContext): Promise<StrategyEngineResult>;
}
