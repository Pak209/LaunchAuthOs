const configState = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/firebase/config", () => ({ isFirebaseConfigured: () => configState.configured }));
import { afterEach, expect, it, vi } from "vitest";
const { db, handle } = vi.hoisted(() => ({ db: vi.fn(), handle: vi.fn() }));
vi.mock("@/lib/customer-mcp/auth", async () => import("../lib/customer-mcp/auth"));
vi.mock("@/lib/customer-mcp/http", () => ({ handleMcp: handle }));
vi.mock("@/lib/customer-mcp/store", () => ({ CustomerStore: class {} }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: db }));
import { POST } from "../app/api/mcp/route";
import { GET } from "../app/.well-known/oauth-protected-resource/api/mcp/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); configState.configured = true; });
it("disabled routes return 503 before Firebase initialization or transport", async () => {
  vi.stubEnv("CUSTOMER_MCP_ENABLED", undefined);
  expect((await POST(new Request("https://launch.test/api/mcp", { method: "POST" }))).status).toBe(503);
  expect((await GET()).status).toBe(503);
  expect(db).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled();
});
it("enabled but incomplete configuration remains closed", async () => {
  vi.stubEnv("CUSTOMER_MCP_ENABLED", "true"); vi.stubEnv("CUSTOMER_MCP_RESOURCE", undefined);
  expect((await POST(new Request("https://launch.test/api/mcp", { method: "POST" }))).status).toBe(503);
  expect((await GET()).status).toBe(503);
  expect(db).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled();
});

it("missing Firebase configuration blocks MCP before storage even with OAuth configured", async () => {
  configState.configured = false; vi.stubEnv("CUSTOMER_MCP_ENABLED", "true");
  vi.stubEnv("CUSTOMER_MCP_ISSUER", "https://identity.example/"); vi.stubEnv("CUSTOMER_MCP_JWKS_URL", "https://identity.example/jwks"); vi.stubEnv("CUSTOMER_MCP_RESOURCE", "https://launch.test/api/mcp");
  expect((await POST(new Request("https://launch.test/api/mcp", { method: "POST" }))).status).toBe(503);
  expect(db).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled();
});
