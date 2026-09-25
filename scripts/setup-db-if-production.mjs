import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

if (process.env.VERCEL_ENV !== "production") {
  process.stdout.write("Skipping database schema setup outside Vercel production build.\n");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required for a Vercel production build.");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(join(scriptDirectory, "..", "database", "schema.sql"), "utf8");
const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = postgres(connectionString, { max: 1, connect_timeout: 10, prepare: false });

try {
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
} finally {
  await sql.end();
}

process.stdout.write(`Production database schema is ready (${statements.length} statements).\n`);
