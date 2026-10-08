import { describe, expect, it, vi } from "vitest";
import { enqueueSiteDiagnosticJob, getSiteDiagnosticState, runQueuedSiteDiagnosticJobs } from "../lib/site-diagnostic-jobs";
import type { SiteDiagnosticReport } from "../lib/site-diagnostic-types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const initialTime = Date.parse("2026-09-11T12:00:00.000Z");
const userId = "alice";
const projectId = "a".repeat(24);
const otherProjectId = "b".repeat(24);
const companyUrl = "https://example.com/";
const workspacePath = `workspaces/personal_${userId}`;
const projectPath = `${workspacePath}/projects/${projectId}`;
const memberPath = `${workspacePath}/members/${userId}`;
const jobPath = (id: string) => `${workspacePath}/siteDiagnosticJobs/${id}`;
const reportPath = (id: string) => `${projectPath}/siteDiagnosticReports/${id}`;
const latestPath = `${workspacePath}/siteDiagnosticLatest/${projectId}`;
const requestPath = `${workspacePath}/siteDiagnosticRequests/${projectId}`;

function report(label = "Current observation", targetUrl = companyUrl): SiteDiagnosticReport {
  const timestamp = new Date(initialTime).toISOString();
  return {
    version: 1, id: "engine-result", targetUrl, createdAt: timestamp, completedAt: timestamp,
    pages: [], snapshots: [], sitemaps: [], errors: [],
    findings: [{ id: "finding-1", check: "index_status", url: targetUrl, capturedAt: timestamp, result: "not_checked", reason: label, evidenceIds: [], checkedScope: "No search-engine index query was performed." }],
    robots: { url: new URL("/robots.txt", targetUrl).href, finalUrl: null, httpStatus: null, state: "unavailable", reason: "Fixture does not access the network.", snapshotId: null, redirects: [], sitemapUrls: [] },
    scope: { origin: new URL(targetUrl).origin, maxPages: 5, attemptedPageCount: 0, checkedPageCount: 0, retrievedPageCount: 0, requestCount: 0, maxRequests: 20, bytesRead: 0, maxTotalBytes: 2_000_000, deadlineMs: 30_000, sameOriginOnly: true, javascriptExecuted: false, searchEngineIndexChecked: false, skippedUrls: [], limitations: ["No search-engine index query was performed."] },
  };
}

function database() {
  const db = new MemoryFirestore();
  for (const uid of ["alice", "bob"]) {
    db.seed(`workspaces/personal_${uid}/members/${uid}`, { userId: uid, role: "owner" });
    db.seed(`workspaces/personal_${uid}/projects/${projectId}`, { workspaceId: `personal_${uid}`, createdBy: uid, url: companyUrl, name: "Example", campaignStatus: "approved", profile: { company: "Example", claims: [{ id: "claim-1", approved: true }] } });
  }
  db.seed(`${workspacePath}/projects/${otherProjectId}`, { workspaceId: "personal_alice", createdBy: userId, url: "https://other.example/", name: "Other project" });
  return db;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function finish(db: MemoryFirestore, label = "Saved report", time = initialTime) {
  const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, time);
  await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => report(label), now: () => time });
  return job;
}

