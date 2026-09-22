import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { getSafeErrorMessage } from "@/lib/errors";
import { getStrategyRuntimeConfig } from "@/lib/strategy/config";
import { getModelsDashboardState, type ModelsDashboardState } from "@/lib/strategy/experiment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const strategy = getStrategyRuntimeConfig();
  const base: Pick<ModelsDashboardState, "generatedAt" | "runMode" | "activeEngines" | "availableEngines" | "exchangeExecutionEngine" | "exchangeRoutingForcedOff"> = {
    generatedAt: new Date().toISOString(),
    runMode: strategy.runMode,
    activeEngines: strategy.activeEngines,
    availableEngines: strategy.availableEngines,
    exchangeExecutionEngine: strategy.executionEngine,
    exchangeRoutingForcedOff: strategy.runMode === "ab_test",
  };
  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      ...base,
      database: "not_configured",
      message: "DATABASE_URL is not configured.",
      experiment: null,
      engines: [],
      equity: [],
      orders: [],
      runs: [],
    } satisfies ModelsDashboardState, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const state = await getModelsDashboardState(strategy.experimentId);
    return NextResponse.json({
      ...base,
      database: "connected",
      message: null,
      ...state,
    } satisfies ModelsDashboardState, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      ...base,
      database: "error",
      message: getSafeErrorMessage(error, "Experiment data could not be loaded."),
      experiment: null,
      engines: [],
      equity: [],
      orders: [],
      runs: [],
    } satisfies ModelsDashboardState, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
