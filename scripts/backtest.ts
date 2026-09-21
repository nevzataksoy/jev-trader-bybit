import { closeSimulationDatabase } from "../lib/simulation/db";
import { formatSimulationReport } from "../lib/simulation/report";
import { createSimulationConfig, runHistoricalSimulation } from "../lib/simulation/runner";
import { buildCycleTimes } from "../lib/simulation/features";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const hours = Number(option("hours") ?? 48);
const endValue = option("end");
const initial = Number(option("initial") ?? 1_000);
const maxCyclesValue = option("max-cycles");
const maxCycles = maxCyclesValue === undefined ? null : Number(maxCyclesValue);
const runId = option("run-id");
const language = option("lang") === "en" ? "en" : "tr";

if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number.");
if (!Number.isFinite(initial) || initial <= 0) throw new Error("--initial must be a positive number.");
if (maxCycles !== null && (!Number.isInteger(maxCycles) || maxCycles <= 0)) {
  throw new Error("--max-cycles must be a positive integer.");
}
const endAt = endValue ? new Date(endValue).getTime() : undefined;
if (endValue && !Number.isFinite(endAt)) throw new Error("--end must be a valid ISO date.");

async function main() {
  try {
    const config = createSimulationConfig({ hours, endAt, initialCapitalUsdt: initial, maxCycles });
    const plannedCalls = buildCycleTimes(config).length;
    if (plannedCalls > 1
      && process.env.BACKTEST_CONFIRM_JEV_USAGE !== "true"
      && !process.argv.includes("--confirm-jev")) {
      throw new Error(
        `This run would make ${plannedCalls} sequential Jev calls. `
        + "Set BACKTEST_CONFIRM_JEV_USAGE=true or pass --confirm-jev after reviewing expected usage.",
      );
    }
    const summary = await runHistoricalSimulation({
      runId,
      config,
      onProgress: (message) => console.log(`[backtest] ${message}`),
    });
    console.log("");
    console.log(formatSimulationReport(summary, language));
  } finally {
    await closeSimulationDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
