import { NextResponse } from "next/server";
import { getAccountEnvironment, getTradingConfig } from "@/lib/config";
import { isDatabaseConfigured } from "@/lib/db";
import { hasBybitCredentials } from "@/lib/providers/bybit";
import { getExchangeRoutingState, getStrategyRuntimeConfig } from "@/lib/strategy/config";

export const dynamic = "force-dynamic";

export function GET() {
  const strategy = getStrategyRuntimeConfig();
  const activeEngine = strategy.runMode === "ab_test" ? "model1" : strategy.runMode;
  const routing = getExchangeRoutingState(activeEngine, strategy, getTradingConfig().enabled);
  const ready = Boolean(
    process.env.CRON_SECRET?.trim()
      && process.env.TYPESAFE_API_KEY?.trim()
      && hasBybitCredentials()
      && isDatabaseConfigured(),
  );
  return NextResponse.json({
    ok: ready,
    timestamp: new Date().toISOString(),
    accountEnvironment: getAccountEnvironment(),
    marketSource: "bybit-mainnet",
    tradingEnabled: getTradingConfig().enabled,
    strategyRunMode: strategy.runMode,
    activeEngines: strategy.activeEngines,
    exchangeExecutionEngine: strategy.executionEngine,
    exchangeRoutingAllowed: routing.allowed,
    exchangeRoutingReason: routing.reason,
    checks: {
      cronSecret: Boolean(process.env.CRON_SECRET?.trim()),
      typesafe: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
      bybit: hasBybitCredentials(),
      database: isDatabaseConfigured(),
    },
  }, { status: ready ? 200 : 503 });
}
