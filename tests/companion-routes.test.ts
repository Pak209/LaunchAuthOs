import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(async () => ({ user: { uid: "alice" } })), read: vi.fn(async () => ({ revision: 1 })), save: vi.fn(async () => ({ revision: 2 })), configured: vi.fn(() => true) }));
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: mocks.auth }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: vi.fn(), isFirebaseAdminExplicitlyConfigured: mocks.configured }));
vi.mock("@/lib/customer-mcp/auth", async () => import("../lib/customer-mcp/auth"));
vi.mock("@/lib/companion/service", () => ({ CompanionService: class { read = mocks.read; saveBrief = mocks.save; approveFacts = mocks.save; saveDraft = mocks.save; approveCampaign = mocks.save; archive = mocks.save; } }));
import { GET, POST } from "../app/api/companion/[projectId]/route";
const context = { params: Promise.resolve({ projectId: "a".repeat(24) }) };
const url = "https://launch.test/api/companion/" + "a".repeat(24);
function request(body: unknown, origin: string | null = "https://launch.test") { return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }); }
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
it("rejects cross-origin and absent-origin mutations before auth/storage", async () => { for (const origin of [null, "https://evil.test"]) expect((await POST(request({ action: "brief", payload: {} }, origin), context)).status).toBe(403); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); });
it("derives UID from the website session and rejects caller identity fields", async () => { expect((await POST(request({ action: "brief", payload: {}, userId: "bob" }), context)).status).toBe(400); await POST(request({ action: "brief", payload: {} }), context); expect(mocks.save).toHaveBeenCalledWith("alice", "a".repeat(24), {}, false); });
it("limits request bodies and keeps unavailable storage honest", async () => { expect((await POST(request({ action: "brief", payload: "x".repeat(160001) }), context)).status).toBe(413); mocks.configured.mockReturnValueOnce(false); expect((await GET(new Request(url), context)).status).toBe(503); expect(mocks.read).not.toHaveBeenCalled(); });
it("requires authenticated website access", async () => { mocks.auth.mockRejectedValueOnce(new Error("Authentication required.")); expect((await GET(new Request(url), context)).status).toBe(401); });

it("routes archive through the authenticated owner service", async () => { const payload = { archived: true, expectedRevision: 1 }; expect((await POST(request({ action: "archive", payload }), context)).status).toBe(200); expect(mocks.save).toHaveBeenCalledWith("alice", "a".repeat(24), payload); });
