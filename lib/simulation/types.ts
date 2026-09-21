import type { Candle } from "../providers/market";
import type {
  JevDecision,
  MacroState,
  MarketIndicatorState,
  OrderHistoryItem,
  PortfolioRiskContext,
  SpotBalance,
  TickerPrices,
  TradeAsset,
} from "../types";

export type HistoricalOpenInterest = {
  timestamp: number;
  openInterest: number;
};

export type HistoricalFunding = {
  timestamp: number;
  rate: number;
};

export type HistoricalAssetData = {
  asset: TradeAsset;
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  openInterest: HistoricalOpenInterest[];
  funding: HistoricalFunding[];
  derivativeError: string | null;
};

export type HistoricalDataset = {
  fetchedAt: string;
  warmupStart: string;
  simulationStart: string;
  simulationEnd: string;
  assets: Record<TradeAsset, HistoricalAssetData>;
  macroRows: import("../providers/macro").FredRow[];
};

export type SimulationConfig = {
  hours: number;
  startAt: number;
  endAt: number;
  warmupStartAt: number;
  initialCapitalUsdt: number;
  takerFeePct: number;
  slippagePct: number;
  spreadPct: Record<TradeAsset, number>;
  maxCycles: number | null;
};

export type SimulationPortfolio = {
  cashUsdt: number;
  quantities: Record<TradeAsset, number>;
  orders: OrderHistoryItem[];
  totalFeesUsdt: number;
  totalSlippageUsdt: number;
  realizedPnlUsdt: number;
};

export type SimulationExecution = {
  asset: TradeAsset;
  action: "buy" | "sell" | "hold";
  status: "filled" | "blocked" | "held" | "skipped";
  reason: string;
  decisionPrice: number;
  fillPrice: number | null;
  quantity: number;
  grossValueUsdt: number;
  feeUsdt: number;
  slippageUsdt: number;
  orderId: string | null;
};

export type SimulationCycleRecord = {
  runId: string;
  cycleAt: string;
  executionAt: string;
  prices: TickerPrices;
  balancesBefore: SpotBalance[];
  equityBeforeUsdt: number;
  portfolioRisk: PortfolioRiskContext;
  macro: MacroState | null;
  marketState: Record<TradeAsset, MarketIndicatorState>;
  semanticState: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  decisions: JevDecision[];
  executions: SimulationExecution[];
  balancesAfter: SpotBalance[];
  equityAfterUsdt: number;
};

export type SimulationSummary = {
  runId: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  periodStart: string;
  periodEnd: string;
  cycles: number;
  assetDecisions: number;
  directionalSignals: number;
  policyOrders: number;
  acceptedOrders: number;
  filledOrders: number;
  initialCapitalUsdt: number;
  finalEquityUsdt: number;
  liquidationEquityUsdt: number;
  returnPct: number;
  maxDrawdownPct: number;
  totalFeesUsdt: number;
  totalSlippageUsdt: number;
  turnoverUsdt: number;
  benchmarks: {
    cashUsdt: number;
    btcBuyHoldUsdt: number;
    equalWeightUsdt: number;
  };
  actionCounts: Record<"buy" | "sell" | "hold", number>;
  regimeCounts: Record<string, number>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  assumptions: string[];
};
