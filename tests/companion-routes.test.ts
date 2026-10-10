import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(async () => ({ user: { uid: "alice" } })), remove: vi.fn(async () => ({ deleted: true, accountDeleted: false })), read: vi.fn(async () => ({ revision: 1 })), save: vi.fn(async () => ({ revision: 2 })), configured: vi.fn(() => true) }));
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: mocks.auth }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: vi.fn(), isFirebaseAdminExplicitlyConfigured: mocks.configured }));
vi.mock("@/lib/customer-mcp/auth", async () => import("../lib/customer-mcp/auth"));
vi.mock("@/lib/companion/service", () => ({ CompanionService: class { read = mocks.read; saveBrief = mocks.save; approveFacts = mocks.save; saveDraft = mocks.save; approveCampaign = mocks.save; archive = mocks.save; } }));
vi.mock("@/lib/companion/deletion", () => ({ deleteCompanionProject: mocks.remove }));
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

it("requires session identity and same origin for explicit project deletion", async () => {
  const payload = { confirmation: "DELETE " + "a".repeat(24), includeDerivedContent: true, expectedRevision: 1, expectedCampaignVersion: 0 };
  expect((await POST(request({ action: "delete", payload }, "https://evil.test"), context)).status).toBe(403);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect((await POST(request({ action: "delete", payload, userId: "bob" }), context)).status).toBe(400);
  expect((await POST(request({ action: "delete", payload }), context)).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith(undefined, "alice", "a".repeat(24), payload);
});

it("blocks account deletion explicitly without mutating data or claiming a queued request", async () => {
  const response = await POST(request({ action: "delete_account", payload: {} }), context);
  expect(response.status).toBe(409); expect((await response.json()).error).toContain("No account deletion was queued or performed");
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
