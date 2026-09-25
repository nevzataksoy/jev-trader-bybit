import { afterEach, describe, expect, it } from "vitest";
import { getDatabaseConnectionInfo } from "./db";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("database connection metadata", () => {
  it("detects a Supabase transaction pooler URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres.project_ref:secret@aws-0-region.pooler.supabase.com:6543/postgres";
    expect(getDatabaseConnectionInfo()).toEqual({
      configured: true,
      provider: "supabase",
      connectionMode: "transaction_pooler",
    });
  });

  it("detects a Supabase session pooler URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres.project_ref:secret@aws-0-region.pooler.supabase.com:5432/postgres";
    expect(getDatabaseConnectionInfo()).toEqual({
      configured: true,
      provider: "supabase",
      connectionMode: "session_pooler",
    });
  });

  it("detects a Supabase direct URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres:secret@db.project_ref.supabase.co:5432/postgres";
    expect(getDatabaseConnectionInfo()).toEqual({
      configured: true,
      provider: "supabase",
      connectionMode: "direct",
    });
  });

  it("keeps generic PostgreSQL URLs provider agnostic", () => {
    process.env.DATABASE_URL = "postgresql://app:secret@db.internal.example:5432/app";
    expect(getDatabaseConnectionInfo()).toEqual({
      configured: true,
      provider: "postgresql",
      connectionMode: "direct",
    });
  });

  it("rejects the placeholder database URL", () => {
    process.env.DATABASE_URL = "postgresql://user:password@host/database";
    expect(getDatabaseConnectionInfo()).toEqual({
      configured: false,
      provider: null,
      connectionMode: null,
    });
  });
});
