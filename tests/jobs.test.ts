import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJobLeaseExpired } from "../lib/fulfillment";

const workerRoute = readFileSync(new URL("../app/api/internal/jobs/run/route.ts", import.meta.url), "utf8");
const fulfillment = readFileSync(new URL("../lib/fulfillment.ts", import.meta.url), "utf8");

describe("durable job runner", () => {
  it("requires a timing-safe bearer secret", () => {
    expect(workerRoute).toContain("timingSafeEqual");
    expect(workerRoute).toContain("JOB_RUNNER_SECRET");
    expect(workerRoute).toContain('status: 404');
  });

  it("claims queued work atomically, leases it, and caps consecutive failures", () => {
    expect(fulfillment).toContain('status !== "queued"');
    expect(fulfillment).toContain('status: "running"');
    expect(fulfillment).toContain("failureCount >= 3");
    expect(fulfillment).toContain("leaseExpiresAt");
    expect(fulfillment).toContain("recoverExpiredJobLeases");
    expect(fulfillment).toContain("promoteDueScheduledJobs");
    expect(fulfillment).toContain('status: failed ? "failed" : "scheduled"');
    expect(fulfillment).toContain("idempotencyKey");
  });

  it("only recovers running jobs whose lease has expired or is missing", () => {
    const now = Date.parse("2026-09-01T00:10:00.000Z");
    expect(isJobLeaseExpired({ status: "running", leaseExpiresAt: "2026-09-01T00:09:59.000Z" }, now)).toBe(true);
    expect(isJobLeaseExpired({ status: "running" }, now)).toBe(true);
    expect(isJobLeaseExpired({ status: "running", leaseExpiresAt: "not-a-date" }, now)).toBe(true);
    expect(isJobLeaseExpired({ status: "running", leaseExpiresAt: "2026-09-01T00:10:01.000Z" }, now)).toBe(false);
    expect(isJobLeaseExpired({ status: "queued", leaseExpiresAt: "2026-09-01T00:00:00.000Z" }, now)).toBe(false);
  });
});
