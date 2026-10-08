import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc, updateDoc, deleteDoc, setLogLevel } from "firebase/firestore";
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";
import { enqueueSiteDiagnosticJob, getSiteDiagnosticState, runQueuedSiteDiagnosticJobs } from "../lib/site-diagnostic-jobs";
import type { SiteDiagnosticReport } from "../lib/site-diagnostic-types";

// Real SDK reads, commits, transactions, contention, query execution and client
// rules. Only the public-site inspection is supplied as deterministic test data:
// these tests must never make outbound requests to a customer site.
const emulatorProject = "demo-launch-order-lock";
const emulatorHost = "127.0.0.1:18891";
const siteUrl = "https://example.com/";
const startedAt = Date.parse("2026-10-02T12:00:00Z");
let app: App;
let db: Firestore;
let uid: string;
let projectId: string;
let workspace: string;
let project: string;
let clock: number;
const clients: FirebaseApp[] = [];
const member = () => db.doc(`${workspace}/members/${uid}`);
const jobRef = (id: string) => db.doc(`${workspace}/siteDiagnosticJobs/${id}`);
const reportRef = (id: string) => db.doc(`${project}/siteDiagnosticReports/${id}`);
const latestRef = () => db.doc(`${workspace}/siteDiagnosticLatest/${projectId}`);
const enqueue = () => enqueueSiteDiagnosticJob(db, uid, projectId, true, clock);

function localOnly() {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== emulatorHost || process.env.GCLOUD_PROJECT !== emulatorProject) {
    throw new Error("Refusing non-isolated diagnostics test. Use scripts/test-firestore-order-lock.mjs.");
  }
}

