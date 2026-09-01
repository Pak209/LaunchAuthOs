import { applicationDefault, cert, getApps, initializeApp, type AppOptions } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function adminOptions(): AppOptions {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawServiceAccount) {
    try {
      const serviceAccount = JSON.parse(rawServiceAccount) as { project_id: string; client_email: string; private_key: string };
      if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) throw new Error("required fields are missing");
      return {
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
        }),
        projectId: serviceAccount.project_id,
      };
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${error instanceof Error ? error.message : "unable to parse"}`);
    }
  }
  return {
    credential: applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };
}

export function getFirebaseAdminDb() {
  const app = getApps().find((candidate) => candidate.name === "launch-auth-admin")
    ?? initializeApp(adminOptions(), "launch-auth-admin");
  return getFirestore(app);
}

export function isFirebaseAdminExplicitlyConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE);
}
