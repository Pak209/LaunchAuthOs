import { afterEach, expect, it, vi } from "vitest";
const { admin, configured, db } = vi.hoisted(() => ({ admin: vi.fn(), configured: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/internal-admin", () => ({ requireInternalAdmin: admin }));
vi.mock("@/lib/firebase/admin", () => ({ isFirebaseAdminExplicitlyConfigured: configured, getFirebaseAdminDb: db }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/support-triage", async () => import("../lib/support-triage"));
import SupportQueue from "../app/admin/support/page";
afterEach(() => vi.resetAllMocks());
it("redirects unauthenticated access before reading any records", async () => {
  admin.mockRejectedValue(new Error("Authentication required."));
  await expect(SupportQueue({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
  expect(db).not.toHaveBeenCalled();
});
it("hides operator review from signed-in non-admin customers", async () => {
  admin.mockRejectedValue(new Error("Not found."));
  await expect(SupportQueue({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  expect(db).not.toHaveBeenCalled();
});
it("rejects a cursor for another collection before database access", async () => {
  admin.mockResolvedValue({}); configured.mockReturnValue(true);
  await expect(SupportQueue({ searchParams: Promise.resolve({ kind: "jobs", after: "customerMcpLinks/secret" }) })).rejects.toThrow("404");
  expect(db).not.toHaveBeenCalled();
});
