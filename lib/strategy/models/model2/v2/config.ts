function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export interface ModelConfig {
  initialEntryPctOfPortfolio: number;
  strongInitialEntryPctOfPortfolio: number;
  buyPctOfUsdt: number;
  sellPctOfHolding: number;
  targetDailyVolatilityPct: number;
  minUsdtReservePct: number;
  maxAssetAllocationPct: number;
  minBearReboundScore: number;
  estimatedSlippagePct: number;
  allocationDeadbandPct: number;
  minDirectionalEdge: number;
  minSetupScore: number;
  minExpectedNetEdgePct: number;
  minLiquidityProbability: number;
  disorderlyProbability: number;
  cutPositionProbability: number;
  waitCloseTtlMinutes: number;
  waitRetestTtlMinutes: number;
}

export function getModelConfig(): ModelConfig {
  return {
    initialEntryPctOfPortfolio: numberFromEnv("MODEL2_V2_INITIAL_ENTRY_PCT_OF_PORTFOLIO", 0.15, 0.05, 0.5),
    strongInitialEntryPctOfPortfolio: numberFromEnv("MODEL2_V2_STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO", 0.20, 0.05, 0.5),
    buyPctOfUsdt: numberFromEnv("MODEL2_V2_BUY_PCT_OF_USDT", 0.20, 0.01, 1),
    sellPctOfHolding: numberFromEnv("MODEL2_V2_SELL_PCT_OF_HOLDING", 0.25, 0.01, 1),
    targetDailyVolatilityPct: numberFromEnv("MODEL2_V2_TARGET_DAILY_VOLATILITY_PCT", 3, 0.1, 50),
    minUsdtReservePct: numberFromEnv("MIN_USDT_RESERVE_PCT", 0.20, 0, 0.95),
    maxAssetAllocationPct: numberFromEnv("MAX_ASSET_ALLOCATION_PCT", 0.50, 0.05, 1),
    minBearReboundScore: numberFromEnv("MODEL2_V2_MIN_BEAR_REBOUND_SCORE", 0.62, 0, 1),
    estimatedSlippagePct: numberFromEnv("ESTIMATED_SLIPPAGE_PCT", 0.03, 0, 2),
    allocationDeadbandPct: numberFromEnv("MODEL2_V2_ALLOCATION_DEADBAND_PCT", 3, 0.25, 25),
    minDirectionalEdge: numberFromEnv("MODEL2_V2_MIN_DIRECTIONAL_EDGE", 0.15, 0, 0.9),
    minSetupScore: numberFromEnv("MODEL2_V2_MIN_SETUP_SCORE", 2, 0, 4),
    minExpectedNetEdgePct: numberFromEnv("MODEL2_V2_MIN_EXPECTED_NET_EDGE_PCT", 0.05, 0, 5),
    minLiquidityProbability: numberFromEnv("MODEL2_V2_MIN_LIQUIDITY_PROBABILITY", 0.55, 0, 1),
    disorderlyProbability: numberFromEnv("MODEL2_V2_DISORDERLY_PROBABILITY", 0.70, 0, 1),
    cutPositionProbability: numberFromEnv("MODEL2_V2_CUT_POSITION_PROBABILITY", 0.72, 0, 1),
    waitCloseTtlMinutes: Math.round(numberFromEnv("MODEL2_V2_WAIT_CLOSE_TTL_MINUTES", 30, 15, 240)),
    waitRetestTtlMinutes: Math.round(numberFromEnv("MODEL2_V2_WAIT_RETEST_TTL_MINUTES", 120, 15, 720)),
  };
}
