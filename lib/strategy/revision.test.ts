import { afterEach, describe, expect, it } from "vitest";
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

afterEach(() => {
  delete process.env.SOURCE_REVISION;
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
