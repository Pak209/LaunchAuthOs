import { describe, expect, it } from "vitest";
import { canApplyIntelligenceResult, intelligenceJobHost } from "../lib/intelligence-client";
import type { IntelligenceJobStatus } from "../lib/intelligence-jobs";

const job: IntelligenceJobStatus = { id: "first-job", projectId: "project", type: "analysis", status: "completed", attempts: 1, createdAt: "2026-09-11", updatedAt: "2026-09-11", url: "https://example.com/" };

describe("background result UI guards", () => {
  it("auto-applies only the requested result while the initiating workspace state is unchanged", () => {
    const initiatingState = { id: job.id, epoch: 4 };
    expect(canApplyIntelligenceResult(job, initiatingState, 4)).toBe(true);
    // A project switch, new project, or local edit increments the epoch even if
    // the enqueue response or completed-project fetch is still in flight.
    expect(canApplyIntelligenceResult(job, initiatingState, 5)).toBe(false);
    expect(canApplyIntelligenceResult(job, { id: "newer-job", epoch: 4 }, 4)).toBe(false);
    expect(canApplyIntelligenceResult(job, null, 4)).toBe(false);
    expect(canApplyIntelligenceResult({ ...job, status: "superseded" }, initiatingState, 4)).toBe(false);
  });

  it("keeps malformed historical URLs from crashing the workspace", () => {
    expect(intelligenceJobHost("https://example.com/product")).toBe("example.com");
    expect(intelligenceJobHost("not-a-url")).toBe("Company website");
    expect(intelligenceJobHost("")).toBe("Company website");
  });
});
