import { afterEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ configured: false, uid: "alice" as string | null, analyze: vi.fn(async () => ({ company: "local" })), enqueue: vi.fn(async () => ({ id: "synthetic" })), workspace: vi.fn() }));
vi.mock("@/lib/deployment-access", async () => import("../lib/deployment-access"));
vi.mock("@/lib/analyze", () => ({ analyzeCompany: s.analyze }));
vi.mock("@/lib/persistence", () => ({ ensureWorkspace: s.workspace }));
vi.mock("@/lib/firebase/config", () => ({ isFirebaseConfigured: () => s.configured }));
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: async () => { if (!s.uid) throw new Error("Authentication required."); const { assertDeploymentAccess } = await import("../lib/deployment-access"); await assertDeploymentAccess(s.uid, async () => ({ mode: "restricted", allowedUids: ["alice"] })); return { db: {}, user: { uid: s.uid } }; } }));
vi.mock("@/lib/firebase/admin", () => ({ isFirebaseAdminExplicitlyConfigured: () => true, getFirebaseAdminDb: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ clientRateLimitKey: () => "local", enforceRateLimit: vi.fn(), RateLimitError: class extends Error {} }));
vi.mock("@/lib/request-security", async () => import("../lib/request-security"));
vi.mock("@/lib/intelligence-jobs", () => ({ enqueueIntelligenceJob: s.enqueue }));
import { POST } from "../app/api/analyze/route";
function req(origin: string | null = "https://staging.example", url = "https://staging.example/api/analyze") { return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ url: "https://example.test/", userId: "alice" }) }); }
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); s.configured = false; s.uid = "alice"; });
it("missing config cannot crawl in production even with local opt-in", async () => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LOCAL_DEMO_ANALYSIS_ENABLED", "true"); expect((await POST(req())).status).toBe(503); expect(s.analyze).not.toHaveBeenCalled(); expect(s.enqueue).not.toHaveBeenCalled(); });
it("only explicit loopback development permits the local demo", async () => { vi.stubEnv("NODE_ENV", "development"); expect((await POST(req("http://localhost:3000", "http://localhost:3000/api/analyze"))).status).toBe(503); vi.stubEnv("LOCAL_DEMO_ANALYSIS_ENABLED", "true"); expect((await POST(req("http://localhost:3000", "http://localhost:3000/api/analyze"))).status).toBe(200); expect(s.analyze).toHaveBeenCalledTimes(1); });
it("direct API caller cannot choose an approved UID and foreign origins remain denied", async () => { s.configured = true; vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "restricted"); vi.stubEnv("STAGING_ALLOWED_FIREBASE_UIDS", "alice"); vi.stubEnv("K_SERVICE", "test-host"); for (const uid of [null, "bob"]) { s.uid = uid; expect((await POST(req(null))).status).toBe(401); } s.uid = "alice"; expect((await POST(req("https://foreign.example"))).status).toBe(400); expect(s.enqueue).not.toHaveBeenCalled(); expect(s.workspace).not.toHaveBeenCalled(); expect((await POST(req())).status).toBe(202); expect(s.enqueue).toHaveBeenCalledTimes(1); expect(s.analyze).not.toHaveBeenCalled(); });
