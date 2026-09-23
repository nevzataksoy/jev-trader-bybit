import { createHash } from "node:crypto";
import type { StrategyEngine } from "./types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function getSourceRevision() {
  return process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.GITHUB_SHA?.trim()
    || process.env.SOURCE_REVISION?.trim()
    || "local";
}

export function getEngineRevision(engine: StrategyEngine) {
  const configSnapshot = engine.getRevisionConfig?.() ?? {};
  const configRevision = digest(configSnapshot);
  const sourceRevision = getSourceRevision();
  const revisionId = digest({
    engineId: engine.id,
    engineVersion: engine.version,
    policyRevision: engine.policyRevision,
    configRevision,
    sourceRevision,
  });
  return {
    revisionId,
    policyRevision: engine.policyRevision,
    configRevision,
    sourceRevision,
    configSnapshot,
  };
}
