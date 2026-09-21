import type { SimulationSummary } from "./types";

function number(value: number, digits = 2) {
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatSimulationReport(summary: SimulationSummary, language: "tr" | "en" = "tr") {
  const tr = language === "tr";
  const lines = [
    tr ? "Jev tarihsel simülasyon raporu" : "Jev historical simulation report",
    "=".repeat(36),
    `${tr ? "Çalışma" : "Run"}: ${summary.runId}`,
    `${tr ? "Dönem" : "Period"}: ${summary.periodStart} -> ${summary.periodEnd}`,
    `${tr ? "Model" : "Model"}: ${summary.model}`,
    "",
    tr ? "Karar hunisi" : "Decision funnel",
    `  ${tr ? "Döngü" : "Cycles"}: ${summary.cycles}`,
    `  ${tr ? "Varlık kararı" : "Asset decisions"}: ${summary.assetDecisions}`,
    `  ${tr ? "Yön sinyali" : "Directional signals"}: ${summary.directionalSignals}`,
    `  ${tr ? "Politika emri" : "Policy orders"}: ${summary.policyOrders}`,
    `  ${tr ? "Riskten geçen / gerçekleşen" : "Risk-accepted / filled"}: ${summary.acceptedOrders} / ${summary.filledOrders}`,
    `  Buy / Sell / Hold: ${summary.actionCounts.buy} / ${summary.actionCounts.sell} / ${summary.actionCounts.hold}`,
    "",
    tr ? "Portföy sonucu" : "Portfolio result",
    `  ${tr ? "Başlangıç" : "Initial"}: ${number(summary.initialCapitalUsdt)} USDT`,
    `  ${tr ? "Son piyasa değeri" : "Final marked equity"}: ${number(summary.finalEquityUsdt)} USDT`,
    `  ${tr ? "Likidasyon eşdeğeri" : "Liquidation-equivalent equity"}: ${number(summary.liquidationEquityUsdt)} USDT`,
    `  ${tr ? "Net getiri" : "Net return"}: ${number(summary.returnPct, 3)}%`,
    `  ${tr ? "Maksimum düşüş" : "Maximum drawdown"}: ${number(summary.maxDrawdownPct, 3)}%`,
    `  ${tr ? "İşlem hacmi" : "Turnover"}: ${number(summary.turnoverUsdt)} USDT`,
    `  ${tr ? "Ücret / kayma" : "Fees / slippage"}: ${number(summary.totalFeesUsdt, 4)} / ${number(summary.totalSlippageUsdt, 4)} USDT`,
    "",
    tr ? "Karşılaştırmalar" : "Benchmarks",
    `  Cash: ${number(summary.benchmarks.cashUsdt)} USDT`,
    `  BTC buy & hold: ${number(summary.benchmarks.btcBuyHoldUsdt)} USDT`,
    `  Equal weight (USDT/BTC/ETH/XAUT): ${number(summary.benchmarks.equalWeightUsdt)} USDT`,
    "",
    `${tr ? "Rejim sayımları" : "Regime counts"}: ${JSON.stringify(summary.regimeCounts)}`,
    `${tr ? "Jev tokenları (girdi/çıktı)" : "Jev tokens (input/output)"}: ${summary.inputTokens}/${summary.outputTokens}`,
    "",
    tr ? "Varsayımlar ve sınırlamalar" : "Assumptions and limitations",
    ...summary.assumptions.map((item) => `  - ${item}`),
  ];
  return lines.join("\n");
}
