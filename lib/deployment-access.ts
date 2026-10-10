import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "./firebase/admin";

export function deploymentAccessMode(): "standard" | "restricted" {
  const mode = process.env.DEPLOYMENT_ACCESS_MODE;
  if (mode === "standard") return "standard";
  if (mode === "restricted") return "restricted";
  // Production, hosted development and unknown configuration fail closed.
  if (mode || process.env.NODE_ENV === "production" || process.env.K_SERVICE || process.env.VERCEL) return "restricted";
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? "standard" : "restricted";
}
function approvedUids() {
  const raw = process.env.STAGING_ALLOWED_FIREBASE_UIDS ?? "";
  const ids = raw.split(",").map(s => s.trim());
  if (!raw || ids.length > 10 || ids.some(id => !id || id.length > 128 || /[/\x00-\x20\x7f]/.test(id))) return [];
  return ids;
}
/** Only call with a provider-verified UID, never a request body's identity. */
export async function assertDeploymentAccess(uid: string, readPolicy?: () => Promise<unknown>) {
  const mode = deploymentAccessMode();
  const deployed = !["development", "test"].includes(process.env.NODE_ENV ?? "") || Boolean(process.env.K_SERVICE || process.env.VERCEL);
  if (mode === "standard" && !deployed) return;
  if (!isFirebaseAdminExplicitlyConfigured() || (mode === "restricted" && !approvedUids().includes(uid))) throw new Error("Authentication required.");
  // The database policy also governs direct Web SDK/REST requests. Both lists
  // must permit the UID, and removing a database approval blocks the next call.
  const policy = (readPolicy ? await readPolicy() : (await getFirebaseAdminDb().doc("deploymentAccess/current").get()).data()) as { mode?: unknown; allowedUids?: unknown } | undefined;
  if (mode === "standard") {
    if (policy?.mode !== "standard") throw new Error("Authentication required.");
    return;
  }
  if (policy?.mode !== "restricted" || !Array.isArray(policy.allowedUids) || !policy.allowedUids.length || policy.allowedUids.length > 10 || !policy.allowedUids.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 128 && !/[/\x00-\x20\x7f]/.test(id)) || !policy.allowedUids.includes(uid)) throw new Error("Authentication required.");
}
export function localAnalysisAllowed(request: Request) {
  if (process.env.LOCAL_DEMO_ANALYSIS_ENABLED !== "true" || process.env.NODE_ENV !== "development" || process.env.K_SERVICE || process.env.VERCEL || deploymentAccessMode() !== "standard") return false;
  const url = new URL(request.url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && request.headers.get("origin") === url.origin;
}
