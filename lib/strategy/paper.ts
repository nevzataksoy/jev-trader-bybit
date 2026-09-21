export interface PaperFillInput {
  side: "Buy" | "Sell";
  cashUsdt: number;
  assetQuantity: number;
  averageEntryPrice: number;
  referencePrice: number;
  spreadPct: number;
  slippagePct: number;
  takerFeePct: number;
  buyFraction: number;
  sellFraction: number;
}

export interface PaperFillResult {
  fillPrice: number;
  adversePct: number;
  quantity: number;
  grossValueUsdt: number;
  feeUsdt: number;
  newCashUsdt: number;
  newAssetQuantity: number;
  newAverageEntryPrice: number | null;
  realizedPnlUsdt: number;
}

export function calculatePaperFill(input: PaperFillInput): PaperFillResult {
  if (!(input.referencePrice > 0)) throw new Error("Paper fill requires a positive reference price.");
  const adversePct = Math.max(0, input.spreadPct) / 2 + Math.max(0, input.slippagePct);
  const feeRate = Math.max(0, input.takerFeePct) / 100;
  const fillPrice = input.side === "Buy"
    ? input.referencePrice * (1 + adversePct / 100)
    : input.referencePrice * (1 - adversePct / 100);

  if (input.side === "Buy") {
    const grossValueUsdt = Math.min(
      input.cashUsdt * Math.max(0, Math.min(1, input.buyFraction)),
      input.cashUsdt / (1 + feeRate),
    );
    const feeUsdt = grossValueUsdt * feeRate;
    const quantity = grossValueUsdt / fillPrice;
    if (!(quantity > 0) || grossValueUsdt + feeUsdt > input.cashUsdt + 1e-8) {
      throw new Error("Paper buy has insufficient USDT.");
    }
    const newAssetQuantity = input.assetQuantity + quantity;
    return {
      fillPrice,
      adversePct,
      quantity,
      grossValueUsdt,
      feeUsdt,
      newCashUsdt: input.cashUsdt - grossValueUsdt - feeUsdt,
      newAssetQuantity,
      newAverageEntryPrice: newAssetQuantity > 0
        ? (input.assetQuantity * input.averageEntryPrice + grossValueUsdt + feeUsdt) / newAssetQuantity
        : null,
      realizedPnlUsdt: 0,
    };
  }

  const quantity = input.assetQuantity * Math.max(0, Math.min(1, input.sellFraction));
  if (!(quantity > 0) || quantity > input.assetQuantity + 1e-10) {
    throw new Error("Paper sell has insufficient asset quantity.");
  }
  const grossValueUsdt = quantity * fillPrice;
  const feeUsdt = grossValueUsdt * feeRate;
  const newAssetQuantity = Math.max(0, input.assetQuantity - quantity);
  return {
    fillPrice,
    adversePct,
    quantity,
    grossValueUsdt,
    feeUsdt,
    newCashUsdt: input.cashUsdt + grossValueUsdt - feeUsdt,
    newAssetQuantity,
    newAverageEntryPrice: newAssetQuantity > 1e-12 ? input.averageEntryPrice : null,
    realizedPnlUsdt: (fillPrice - input.averageEntryPrice) * quantity - feeUsdt,
  };
}
