import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StrategyEngine } from "./types";
import { getEngineRevision } from "./revision";

function engine(config: unknown): StrategyEngine {
  return {
    id: "model-test-v1",
    family: "model-test",
    version: "v1",
    policyRevision: "r2-test",
    getRevisionConfig: () => config,
    orderDecisions: (decisions) => decisions,
    planExecution: () => ({ allowed: false, reason: "test", buyPctOfUsdt: 0, sellPctOfHolding: 0 }),
    evaluate: async () => { throw new Error("not used"); },
  };
}

const originalVercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
const originalGithubSha = process.env.GITHUB_SHA;
const originalSourceRevision = process.env.SOURCE_REVISION;

beforeEach(() => {
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.GITHUB_SHA;
  delete process.env.SOURCE_REVISION;
});

afterEach(() => {
  if (originalVercelSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalVercelSha;
  if (originalGithubSha === undefined) delete process.env.GITHUB_SHA;
  else process.env.GITHUB_SHA = originalGithubSha;
  if (originalSourceRevision === undefined) delete process.env.SOURCE_REVISION;
  else process.env.SOURCE_REVISION = originalSourceRevision;
});

describe("engine revision identity", () => {
  it("deduplicates equivalent config objects regardless of key order", () => {
    process.env.SOURCE_REVISION = "source-a";
    const left = getEngineRevision(engine({ alpha: 1, nested: { beta: 2, gamma: 3 } }));
    const right = getEngineRevision(engine({ nested: { gamma: 3, beta: 2 }, alpha: 1 }));
    expect(left.configRevision).toBe(right.configRevision);
    expect(left.revisionId).toBe(right.revisionId);
  });

  it("changes the revision when config or source changes", () => {
    process.env.SOURCE_REVISION = "source-a";
    const baseline = getEngineRevision(engine({ alpha: 1 }));
    const changedConfig = getEngineRevision(engine({ alpha: 2 }));
    process.env.SOURCE_REVISION = "source-b";
    const changedSource = getEngineRevision(engine({ alpha: 1 }));
    expect(changedConfig.revisionId).not.toBe(baseline.revisionId);
    expect(changedSource.revisionId).not.toBe(baseline.revisionId);
  });
});
