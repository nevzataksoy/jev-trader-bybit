import { closeSimulationDatabase, getSimulationSummary } from "../lib/simulation/db";
import { formatSimulationReport } from "../lib/simulation/report";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  try {
    const summary = await getSimulationSummary(option("run-id"));
    if (!summary) throw new Error("No completed simulation run was found.");
    console.log(formatSimulationReport(summary, option("lang") === "en" ? "en" : "tr"));
  } finally {
    await closeSimulationDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
