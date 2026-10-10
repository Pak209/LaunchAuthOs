import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(async () => ({})) }));
vi.mock("@/lib/firebase/config", () => ({ FIREBASE_SESSION_COOKIE: "session", isFirebaseConfigured: () => true }));
vi.mock("@/lib/firebase/server", () => ({ createAuthenticatedFirebaseServerApp: mocks.authenticate }));
vi.mock("@/lib/bounded-json", async () => import("../lib/bounded-json"));
import { POST } from "../app/api/auth/session/route";
const url = "https://launch.example/api/auth/session";
function request(body: string, origin: string | null = "https://launch.example", contentType = "application/json") { return new Request(url, { method: "POST", headers: { "content-type": contentType, ...(origin ? { origin } : {}) }, body }); }
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
it("rejects missing/foreign origins and nonJSON before authentication", async () => {
  for (const origin of [null, "https://foreign.example"]) expect((await POST(request("{}", origin))).status).toBe(403);
  expect((await POST(request("{}", "https://launch.example", "text/plain"))).status).toBe(415);
  expect(mocks.authenticate).not.toHaveBeenCalled();
});
it("bounds streamed session input and rejects invalid UTF8/JSON without authenticating", async () => {
  expect((await POST(request("x".repeat(12_001)))).status).toBe(413);
  expect((await POST(request("{"))).status).toBe(400);
  expect((await POST(new Request(url, { method: "POST", headers: { origin: "https://launch.example", "content-type": "application/json" }, body: new Uint8Array([255]) }))).status).toBe(400);
  expect(mocks.authenticate).not.toHaveBeenCalled();
});
it("sets a private HTTP-only cookie only after authentication and binds request lifetime", async () => {
  vi.stubEnv("NODE_ENV", "production"); const token = "synthetic".repeat(20), req = request(JSON.stringify({ idToken: token }));
  const response = await POST(req); expect(response.status).toBe(200); expect(mocks.authenticate).toHaveBeenCalledWith(token, req);
  expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i); expect(response.headers.get("set-cookie")).toMatch(/Secure/i); expect(response.headers.get("cache-control")).toContain("no-store");
});
it("never sets a cookie or exposes provider errors on verification failure", async () => {
  mocks.authenticate.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_DETAIL"));
  const response = await POST(request(JSON.stringify({ idToken: "synthetic".repeat(20) })));
  expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull(); expect(await response.text()).not.toContain("PRIVATE_PROVIDER_DETAIL");
});
