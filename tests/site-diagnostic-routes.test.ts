import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/projects/[projectId]/diagnostics/route";
import { POST as runInternalJobs } from "../app/api/internal/jobs/run/route";
import { SiteDiagnosticJobError } from "../lib/site-diagnostic-jobs";
import { RateLimitError } from "../lib/rate-limit";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), adminConfigured: vi.fn(), adminDb: vi.fn(), rateLimit: vi.fn(),
  enqueue: vi.fn(), getState: vi.fn(), diagnostics: vi.fn(), intelligence: vi.fn(),
  fulfillment: vi.fn(), distribution: vi.fn(), email: vi.fn(),
}));

// The actual handlers parse HTTP input and construct responses; only the service
// boundaries are mocked, and typed errors retain their production classes.
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: mocks.auth }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: mocks.adminDb, isFirebaseAdminExplicitlyConfigured: mocks.adminConfigured }));
vi.mock("@/lib/site-diagnostic-jobs", async () => ({
  SiteDiagnosticJobError: (await import("../lib/site-diagnostic-jobs")).SiteDiagnosticJobError,
  enqueueSiteDiagnosticJob: mocks.enqueue, getSiteDiagnosticState: mocks.getState, runQueuedSiteDiagnosticJobs: mocks.diagnostics,
}));
vi.mock("@/lib/rate-limit", async () => ({ RateLimitError: (await import("../lib/rate-limit")).RateLimitError, enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/request-security", () => import("../lib/request-security"));
vi.mock("@/lib/intelligence-jobs", () => ({ runQueuedIntelligenceJobs: mocks.intelligence }));
vi.mock("@/lib/fulfillment", () => ({ runQueuedFulfillmentJobs: mocks.fulfillment }));
vi.mock("@/lib/provider", () => ({ getDistributionProvider: mocks.distribution }));
vi.mock("@/lib/email", () => ({ getTransactionalEmailProvider: mocks.email }));

const projectId = "a".repeat(24);
const adminDb = { identity: "privileged-diagnostic-db" };
const customerDb = { identity: "customer-db" };
const job = { id: "12345678-1234-1234-1234-123456789abc", projectId, url: "https://customer.example/", status: "queued", attempts: 0, createdAt: "2026-09-11T12:00:00.000Z", updatedAt: "2026-09-11T12:00:00.000Z" };
const context = (id = projectId) => ({ params: Promise.resolve({ projectId: id }) });
const request = (body: unknown = { authorized: true }, headers: Record<string, string> = {}) => new Request(`https://app.example/api/projects/${projectId}/diagnostics`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const getRequest = () => new Request(`https://app.example/api/projects/${projectId}/diagnostics`);
const internalRequest = (authorization = "Bearer worker-secret") => new Request("https://app.example/api/internal/jobs/run", { method: "POST", headers: { authorization } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
  vi.stubEnv("JOB_RUNNER_SECRET", "worker-secret");
  mocks.auth.mockResolvedValue({ db: customerDb, user: { uid: "alice" } });
  mocks.adminConfigured.mockReturnValue(true);
  mocks.adminDb.mockReturnValue(adminDb);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.enqueue.mockResolvedValue(job);
  mocks.getState.mockResolvedValue({ job: null, report: null });
  mocks.fulfillment.mockResolvedValue({ processed: 1, recovered: 0 });
  mocks.intelligence.mockResolvedValue({ intelligenceProcessed: 2, intelligenceRecovered: 1 });
  mocks.diagnostics.mockResolvedValue({ diagnosticsProcessed: 1, diagnosticsRecovered: 0 });
  mocks.email.mockReturnValue({ identity: "email-provider" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("project diagnostic HTTP contract", () => {
  it("returns persisted state under the authenticated user with caching disabled", async () => {
    const state = { job: { ...job, status: "running" }, report: { id: "prior-report", targetUrl: job.url } };
    mocks.getState.mockResolvedValue(state);
    const response = await GET(getRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getState).toHaveBeenCalledExactlyOnceWith(adminDb, "alice", projectId);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });

  it("enqueues only the saved project identifier after explicit authorization", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(adminDb, "alice", projectId, true);
    expect(mocks.rateLimit).toHaveBeenCalledExactlyOnceWith("alice", "site-diagnostics", 5, 60);
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });

  it.each([{}, { authorized: false }, { authorized: "true" }, { authorized: true, url: "https://arbitrary.example/" }, { authorized: true, userId: "bob" }, { authorized: true, projectId: "b".repeat(24) }])("rejects unauthorized or caller-controlled scope in %j", async (body) => {
    const response = await POST(request(body), context());
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON as a client error without enqueuing", async () => {
    const malformed = new Request(`https://app.example/api/projects/${projectId}/diagnostics`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    const response = await POST(malformed, context());
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before authentication, rate limiting, or enqueue", async () => {
    const response = await POST(request({ authorized: true }, { origin: "https://attacker.example" }), context());
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns Retry-After when the per-user request limit is reached", async () => {
    mocks.rateLimit.mockRejectedValue(new RateLimitError(42));
    const response = await POST(request(), context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("requires authentication for %s", async (method) => {
    mocks.auth.mockRejectedValue(new Error("Authentication required."));
    const response = method === "GET" ? await GET(getRequest(), context()) : await POST(request(), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("rejects invalid project identifiers before database access on %s", async (method) => {
    const response = method === "GET" ? await GET(getRequest(), context("invalid-project")) : await POST(request(), context("invalid-project"));
    expect(response.status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.adminDb).not.toHaveBeenCalled();
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("reports missing background infrastructure without a fake success on %s", async (method) => {
    mocks.adminConfigured.mockReturnValue(false);
    const response = method === "GET" ? await GET(getRequest(), context()) : await POST(request(), context());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/not configured/i);
    expect(mocks.adminDb).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it.each([403, 404, 409] as const)("retains typed access/history error status %s", async (status) => {
    const error = new SiteDiagnosticJobError("Typed diagnostic access or history failure.", status);
    mocks.getState.mockRejectedValue(error);
    mocks.enqueue.mockRejectedValue(error);
    for (const response of [await GET(getRequest(), context()), await POST(request(), context())]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: error.message });
    }
  });
});

describe("shared internal background runner", () => {
  it.each(["", "Bearer wrong-secret", "Bearer worker-secret-extra"])("does not execute any work without the correct bearer secret: %j", async (authorization) => {
    const response = await runInternalJobs(internalRequest(authorization));
    expect(response.status).toBe(404);
    expect(mocks.adminDb).not.toHaveBeenCalled();
    expect(mocks.fulfillment).not.toHaveBeenCalled();
    expect(mocks.intelligence).not.toHaveBeenCalled();
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });

  it("also refuses work when the runner secret is unconfigured", async () => {
    vi.stubEnv("JOB_RUNNER_SECRET", "");
    expect((await runInternalJobs(internalRequest())).status).toBe(404);
    expect(mocks.adminDb).not.toHaveBeenCalled();
  });

  it("runs fulfillment, intelligence, and diagnostics and returns all counters", async () => {
    const response = await runInternalJobs(internalRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, recovered: 0, intelligenceProcessed: 2, intelligenceRecovered: 1, diagnosticsProcessed: 1, diagnosticsRecovered: 0 });
    expect(mocks.fulfillment).toHaveBeenCalledExactlyOnceWith(adminDb, mocks.distribution, { identity: "email-provider" });
    expect(mocks.intelligence).toHaveBeenCalledExactlyOnceWith(adminDb);
    expect(mocks.diagnostics).toHaveBeenCalledExactlyOnceWith(adminDb);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("awaits diagnostic work even if another group fails, then reports partial failure", async () => {
    let release!: (value: { diagnosticsProcessed: number; diagnosticsRecovered: number }) => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<{ diagnosticsProcessed: number; diagnosticsRecovered: number }>((resolve) => { release = resolve; });
    mocks.diagnostics.mockImplementation(() => { started(); return pending; });
    mocks.fulfillment.mockRejectedValue(new Error("Fulfillment unavailable."));
    let responded = false;
    const running = runInternalJobs(internalRequest()).then((response) => { responded = true; return response; });
    await start;
    await Promise.resolve();
    expect(responded).toBe(false);
    release({ diagnosticsProcessed: 1, diagnosticsRecovered: 0 });
    const response = await running;
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ intelligenceProcessed: 2, intelligenceRecovered: 1, diagnosticsProcessed: 1, diagnosticsRecovered: 0, errors: [{ worker: "fulfillment", message: "Fulfillment unavailable." }] });
  });

  it("preserves fulfillment and intelligence results when diagnostics fail", async () => {
    mocks.diagnostics.mockRejectedValue(new Error("Diagnostic storage unavailable."));
    const response = await runInternalJobs(internalRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ processed: 1, recovered: 0, intelligenceProcessed: 2, intelligenceRecovered: 1, errors: [{ worker: "diagnostics", message: "Diagnostic storage unavailable." }] });
    expect(mocks.fulfillment).toHaveBeenCalledTimes(1);
    expect(mocks.intelligence).toHaveBeenCalledTimes(1);
  });

  it("declares the collection-group status index used by all three diagnostic queue queries", () => {
    const configuration = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
    expect(configuration.fieldOverrides).toContainEqual(expect.objectContaining({ collectionGroup: "siteDiagnosticJobs", fieldPath: "status", indexes: expect.arrayContaining([{ order: "ASCENDING", queryScope: "COLLECTION_GROUP" }]) }));
  });
});
