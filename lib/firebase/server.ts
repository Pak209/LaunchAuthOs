import { initializeServerApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { cookies } from "next/headers";
import { FIREBASE_SESSION_COOKIE, getFirebaseConfig } from "./config";

export async function createAuthenticatedFirebaseServerApp(idToken: string) {
  const app = initializeServerApp(getFirebaseConfig(), { authIdToken: idToken });
  const auth = getAuth(app);
  await auth.authStateReady();
  if (!auth.currentUser) throw new Error("Authentication required.");
  return { app, auth, user: auth.currentUser, db: getFirestore(app) };
}

export async function getAuthenticatedFirebaseContext() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(FIREBASE_SESSION_COOKIE)?.value;
  if (!idToken) throw new Error("Authentication required.");
  return createAuthenticatedFirebaseServerApp(idToken);
}

