import { assertDeploymentAccess } from "../deployment-access";
import { deleteApp, initializeServerApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp, isFirebaseAdminExplicitlyConfigured } from "./admin";
import { FIREBASE_SESSION_COOKIE, getFirebaseConfig } from "./config";

export async function createAuthenticatedFirebaseServerApp(idToken: string, requestLifetime?: object) {
  const config = getFirebaseConfig();
  if (!idToken || idToken.length > 10_000) throw new Error("Authentication required.");
  const app = initializeServerApp(config, { authIdToken: idToken, ...(requestLifetime ? { releaseOnDeref: requestLifetime } : {}) });
  try {
    // The SDK caches server apps by a 32-bit hash. A hash match must never
    // establish token identity or reuse another session's authenticated user.
    if (app.settings.authIdToken !== idToken || app.options.projectId !== config.projectId) throw new Error("Authentication required.");
    const claims = decodeJwt(idToken), now = Date.now() / 1000;
    // Supplemental per-request checks for cached apps; signature verification
    // remains Firebase's responsibility, not this untrusted payload decode.
    if (claims.iss !== `https://securetoken.google.com/${config.projectId}` || claims.aud !== config.projectId || typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now) throw new Error("Authentication required.");
    if (isFirebaseAdminExplicitlyConfigured()) {
      // Admin-backed APIs bypass client rules, so check revocation/disabled users
      // on every request instead of trusting an old SDK session cache.
      const verified = await getAdminAuth(getFirebaseAdminApp()).verifyIdToken(idToken, true);
      if (verified.uid !== claims.sub) throw new Error("Authentication required.");
    }
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.uid !== claims.sub) throw new Error("Authentication required.");
    await assertDeploymentAccess(auth.currentUser.uid);
    return { app, auth, user: auth.currentUser, db: getFirestore(app) };
  } catch {
    // Request-lifetime instances are released by Firebase's finalizer. Explicit
    // cleanup here is only for callers without that lifecycle hook.
    if (!requestLifetime) await deleteApp(app);
    throw new Error("Authentication required.");
  }
}

export async function getAuthenticatedFirebaseContext() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(FIREBASE_SESSION_COOKIE)?.value;
  if (!idToken) throw new Error("Authentication required.");
  return createAuthenticatedFirebaseServerApp(idToken, cookieStore);
}

