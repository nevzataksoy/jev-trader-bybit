import type { ExecutionPlan } from "../risk";
import { TRADE_ASSETS, type JevDecision, type PortfolioRiskContext, type SpotBalance, type TickerPrices, type TradeAsset } from "../types";
import type { SimulationExecution, SimulationPortfolio } from "./types";

export function createSimulationPortfolio(initialCapitalUsdt: number): SimulationPortfolio {
  return {
    cashUsdt: initialCapitalUsdt,
    quantities: { BTC: 0, ETH: 0, XAUT: 0 },
    orders: [],
    totalFeesUsdt: 0,
    totalSlippageUsdt: 0,
    realizedPnlUsdt: 0,
  };
}

export function balancesForPortfolio(portfolio: SimulationPortfolio, prices: TickerPrices): SpotBalance[] {
  return [
    { coin: "USDT", free: portfolio.cashUsdt, locked: 0, total: portfolio.cashUsdt, usdtValue: portfolio.cashUsdt },
    ...TRADE_ASSETS.map((asset) => ({
      coin: asset,
      free: portfolio.quantities[asset],
      locked: 0,
      total: portfolio.quantities[asset],
      usdtValue: portfolio.quantities[asset] * prices[asset],
    })),
  ];
}

export function portfolioEquity(portfolio: SimulationPortfolio, prices: TickerPrices) {
  return portfolio.cashUsdt + TRADE_ASSETS.reduce(
    (total, asset) => total + portfolio.quantities[asset] * prices[asset],
    0,
  );
}

export function buildSimulationRiskContext(
  currentEquityUsdt: number,
  snapshots: Array<{ timestamp: number; equity: number }>,
  portfolio: SimulationPortfolio,
  cycleAt: number,
): PortfolioRiskContext {
  const cutoff = cycleAt - 24 * 60 * 60_000;
  const recent = snapshots.filter((item) => item.timestamp >= cutoff && item.timestamp <= cycleAt);
  const equities = recent.map((item) => item.equity);
  const peak = equities.length ? Math.max(currentEquityUsdt, ...equities) : currentEquityUsdt;
  const completedOrders = portfolio.orders.filter((order) => {
    const timestamp = Number(order.executedTime ?? order.updatedTime);
    return Number(order.cumExecQty) > 0 && timestamp >= cutoff && timestamp <= cycleAt;
  }).length;
  return {
    window_hours: 24,
    starting_equity_usdt: equities.at(0) ?? currentEquityUsdt,
    peak_equity_usdt: peak,
    current_drawdown_pct: peak > 0 ? Math.max(0, ((peak - currentEquityUsdt) / peak) * 100) : 0,
    completed_orders_24h: completedOrders,
  };
}

function heldQuantity(portfolio: SimulationPortfolio, asset: TradeAsset) {
  return Math.max(0, portfolio.quantities[asset]);
}

export function executeSimulationPlan(args: {
  portfolio: SimulationPortfolio;
  decision: JevDecision;
  plan: ExecutionPlan;
  decisionPrice: number;
  nextOpenPrice: number;
  executionAt: number;
  orderId: string;
  takerFeePct: number;
  slippagePct: number;
}): SimulationExecution {
  const { portfolio, decision, plan } = args;
  if (decision.action === "hold") {
    return {
      asset: decision.asset, action: "hold", status: "held", reason: plan.reason,
      decisionPrice: args.decisionPrice, fillPrice: null, quantity: 0, grossValueUsdt: 0,
      feeUsdt: 0, slippageUsdt: 0, orderId: null,
    };
  }
  if (!plan.allowed) {
    return {
      asset: decision.asset, action: decision.action, status: "blocked", reason: plan.reason,
      decisionPrice: args.decisionPrice, fillPrice: null, quantity: 0, grossValueUsdt: 0,
      feeUsdt: 0, slippageUsdt: 0, orderId: null,
    };
  }

  const feeFraction = args.takerFeePct / 100;
  const slippageFraction = args.slippagePct / 100;
  const timestamp = String(args.executionAt);
  let fillPrice: number;
  let quantity: number;
  let grossValueUsdt: number;
  let feeUsdt: number;
  let slippageUsdt: number;

  if (decision.action === "buy") {
    fillPrice = args.nextOpenPrice * (1 + slippageFraction);
    const requestedSpend = portfolio.cashUsdt * plan.buyPctOfUsdt;
    grossValueUsdt = Math.min(requestedSpend, portfolio.cashUsdt / (1 + feeFraction));
    quantity = grossValueUsdt / fillPrice;
    feeUsdt = grossValueUsdt * feeFraction;
    slippageUsdt = quantity * Math.max(0, fillPrice - args.nextOpenPrice);
    portfolio.cashUsdt -= grossValueUsdt + feeUsdt;
    portfolio.quantities[decision.asset] += quantity;
  } else {
    quantity = heldQuantity(portfolio, decision.asset) * plan.sellPctOfHolding;
    fillPrice = args.nextOpenPrice * (1 - slippageFraction);
    grossValueUsdt = quantity * fillPrice;
    feeUsdt = grossValueUsdt * feeFraction;
    slippageUsdt = quantity * Math.max(0, args.nextOpenPrice - fillPrice);
    portfolio.quantities[decision.asset] = Math.max(0, portfolio.quantities[decision.asset] - quantity);
    portfolio.cashUsdt += grossValueUsdt - feeUsdt;
  }

  portfolio.totalFeesUsdt += feeUsdt;
  portfolio.totalSlippageUsdt += slippageUsdt;
  portfolio.orders.push({
    orderId: args.orderId,
    orderLinkId: args.orderId,
    symbol: `${decision.asset}USDT`,
    side: decision.action === "buy" ? "Buy" : "Sell",
    orderType: "Market",
    qty: String(quantity),
    price: "0",
    avgPrice: String(fillPrice),
    cumExecQty: String(quantity),
    cumExecValue: String(grossValueUsdt),
    fee: String(feeUsdt),
    feeCurrency: "USDT",
    orderStatus: "Filled",
    createdTime: timestamp,
    updatedTime: timestamp,
    executedTime: timestamp,
    isOpen: false,
  });

  return {
    asset: decision.asset,
    action: decision.action,
    status: "filled",
    reason: plan.reason,
    decisionPrice: args.decisionPrice,
    fillPrice,
    quantity,
    grossValueUsdt,
    feeUsdt,
    slippageUsdt,
    orderId: args.orderId,
  };
}
