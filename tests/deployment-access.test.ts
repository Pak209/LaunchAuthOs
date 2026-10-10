import { afterEach, expect, it, vi } from "vitest";
import { assertDeploymentAccess, deploymentAccessMode, localAnalysisAllowed } from "../lib/deployment-access";
afterEach(() => vi.unstubAllEnvs());
const policy = (mode: unknown = "restricted", allowedUids: unknown = ["alice"]) => async () => ({ mode, allowedUids });
function restricted() { vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "restricted"); vi.stubEnv("STAGING_ALLOWED_FIREBASE_UIDS", "alice"); vi.stubEnv("K_SERVICE", "synthetic-host"); }
it("defaults production/hosted and invalid mode to restricted; standard must be explicit in production", () => {
  vi.stubEnv("NODE_ENV", "production"); expect(deploymentAccessMode()).toBe("restricted");
  vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "typo"); expect(deploymentAccessMode()).toBe("restricted");
  vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "standard"); expect(deploymentAccessMode()).toBe("standard");
});
it("requires both approved UID sets and restricted database policy", async () => {
  restricted(); await expect(assertDeploymentAccess("alice", policy())).resolves.toBeUndefined();
  await expect(assertDeploymentAccess("bob", policy("restricted", ["bob"]))).rejects.toThrow("Authentication required.");
  for (const read of [async () => undefined, policy("standard"), policy("unknown"), policy("restricted", []), policy("restricted", ["bob"]), policy("restricted", ["alice", 7]), policy("restricted", ["alice", "bad/id"]), policy("restricted", Array(11).fill("alice"))]) await expect(assertDeploymentAccess("alice", read)).rejects.toThrow();
  vi.stubEnv("STAGING_ALLOWED_FIREBASE_UIDS", ""); await expect(assertDeploymentAccess("alice", policy())).rejects.toThrow();
});
it("rechecks the policy on each request and denies unavailable storage", async () => {
  restricted(); const read = vi.fn().mockResolvedValueOnce({ mode: "restricted", allowedUids: ["alice"] }).mockResolvedValueOnce({ mode: "restricted", allowedUids: [] }).mockRejectedValueOnce(new Error("offline"));
  await assertDeploymentAccess("alice", read); await expect(assertDeploymentAccess("alice", read)).rejects.toThrow(); await expect(assertDeploymentAccess("alice", read)).rejects.toThrow();
});
it("local analysis needs explicit development opt-in, loopback and exact origin, never hosted or production", () => {
  const req = new Request("http://localhost:3000/api/analyze", { headers: { origin: "http://localhost:3000" } });
  vi.stubEnv("NODE_ENV", "development"); expect(localAnalysisAllowed(req)).toBe(false);
  vi.stubEnv("LOCAL_DEMO_ANALYSIS_ENABLED", "true"); expect(localAnalysisAllowed(req)).toBe(true);
  expect(localAnalysisAllowed(new Request(req.url))).toBe(false); expect(localAnalysisAllowed(new Request("https://public.example/api/analyze", { headers: { origin: "https://public.example" } }))).toBe(false);
  vi.stubEnv("NODE_ENV", "production"); expect(localAnalysisAllowed(req)).toBe(false);
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("K_SERVICE", "host"); expect(localAnalysisAllowed(req)).toBe(false);
});

it("deployed standard mode must match an explicit standard database policy", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "standard"); vi.stubEnv("K_SERVICE", "synthetic-host");
  for (const read of [async () => undefined, policy("restricted"), policy("bad")]) await expect(assertDeploymentAccess("alice", read)).rejects.toThrow();
  await expect(assertDeploymentAccess("alice", policy("standard"))).resolves.toBeUndefined();
});
