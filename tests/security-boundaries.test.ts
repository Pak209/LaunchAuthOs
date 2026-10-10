import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeServerApp, deleteApp, type FirebaseApp } from "firebase/app";
const state = vi.hoisted(() => ({ getAuth: vi.fn(), getFirestore: vi.fn(), adminEnabled: false, verifyIdToken: vi.fn(), policy: { mode: "restricted", allowedUids: ["alice"] } }));
vi.mock("firebase/auth", () => ({ getAuth: state.getAuth }));
vi.mock("firebase/firestore", () => ({ getFirestore: state.getFirestore }));
vi.mock("../lib/firebase/admin", () => ({ isFirebaseAdminExplicitlyConfigured: () => state.adminEnabled, getFirebaseAdminApp: () => ({}), getFirebaseAdminDb: () => ({ doc: () => ({ get: async () => ({ data: () => state.policy }) }) }) }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: state.verifyIdToken }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../lib/firebase/config", () => ({ FIREBASE_SESSION_COOKIE: "launch_auth_session", getFirebaseConfig: () => ({ apiKey: "synthetic-key", projectId: "synthetic-session-boundary" }) }));
import { createAuthenticatedFirebaseServerApp } from "../lib/firebase/server";
const apps: FirebaseApp[] = [];
const token = (signature: string, sub = "synthetic-user", exp = 4102444800) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ exp, iat: 1600000000, auth_time: 1600000000, iss: "https://securetoken.google.com/synthetic-session-boundary", aud: "synthetic-session-boundary", sub })).toString("base64url")}.${signature}`;
beforeEach(() => { state.adminEnabled = false; });
afterEach(async () => { for (const app of apps.splice(0)) await deleteApp(app); vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("Firebase server session boundaries", () => {
  it("fails closed when SDK's 32-bit cache key collides with another session", async () => {
    // Aa and BB collide under the installed SDK's polynomial hash. No network,
    // credentials or real users: the SDK cache is real; Auth is a local stub.
    const first = token("Aa"), second = token("BB");
    const app = initializeServerApp({ apiKey: "synthetic-key", projectId: "synthetic-session-boundary" }, { authIdToken: first }); apps.push(app);
    state.getAuth.mockReturnValue({ currentUser: { uid: "another-session" }, authStateReady: async () => {} });
    state.getFirestore.mockReturnValue({});
    await expect(createAuthenticatedFirebaseServerApp(second)).rejects.toThrow(/Authentication/);
    expect(state.getAuth).not.toHaveBeenCalled();
  });
  it("keeps overlapping distinct session contexts separate", async () => {
    const a = token("customer-a", "alice"), b = token("customer-b", "bob");
    state.getAuth.mockImplementation(app => {
      apps.push(app);
      return { currentUser: { uid: app.settings.authIdToken === a ? "alice" : "bob" }, authStateReady: async () => { await Promise.resolve(); } };
    });
    state.getFirestore.mockImplementation(app => ({ session: app.settings.authIdToken }));
    const [left, right] = await Promise.all([createAuthenticatedFirebaseServerApp(a), createAuthenticatedFirebaseServerApp(b)]);
    expect(left.user.uid).toBe("alice"); expect(right.user.uid).toBe("bob");
    expect(left.db).not.toEqual(right.db);
  });
  it("rejects a cached expired token even when Auth still exposes a user", async () => {
    const expired = token("expired-cache", "synthetic-user", 1600000001);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = initializeServerApp({ apiKey: "synthetic-key", projectId: "synthetic-session-boundary" }, { authIdToken: expired }); apps.push(app);
    warning.mockRestore();
    state.getAuth.mockReturnValue({ currentUser: { uid: "synthetic-user" }, authStateReady: async () => {} });
    await expect(createAuthenticatedFirebaseServerApp(expired)).rejects.toThrow(/Authentication/);
    expect(state.getFirestore).not.toHaveBeenCalled();
  });
  it("does not authenticate when Firebase has no signed-in user", async () => {
    state.getAuth.mockReturnValue({ currentUser: null, authStateReady: async () => {} });
    await expect(createAuthenticatedFirebaseServerApp(token("negative-auth"))).rejects.toThrow("Authentication required.");
    expect(state.getFirestore).not.toHaveBeenCalled();
  });
  it.each(["auth/id-token-revoked", "auth/user-disabled"])("checks Admin revocation on every request and sanitizes %s", async code => {
    state.adminEnabled = true;
    state.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code }));
    const access = token(code.replaceAll("/", "-"));
    await expect(createAuthenticatedFirebaseServerApp(access)).rejects.toThrow("Authentication required.");
    expect(state.verifyIdToken).toHaveBeenCalledWith(access, true);
    expect(state.getAuth).not.toHaveBeenCalled();
  });
  it("rejects Admin-verified UID mismatch before creating a client context", async () => {
    state.adminEnabled = true; state.verifyIdToken.mockResolvedValueOnce({ uid: "different-customer" });
    await expect(createAuthenticatedFirebaseServerApp(token("admin-uid-mismatch"))).rejects.toThrow("Authentication required.");
    expect(state.getAuth).not.toHaveBeenCalled();
  });
  it("rejects a cached client user that differs from the verified subject", async () => {
    state.getAuth.mockReturnValue({ currentUser: { uid: "different-customer" }, authStateReady: async () => {} });
    await expect(createAuthenticatedFirebaseServerApp(token("client-uid-mismatch"))).rejects.toThrow("Authentication required.");
    expect(state.getFirestore).not.toHaveBeenCalled();
  });

  it("rechecks revocation after a prior successful cached session", async () => {
    state.adminEnabled = true;
    state.verifyIdToken.mockResolvedValueOnce({ uid: "synthetic-user" }).mockRejectedValueOnce(new Error("revoked"));
    state.getAuth.mockReturnValue({ currentUser: { uid: "synthetic-user" }, authStateReady: async () => {} });
    const access = token("later-revoked");
    const first = await createAuthenticatedFirebaseServerApp(access); apps.push(first.app);
    await expect(createAuthenticatedFirebaseServerApp(access)).rejects.toThrow("Authentication required.");
    expect(state.verifyIdToken).toHaveBeenCalledTimes(2);
    expect(state.getAuth).toHaveBeenCalledTimes(1);
  });

});

it("blocks verified but unapproved Firebase sessions before returning a database context", async () => {
  vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "restricted"); vi.stubEnv("STAGING_ALLOWED_FIREBASE_UIDS", "alice"); state.adminEnabled = true;
  state.verifyIdToken.mockImplementation(async access => ({ uid: JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).sub }));
  state.getAuth.mockImplementation(app => ({ currentUser: { uid: JSON.parse(Buffer.from(app.settings.authIdToken.split(".")[1], "base64url").toString()).sub }, authStateReady: async () => {} }));
  await expect(createAuthenticatedFirebaseServerApp(token("denied-staging", "bob"))).rejects.toThrow("Authentication required."); expect(state.getFirestore).not.toHaveBeenCalled();
  const context = await createAuthenticatedFirebaseServerApp(token("allowed-staging", "alice")); apps.push(context.app); expect(context.user.uid).toBe("alice");
});