describe("durable read-only site diagnostic jobs", () => {
  it("requires explicit authorization before enqueuing work", async () => {
    const db = database();
    const before = structuredClone([...db.rows]);
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, false, initialTime)).rejects.toThrow(/authoriz/i);
    expect([...db.rows]).toEqual(before);
  });

  it("deduplicates simultaneous requests and isolates tenants and projects", async () => {
    const db = database();
    const enqueue = () => enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const [first, replay] = await Promise.all([enqueue(), enqueue()]);
    const otherTenant = await enqueueSiteDiagnosticJob(db.asFirestore(), "bob", projectId, true, initialTime);
    const otherProject = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, otherProjectId, true, initialTime);
    expect(replay.id).toBe(first.id);
    expect(otherTenant.id).not.toBe(first.id);
    expect(otherProject.id).not.toBe(first.id);
    expect(otherProject.url).toBe("https://other.example/");
    expect((await getSiteDiagnosticState(db.asFirestore(), "bob", projectId)).job?.id).toBe(otherTenant.id);
    expect((await getSiteDiagnosticState(db.asFirestore(), userId, otherProjectId)).job?.id).toBe(otherProject.id);
    expect(db.read(requestPath).jobId).toBe(first.id);
    expect(JSON.stringify(first)).not.toMatch(/runToken|leaseExpiresAt|workspaceId|userId|authorized/);
  });

  it("allows viewers to read observations but never to enqueue a diagnostic", async () => {
    const db = database();
    const job = await finish(db);
    db.seed(memberPath, { userId, role: "viewer" });
    const state = await getSiteDiagnosticState(db.asFirestore(), userId, projectId);
    expect(state.job?.id).toBe(job.id);
    expect(state.report?.findings[0].reason).toBe("Saved report");
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime)).rejects.toThrow(/access denied/i);
  });

  it("denies missing membership, foreign ownership, and missing projects on read and enqueue", async () => {
    const db = database();
    for (const operation of [
      () => getSiteDiagnosticState(db.asFirestore(), userId, projectId),
      () => enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime),
    ]) {
      db.rows.delete(memberPath);
      await expect(operation()).rejects.toThrow(/access denied/i);
      db.seed(memberPath, { userId, role: "owner" });
      db.seed(projectPath, { ...db.read(projectPath), createdBy: "bob" });
      await expect(operation()).rejects.toThrow(/not found/i);
      db.seed(projectPath, { ...db.read(projectPath), createdBy: userId });
    }
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, "c".repeat(24), true, initialTime)).rejects.toThrow(/not found/i);
    await expect(getSiteDiagnosticState(db.asFirestore(), userId, "c".repeat(24))).rejects.toThrow(/not found/i);
  });

  it("accepts only project identifiers and derives the runner target from the saved project", async () => {
    const db = database();
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, "https://arbitrary.example/", true, initialTime)).rejects.toThrow(/identifier/i);
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const run = vi.fn(async (_url: string) => report());
    expect(await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime })).toEqual({ diagnosticsProcessed: 1, diagnosticsRecovered: 0 });
    expect(run.mock.calls[0]?.[0]).toBe(companyUrl);
    expect(job.url).toBe(companyUrl);
    expect(db.read(jobPath(job.id)).status).toBe("completed");
  });

  it("rejects unsafe URLs stored on a project before creating a job", async () => {
    const db = database();
    db.seed(projectPath, { ...db.read(projectPath), url: "http://127.0.0.1/admin" });
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime)).rejects.toThrow();
    expect([...db.rows.keys()].filter((path) => path.includes("siteDiagnostic"))).toEqual([]);
  });

  it("returns an empty state before the first explicitly requested run", async () => {
    expect(await getSiteDiagnosticState(database().asFirestore(), userId, projectId)).toEqual({ job: null, report: null });
  });

  it("rejects tampered cross-project job pointers on read and enqueue", async () => {
    const db = database();
    const other = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, otherProjectId, true, initialTime);
    db.seed(requestPath, { jobId: other.id });
    await expect(getSiteDiagnosticState(db.asFirestore(), userId, projectId)).rejects.toThrow(/ownership/i);
    await expect(enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime)).rejects.toThrow(/ownership/i);
    expect(db.read(jobPath(other.id)).status).toBe("queued");
  });

  it.each(["userId", "workspaceId", "projectId", "jobId"])("does not expose a stored report whose %s crosses its authorized scope", async (field) => {
    const db = database();
    const job = await finish(db);
    db.seed(reportPath(job.id), { ...db.read(reportPath(job.id)), [field]: "foreign-scope" });
    await expect(getSiteDiagnosticState(db.asFirestore(), userId, projectId)).rejects.toThrow(/ownership/i);
  });

  it("lets only one worker claim a queued job", async () => {
    const db = database();
    await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const run = vi.fn(async () => report());
    await Promise.all([runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime }), runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime })]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retains the latest completed report while a newer run is queued and running", async () => {
    const db = database();
    const prior = await finish(db, "Previous complete report");
    const next = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime + 1_000);
    expect(next.id).not.toBe(prior.id);
    expect((await getSiteDiagnosticState(db.asFirestore(), userId, projectId)).report?.findings[0].reason).toBe("Previous complete report");
    const gate = deferred<SiteDiagnosticReport>();
    const started = deferred<void>();
    const running = runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => { started.resolve(); return gate.promise; }, now: () => initialTime + 1_000 });
    await started.promise;
    const state = await getSiteDiagnosticState(db.asFirestore(), userId, projectId);
    expect(state.job).toMatchObject({ id: next.id, status: "running" });
    expect(state.report?.findings[0].reason).toBe("Previous complete report");
    gate.resolve(report("New complete report"));
    await running;
    expect((await getSiteDiagnosticState(db.asFirestore(), userId, projectId)).report?.findings[0].reason).toBe("New complete report");
    expect(db.read(reportPath(prior.id)).report.findings[0].reason).toBe("Previous complete report");
  });

  it("commits the immutable report, latest pointer, and completion atomically", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    db.beforeCommit = (writes) => {
      if (writes.some((write) => write.ref.path === reportPath(job.id))) {
        expect(writes.some((write) => write.ref.path === latestPath)).toBe(true);
        expect(writes.some((write) => write.ref.path === jobPath(job.id) && write.data.status === "completed")).toBe(true);
        throw new Error("Simulated report transaction outage");
      }
    };
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => report(), now: () => initialTime });
    expect(db.rows.has(reportPath(job.id))).toBe(false);
    expect(db.rows.has(latestPath)).toBe(false);
    expect(db.read(jobPath(job.id)).status).toBe("scheduled");
    db.beforeCommit = undefined;
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => report(), now: () => initialTime + 30_000 });
    expect(db.read(jobPath(job.id)).status).toBe("completed");
    expect(db.read(latestPath).reportId).toBe(job.id);
    expect(db.read(reportPath(job.id)).report.findings[0].reason).toBe("Current observation");
  });

  it("never overwrites a colliding immutable report or advances the latest pointer", async () => {
    const db = database();
    const prior = await finish(db, "Previous complete report");
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime + 1_000);
    const immutable = report("Immutable report already occupying this identifier");
    db.seed(reportPath(job.id), immutable);
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => report("New output"), now: () => initialTime + 1_000 });
    expect(db.read(reportPath(job.id))).toEqual(immutable);
    expect(db.read(latestPath).reportId).toBe(prior.id);
    expect(db.read(jobPath(job.id)).status).not.toBe("completed");
  });

  it.each(["target URL", "version", "timestamp", "oversized output"])("rejects an invalid runner %s without publishing a report", async (invalid) => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const output = report();
    if (invalid === "target URL") output.targetUrl = "https://other.example/";
    if (invalid === "version") Object.assign(output, { version: 2 });
    if (invalid === "timestamp") output.completedAt = "not-a-timestamp";
    if (invalid === "oversized output") output.scope.limitations.push("x".repeat(800_001));
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => output, now: () => initialTime });
    expect(db.rows.has(reportPath(job.id))).toBe(false);
    expect(db.rows.has(latestPath)).toBe(false);
    expect(db.read(jobPath(job.id)).status).toBe("scheduled");
  });

  it("bounds retries with 30-second attempt backoff and never exposes runner secrets", async () => {
    const db = database();
    await finish(db, "Retained successful report");
    const time = initialTime + 1_000;
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, time);
    const run = vi.fn(async () => { throw new Error("Bearer secret_do_not_expose"); });
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => time });
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "scheduled", attempts: 1, nextAttemptAt: new Date(time + 30_000).toISOString() });
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => time + 29_999 });
    expect(run).toHaveBeenCalledTimes(1);
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => time + 30_000 });
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "scheduled", attempts: 2, nextAttemptAt: new Date(time + 90_000).toISOString() });
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => time + 90_000 });
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => time + 300_000 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "failed", attempts: 3 });
    const state = await getSiteDiagnosticState(db.asFirestore(), userId, projectId);
    expect(state.report?.findings[0].reason).toBe("Retained successful report");
    expect(JSON.stringify(state)).not.toContain("secret_do_not_expose");
  });

  it("recovers an expired five-minute lease and rejects the old worker's late output", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const gate = deferred<SiteDiagnosticReport>();
    const started = deferred<void>();
    const original = runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => { started.resolve(); return gate.promise; }, now: () => initialTime });
    await started.promise;
    const recoveredRun = vi.fn(async () => report("Recovered worker"));
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: recoveredRun, now: () => initialTime + 299_999 });
    expect(recoveredRun).not.toHaveBeenCalled();
    const resumed = await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: recoveredRun, now: () => initialTime + 300_000 });
    expect(resumed.diagnosticsRecovered).toBe(1);
    gate.resolve(report("Stale worker"));
    await original;
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "completed", attempts: 2 });
    expect((await getSiteDiagnosticState(db.asFirestore(), userId, projectId)).report?.findings[0].reason).toBe("Recovered worker");
  });

  it("does not reschedule a completed replacement when the expired original worker later throws", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const gate = deferred<SiteDiagnosticReport>();
    const started = deferred<void>();
    const original = runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => { started.resolve(); return gate.promise; }, now: () => initialTime });
    await started.promise;
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => report("Recovered worker"), now: () => initialTime + 300_000 });
    gate.reject(new Error("Stale worker failed after replacement completed"));
    await original;
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "completed", attempts: 2 });
    expect((await getSiteDiagnosticState(db.asFirestore(), userId, projectId)).report?.findings[0].reason).toBe("Recovered worker");
  });

  it("exhausts an expired third lease without dispatching a fourth attempt", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    db.seed(jobPath(job.id), { ...db.read(jobPath(job.id)), status: "running", attempts: 3, runToken: "crashed-worker", leaseExpiresAt: new Date(initialTime).toISOString() });
    const run = vi.fn(async () => report());
    const result = await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime });
    expect(result).toEqual({ diagnosticsProcessed: 0, diagnosticsRecovered: 1 });
    expect(run).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("supersedes queued work without crawling when the saved URL changes", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    db.seed(projectPath, { ...db.read(projectPath), url: "https://changed.example/" });
    const run = vi.fn(async () => report());
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime });
    expect(run).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id)).status).toBe("superseded");
    expect(db.rows.has(reportPath(job.id))).toBe(false);
  });

  it.each(["membership", "ownership", "url"])("rejects a late result after %s changes during the crawl", async (change) => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    const gate = deferred<SiteDiagnosticReport>();
    const started = deferred<void>();
    const running = runQueuedSiteDiagnosticJobs(db.asFirestore(), { run: async () => { started.resolve(); return gate.promise; }, now: () => initialTime });
    await started.promise;
    if (change === "membership") db.rows.delete(memberPath);
    if (change === "ownership") db.seed(projectPath, { ...db.read(projectPath), createdBy: "bob" });
    if (change === "url") db.seed(projectPath, { ...db.read(projectPath), url: "https://changed.example/" });
    gate.resolve(report("Rejected late output"));
    await running;
    expect(db.rows.has(reportPath(job.id))).toBe(false);
    expect(db.rows.has(latestPath)).toBe(false);
    expect(db.read(jobPath(job.id)).status).not.toBe("completed");
    if (change === "url") expect(db.read(jobPath(job.id)).status).toBe("superseded");
  });

  it("does not call the runner after membership is revoked while work is queued", async () => {
    const db = database();
    const job = await enqueueSiteDiagnosticJob(db.asFirestore(), userId, projectId, true, initialTime);
    db.rows.delete(memberPath);
    const run = vi.fn(async () => report());
    await runQueuedSiteDiagnosticJobs(db.asFirestore(), { run, now: () => initialTime });
    expect(run).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id)).status).toBe("failed");
  });

  it.each(["awaiting_payment", "paid", "submitted", "completed", "refunded"])("allows observations after an order is %s and preserves all campaign, approval, and fulfillment records", async (status) => {
    const db = database();
    const preserved = {
      [`${projectPath}/profiles/current`]: { company: "Example", approved: true },
      [`${projectPath}/claims/claim-1`]: { text: "Approved evidence", approved: true },
      [`${projectPath}/evidence/source-1`]: { contentHash: "immutable-evidence" },
      [`${projectPath}/campaigns/current`]: { version: 3, status: "approved", assets: [{ content: "Approved campaign" }] },
      [`${projectPath}/campaigns/current/versions/000003`]: { version: 3, status: "approved" },
      [`${projectPath}/campaignApprovals/current`]: { approvedBy: userId, campaignVersion: 3, digest: "approval-hash" },
      [`${projectPath}/orders/current`]: { status, paidAmount: 49900, currency: "usd", providerOrderId: "external-order" },
      [`${projectPath}/placements/placement-1`]: { outlet: "Publisher", state: "verified" },
      [`${projectPath}/directories/directory-1`]: { status: "submitted", submittedAt: new Date(initialTime).toISOString() },
    };
    for (const [path, data] of Object.entries(preserved)) db.seed(path, data);
    const before = structuredClone([...db.rows]);
    const job = await finish(db);
    expect(db.read(jobPath(job.id)).status).toBe("completed");
    for (const [path, data] of before) expect(db.read(path), path).toEqual(data);
    const createdPaths = [...db.rows.keys()].filter((path) => !before.some(([prior]) => prior === path));
    expect(createdPaths.sort()).toEqual([jobPath(job.id), reportPath(job.id), latestPath, requestPath].sort());
  });
});
