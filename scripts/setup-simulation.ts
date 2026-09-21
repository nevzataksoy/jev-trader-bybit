import { closeSimulationDatabase, ensureSimulationSchema } from "../lib/simulation/db";

async function main() {
  try {
    await ensureSimulationSchema();
    console.log("Local simulation schema is ready.");
  } finally {
    await closeSimulationDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
