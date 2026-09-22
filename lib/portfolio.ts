import { SYMBOL_TO_ASSET } from "./config";
import type {
  JevDecision,
  OrderHistoryItem,
  PositionContext,
  SpotBalance,
  TradeAsset,
} from "./types";
import { TRADE_ASSETS } from "./types";

function finite(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildPositionContexts(
  balances: SpotBalance[],
  orders: OrderHistoryItem[],
  totalPortfolioUsdt: number,
  now = Date.now(),
): Record<TradeAsset, PositionContext> {
  return Object.fromEntries(TRADE_ASSETS.map((asset) => {
    const balance = balances.find((item) => item.coin === asset);
    const quantity = balance?.total ?? 0;
    const assetOrders = orders
      .filter((order) => SYMBOL_TO_ASSET[order.symbol] === asset && finite(order.cumExecQty) > 0)
      .sort((a, b) => Number(a.executedTime ?? a.updatedTime) - Number(b.executedTime ?? b.updatedTime));

    let inventoryQuantity = 0;
    let inventoryCostUsdt = 0;
    let quality: PositionContext["cost_basis_quality"] = "complete";
    for (const order of assetOrders) {
      const executedQuantity = finite(order.cumExecQty);
      const executedValue = finite(order.cumExecValue);
      const fee = finite(order.fee);
      if (order.side === "Buy") {
        const acquired = order.feeCurrency === asset
          ? Math.max(0, executedQuantity - fee)
          : executedQuantity;
        inventoryQuantity += acquired;
        inventoryCostUsdt += executedValue + (order.feeCurrency === "USDT" ? fee : 0);
        if (order.feeCurrency && order.feeCurrency !== asset && order.feeCurrency !== "USDT") quality = "partial";
      } else if (inventoryQuantity > 0) {
        const reduction = Math.min(inventoryQuantity, executedQuantity);
        inventoryCostUsdt -= inventoryCostUsdt * (reduction / inventoryQuantity);
        inventoryQuantity -= reduction;
      }
    }

    const latestOrder = assetOrders.at(-1);
    const latestMillis = latestOrder ? Number(latestOrder.executedTime ?? latestOrder.updatedTime) : NaN;
    const tolerance = Math.max(quantity * 0.02, 1e-10);
    const historyCoversPosition = quantity > 0 && inventoryQuantity > 0 && Math.abs(inventoryQuantity - quantity) <= tolerance;
    if (quantity > 0 && !historyCoversPosition) quality = assetOrders.length ? "partial" : "unavailable";
    if (quantity <= 0) quality = "unavailable";

    const averageEntry = historyCoversPosition ? inventoryCostUsdt / inventoryQuantity : null;
    const currentPrice = quantity > 0 ? (balance?.usdtValue ?? 0) / quantity : 0;
    const context: PositionContext = {
      asset,
      status: quantity > 0 ? "held" : "flat",
      quantity,
      value_usdt: balance?.usdtValue ?? 0,
      allocation_pct: totalPortfolioUsdt > 0 ? ((balance?.usdtValue ?? 0) / totalPortfolioUsdt) * 100 : 0,
      average_entry_price: averageEntry,
      unrealized_pnl_pct: averageEntry && averageEntry > 0 ? ((currentPrice / averageEntry) - 1) * 100 : null,
      cost_basis_quality: quality,
      last_trade_action: latestOrder ? (latestOrder.side === "Buy" ? "buy" : "sell") : null,
      last_trade_at: Number.isFinite(latestMillis) ? new Date(latestMillis).toISOString() : null,
      minutes_since_last_trade: Number.isFinite(latestMillis) ? Math.max(0, (now - latestMillis) / 60_000) : null,
    };
    return [asset, context];
  })) as Record<TradeAsset, PositionContext>;
}