function observation(label = "Saved observation"): SiteDiagnosticReport {
  const capturedAt = new Date(clock).toISOString();
  const raw = '<html><head><meta name="robots" content="noindex"></head></html>';
  return {
    version: 1, id: randomUUID(), targetUrl: siteUrl, createdAt: capturedAt, completedAt: capturedAt,
    pages: [], sitemaps: [], errors: [],
    snapshots: [{ id: "source-1", url: siteUrl, capturedAt, kind: "html", httpStatus: 200, headers: { "content-type": ["text/html"], "x-robots-tag": ["noindex"] }, contentHash: createHash("sha256").update(raw).digest("hex"), bytes: Buffer.byteLength(raw), bodyComplete: true, rawExcerpt: raw, relevantTags: ['<meta name="robots" content="noindex">'] }],
    findings: [{ id: "finding-1", check: "index_status", url: siteUrl, capturedAt, result: "not_checked", reason: label, evidenceIds: ["source-1"], checkedScope: "Emulator fixture; no actual search-engine inspection." }],
    robots: { url: `${siteUrl}robots.txt`, finalUrl: null, httpStatus: null, state: "unavailable", reason: "Transport not exercised by database tests.", snapshotId: null, redirects: [], sitemapUrls: [] },
    scope: { origin: "https://example.com", maxPages: 4, attemptedPageCount: 1, checkedPageCount: 1, retrievedPageCount: 1, requestCount: 1, maxRequests: 24, bytesRead: Buffer.byteLength(raw), maxTotalBytes: 2_500_000, deadlineMs: 25_000, sameOriginOnly: true, javascriptExecuted: false, searchEngineIndexChecked: false, skippedUrls: [], limitations: ["Deterministic inspection fixture, not customer-site acceptance."] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function worker(run = async (_url: string) => observation()) {
  return runQueuedSiteDiagnosticJobs(db, { now: () => clock, run });
}

async function finish(label = "Previous report") {
  const job = await enqueue();
  await worker(async () => observation(label));
  expect((await jobRef(job.id).get()).data()?.status).toBe("completed");
  return job;
}

function client(userId: string) {
  localOnly();
  const clientApp = initializeApp({ projectId: emulatorProject, apiKey: "demo-emulator-only" }, `diagnostics-client-${randomUUID()}`);
  clients.push(clientApp);
  const clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, "127.0.0.1", 18891, { mockUserToken: { sub: userId, user_id: userId } });
  return clientDb;
}

beforeAll(() => {
  localOnly();
  setLogLevel("silent");
  app = initializeAdminApp({ projectId: emulatorProject }, "diagnostic-emulator-admin");
  db = getAdminFirestore(app);
});

beforeEach(async () => {
  clock = startedAt;
  uid = `diag_test_${randomUUID().replaceAll("-", "")}`;
  projectId = randomUUID().replaceAll("-", "").slice(0, 24);
  workspace = `workspaces/personal_${uid}`;
  project = `${workspace}/projects/${projectId}`;
  const batch = db.batch();
  batch.set(db.doc(workspace), { createdBy: uid });
  batch.set(member(), { userId: uid, role: "owner" });
  batch.set(db.doc(project), { workspaceId: `personal_${uid}`, createdBy: uid, url: siteUrl, name: "Fixture company", campaignStatus: "approved" });
  await batch.commit();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map(deleteApp));
  // Clean only this test's explicitly generated workspace, on the guarded
  // local demo emulator. Never delete a root collection or live project.
  localOnly();
  if (!/^workspaces\/personal_diag_test_[a-f0-9]{32}$/.test(workspace)) throw new Error("Unsafe fixture cleanup target.");
  await db.recursiveDelete(db.doc(workspace));
});

afterAll(async () => {
  if (db) await db.terminate();
  if (app) await deleteAdminApp(app);
});

describe("site diagnostic jobs against real local Firestore", () => {
  it("deduplicates concurrent enqueue transactions to one persisted job", async () => {
    const jobs = await Promise.all([enqueue(), enqueue(), enqueue(), enqueue()]);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
    expect((await db.collection(`${workspace}/siteDiagnosticJobs`).get()).size).toBe(1);
    expect((await db.doc(`${workspace}/siteDiagnosticRequests/${projectId}`).get()).data()).toEqual({ jobId: jobs[0].id });
  });

  it("allows one claim across concurrent workers and saves all evidence atomically", async () => {
    const job = await enqueue();
    const report = observation();
    const run = vi.fn(async () => report);
    await Promise.all([worker(run), worker(run)]);
    expect(run).toHaveBeenCalledExactlyOnceWith(siteUrl);
    const [savedJob, savedReport, savedPointer] = await db.getAll(jobRef(job.id), reportRef(job.id), latestRef());
    expect(savedJob.data()).toMatchObject({ status: "completed", attempts: 1 });
    expect(savedReport.data()).toMatchObject({ report, userId: uid, projectId, jobId: job.id });
    expect(savedPointer.data()).toEqual({ reportId: job.id });
    // These three records must be committed together, not eventually reconciled.
    expect(savedJob.updateTime?.isEqual(savedReport.updateTime!)).toBe(true);
    expect(savedJob.updateTime?.isEqual(savedPointer.updateTime!)).toBe(true);
    const state = await getSiteDiagnosticState(db, uid, projectId);
    expect(state.report).toEqual(report);
    expect(JSON.stringify(state.job)).not.toMatch(/runToken|leaseExpiresAt|authorizedBy|userId|workspaceId/);
  });

  it("resumes saved observations through a fresh Admin SDK connection", async () => {
    const job = await finish();
    const freshApp = initializeAdminApp({ projectId: emulatorProject }, `diagnostic-restart-${randomUUID()}`);
    const freshDb = getAdminFirestore(freshApp);
    try {
      const state = await getSiteDiagnosticState(freshDb, uid, projectId);
      expect(state.job?.id).toBe(job.id);
      expect(state.report?.findings[0].reason).toBe("Previous report");
    } finally { await freshDb.terminate(); await deleteAdminApp(freshApp); }
  });

  it.each(["late success", "late failure"])("fences an expired worker's %s after another worker completes", async (outcome) => {
    const job = await enqueue();
    const entered = deferred<void>();
    const paused = deferred<SiteDiagnosticReport>();
    const original = worker(async () => { entered.resolve(); return paused.promise; });
    await entered.promise;
    try {
      const firstToken = (await jobRef(job.id).get()).data()?.runToken;
      clock += 6 * 60_000;
      expect(await worker(async () => observation("Replacement worker"))).toEqual({ diagnosticsProcessed: 1, diagnosticsRecovered: 1 });
      const saved = (await jobRef(job.id).get()).data();
      expect(saved).toMatchObject({ status: "completed", attempts: 2 });
      expect(saved?.runToken).not.toBe(firstToken);
      if (outcome === "late failure") paused.reject(new Error("Late original worker failure"));
      else paused.resolve(observation("Stale original worker"));
      await original;
      expect((await jobRef(job.id).get()).data()).toEqual(saved);
      expect((await getSiteDiagnosticState(db, uid, projectId)).report?.findings[0].reason).toBe("Replacement worker");
      expect((await db.collection(`${project}/siteDiagnosticReports`).get()).size).toBe(1);
    } finally { paused.resolve(observation()); await original; }
  });

  it("retains the previous report while a changed site URL supersedes an in-flight run", async () => {
    const previous = await finish();
    const next = await enqueue();
    const entered = deferred<void>();
    const paused = deferred<SiteDiagnosticReport>();
    const running = worker(async () => { entered.resolve(); return paused.promise; });
    await entered.promise;
    try {
      expect((await getSiteDiagnosticState(db, uid, projectId)).report?.findings[0].reason).toBe("Previous report");
      await db.doc(project).update({ url: "https://changed.example/" });
      paused.resolve(observation("Old URL result"));
      await running;
      expect((await jobRef(next.id).get()).data()?.status).toBe("superseded");
      expect((await reportRef(next.id).get()).exists).toBe(false);
      expect((await latestRef().get()).data()).toEqual({ reportId: previous.id });
    } finally { paused.resolve(observation()); await running; }
  });

  it("does not persist a crawl result after membership is revoked", async () => {
    const job = await enqueue();
    const entered = deferred<void>();
    const paused = deferred<SiteDiagnosticReport>();
    const running = worker(async () => { entered.resolve(); return paused.promise; });
    await entered.promise;
    try {
      await member().delete();
      paused.resolve(observation());
      await running;
      expect((await reportRef(job.id).get()).exists).toBe(false);
      expect((await latestRef().get()).exists).toBe(false);
      await expect(getSiteDiagnosticState(db, uid, projectId)).rejects.toMatchObject({ status: 403 });
      clock += 60_000;
      const run = vi.fn(async () => observation());
      await worker(run);
      expect(run).not.toHaveBeenCalled();
      expect((await jobRef(job.id).get()).data()?.status).toBe("failed");
    } finally { paused.resolve(observation()); await running; }
  });

  it("keeps immutable report and latest pointer unchanged when report creation conflicts", async () => {
    const previous = await finish();
    const job = await enqueue();
    const sentinel = { owner: "immutable test record" };
    await reportRef(job.id).create(sentinel);
    await worker();
    expect((await jobRef(job.id).get()).data()?.status).toBe("scheduled");
    expect((await reportRef(job.id).get()).data()).toEqual(sentinel);
    expect((await latestRef().get()).data()).toEqual({ reportId: previous.id });
  });

  it("honors backoff, caps attempts at three, and preserves the last completed report", async () => {
    const previous = await finish();
    const job = await enqueue();
    const run = vi.fn(async () => { throw new Error("Do not expose this private transport detail"); });
    await worker(run);
    expect((await jobRef(job.id).get()).data()?.status).toBe("scheduled");
    clock += 29_999;
    await worker(run);
    expect(run).toHaveBeenCalledTimes(1);
    clock++;
    await worker(run);
    clock += 60_000;
    await worker(run);
    clock += 6 * 60_000;
    await worker(run);
    expect(run).toHaveBeenCalledTimes(3);
    expect((await jobRef(job.id).get()).data()).toMatchObject({ status: "failed", attempts: 3 });
    const state = await getSiteDiagnosticState(db, uid, projectId);
    expect(state.report?.findings[0].reason).toBe("Previous report");
    expect(JSON.stringify(state)).not.toContain("private transport detail");
    expect((await latestRef().get()).data()).toEqual({ reportId: previous.id });
  });

  it("preserves ordered campaign, approval, evidence and lifecycle records", async () => {
    const values = { "orders/current": { billingStatus: "refunded", frozenPayload: { headline: "Original" } }, "campaigns/current": { version: 1, status: "approved" }, "campaignApprovals/current": { digest: "original" }, "claims/claim-1": { text: "Original claim", approved: true }, "profiles/current": { company: "Original" } };
    for (const [path, value] of Object.entries(values)) await db.doc(`${project}/${path}`).set(value);
    const protectedRefs = [db.doc(project), ...Object.keys(values).map((path) => db.doc(`${project}/${path}`))];
    const before = await db.getAll(...protectedRefs);
    await finish();
    const after = await db.getAll(...protectedRefs);
    after.forEach((snapshot, index) => {
      expect(snapshot.data()).toEqual(before[index].data());
      expect(snapshot.updateTime?.isEqual(before[index].updateTime!)).toBe(true);
    });
  });

  it("allows viewer API reads but rejects viewer enqueue and foreign ownership", async () => {
    await finish();
    await member().update({ role: "viewer" });
    expect((await getSiteDiagnosticState(db, uid, projectId)).report).not.toBeNull();
    await expect(enqueue()).rejects.toMatchObject({ status: 403 });
    await member().update({ role: "owner" });
    await db.doc(project).update({ createdBy: "someone-else" });
    await expect(getSiteDiagnosticState(db, uid, projectId)).rejects.toMatchObject({ status: 404 });
    await expect(enqueue()).rejects.toMatchObject({ status: 404 });
  });

  it("rejects report and job pointers belonging to a different project", async () => {
    const job = await finish();
    await reportRef(job.id).update({ projectId: "b".repeat(24) });
    await expect(getSiteDiagnosticState(db, uid, projectId)).rejects.toMatchObject({ status: 409 });
    await reportRef(job.id).update({ projectId });
    await jobRef(job.id).update({ projectId: "b".repeat(24) });
    await expect(getSiteDiagnosticState(db, uid, projectId)).rejects.toMatchObject({ status: 409 });
    await expect(enqueue()).rejects.toMatchObject({ status: 409 });
  });

  it.each(["owner", "foreign"])("denies direct %s client reads and mutations of every diagnostic record type", async (actor) => {
    const job = await finish();
    const clientDb = client(actor === "owner" ? uid : "foreign-diagnostic-user");
    const paths = [jobRef(job.id).path, reportRef(job.id).path, latestRef().path, `${workspace}/siteDiagnosticRequests/${projectId}`];
    if (actor === "owner") expect((await getDocFromServer(doc(clientDb, project))).exists()).toBe(true);
    for (const path of paths) {
      const ref = doc(clientDb, path);
      await expect(getDocFromServer(ref)).rejects.toMatchObject({ code: "permission-denied" });
      await expect(updateDoc(ref, { changed: true })).rejects.toMatchObject({ code: "permission-denied" });
      await expect(deleteDoc(ref)).rejects.toMatchObject({ code: "permission-denied" });
      await expect(setDoc(doc(clientDb, `${path}-forged`), { forged: true })).rejects.toMatchObject({ code: "permission-denied" });
    }
    expect((await jobRef(job.id).get()).data()?.status).toBe("completed");
    expect((await reportRef(job.id).get()).exists).toBe(true);
  });
});
