import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Load it into the current shell before running db:setup.");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(join(scriptDirectory, "..", "database", "schema.sql"), "utf8");
const statements = schema
  .split(/;\s*(?=CREATE)/i)
  .map((statement) => statement.trim().replace(/;$/, ""))
  .filter(Boolean);
const sql = postgres(connectionString, { max: 1, connect_timeout: 10, prepare: false });
try {
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
} finally {
  await sql.end();
}
process.stdout.write(`Database schema is ready (${statements.length} statements).\n`);
