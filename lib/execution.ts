import type { BotExecutionResult, OrderHistoryItem } from "./types";

const failedStatuses = new Set(["Cancelled", "Rejected", "Deactivated"]);

export function reconcileExecutions(
  executions: BotExecutionResult[],
  orders: OrderHistoryItem[],
): BotExecutionResult[] {
  const orderMap = new Map(orders.map((order) => [order.orderId, order]));
  return executions.map((execution) => {
    if (execution.status !== "submitted" || !execution.orderId) return execution;
    const order = orderMap.get(execution.orderId);
    if (!order) return execution;
    const filledQuantity = Number(order.cumExecQty || 0);
    const filledValueUsdt = Number(order.cumExecValue || 0);
    if (Number.isFinite(filledQuantity) && filledQuantity > 0) {
      return {
        ...execution,
        status: "confirmed",
        reason: `${execution.reason} Exchange reconciliation confirmed ${order.orderStatus}.`,
        filledQuantity,
        filledValueUsdt: Number.isFinite(filledValueUsdt) ? filledValueUsdt : undefined,
      };
    }
    if (failedStatuses.has(order.orderStatus)) {
      return {
        ...execution,
        status: "failed",
        reason: `${execution.reason} Exchange reconciliation returned ${order.orderStatus} without a fill.`,
      };
    }
    return execution;
  });
}
