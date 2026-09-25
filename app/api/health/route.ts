import { NextResponse } from "next/server";
import { getAccountEnvironment, getTradingConfig } from "@/lib/config";
import { checkDatabaseConnection, getDatabaseConnectionInfo } from "@/lib/db";
import { hasBybitCredentials } from "@/lib/providers/bybit";
import { getExchangeRoutingState, getStrategyRuntimeConfig } from "@/lib/strategy/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const strategy = getStrategyRuntimeConfig();
  const activeEngine = strategy.activeEngines[0];
  const routing = getExchangeRoutingState(activeEngine, strategy, getTradingConfig().enabled);
  const database = getDatabaseConnectionInfo();
  const databaseReachable = database.configured && await checkDatabaseConnection();
  const ready = Boolean(
    process.env.CRON_SECRET?.trim()
      && process.env.TYPESAFE_API_KEY?.trim()
      && hasBybitCredentials()
      && databaseReachable,
  );
  return NextResponse.json({
    ok: ready,
    timestamp: new Date().toISOString(),
    accountEnvironment: getAccountEnvironment(),
    marketSource: "bybit-mainnet",
    tradingEnabled: getTradingConfig().enabled,
    strategyRunMode: strategy.runMode,
    activeEngines: strategy.activeEngines,
    availableEngines: strategy.availableEngines,
    exchangeExecutionEngine: strategy.executionEngine,
    exchangeRoutingAllowed: routing.allowed,
    exchangeRoutingReason: routing.reason,
    databaseConnection: {
      configured: database.configured,
      reachable: databaseReachable,
      provider: database.provider,
      mode: database.connectionMode,
    },
    checks: {
      cronSecret: Boolean(process.env.CRON_SECRET?.trim()),
      typesafe: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
      bybit: hasBybitCredentials(),
      database: databaseReachable,
    },
  }, { status: ready ? 200 : 503 });
}
