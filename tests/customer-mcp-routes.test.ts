import { afterEach, expect, it, vi } from "vitest";
const { db, handle } = vi.hoisted(() => ({ db: vi.fn(), handle: vi.fn() }));
vi.mock("@/lib/customer-mcp/auth", async () => import("../lib/customer-mcp/auth"));
vi.mock("@/lib/customer-mcp/http", () => ({ handleMcp: handle }));
vi.mock("@/lib/customer-mcp/store", () => ({ CustomerStore: class {} }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: db }));
import { POST } from "../app/api/mcp/route";
import { GET } from "../app/.well-known/oauth-protected-resource/api/mcp/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
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
