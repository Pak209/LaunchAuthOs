import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initializeApp as webApp, deleteApp as deleteWebApp, type FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore as webDb, doc, getDoc, setDoc, updateDoc, deleteDoc, setLogLevel } from "firebase/firestore";
let app: App, db: Firestore;
const clients: FirebaseApp[] = [];
const uid = "pilot_allowed", deniedUid = "pilot_denied";
function client(user: string | null) {
  const instance = webApp({ projectId: "demo-launch-order-lock", apiKey: "demo" }, `gate-${randomUUID()}`); clients.push(instance);
  const connection = webDb(instance);
  connectFirestoreEmulator(connection, "127.0.0.1", 18891, user ? { mockUserToken: { sub: user, user_id: user } } : {});
  return connection;
}
beforeAll(() => {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18891" || process.env.GCLOUD_PROJECT !== "demo-launch-order-lock") throw new Error("Refusing non-isolated deployment gate test.");
  setLogLevel("silent"); app = initializeApp({ projectId: "demo-launch-order-lock" }, "deployment-gate"); db = getFirestore(app);
});
beforeEach(async () => { await db.doc("deploymentAccess/current").set({ mode: "restricted", allowedUids: [uid] }); });
afterEach(async () => { await Promise.all(clients.splice(0).map(deleteWebApp)); await db.doc("deploymentAccess/current").set({ mode: "standard" }); });
afterAll(async () => { await db.doc(`users/${uid}`).delete(); await db.doc(`users/${deniedUid}`).delete(); await deleteApp(app); });
it("allows permitted pilot identity and denies other signed-in and anonymous identities", async () => {
  await setDoc(doc(client(uid), `users/${uid}`), { displayName: "Synthetic" });
  await expect(getDoc(doc(client(uid), `users/${uid}`))).resolves.toBeDefined();
  await expect(setDoc(doc(client(deniedUid), `users/${deniedUid}`), { displayName: "Bypass" })).rejects.toMatchObject({ code: "permission-denied" });
  await expect(getDoc(doc(client(null), `users/${uid}`))).rejects.toMatchObject({ code: "permission-denied" });
});
it("blocks direct Firebase workspace writes outside the allowlist", async () => {
  const connection = client(deniedUid);
  await expect(setDoc(doc(connection, `workspaces/personal_${deniedUid}`), { createdBy: deniedUid })).rejects.toMatchObject({ code: "permission-denied" });
});
it("policy remains unreadable and immutable even to allowed clients", async () => {
  const ref = doc(client(uid), "deploymentAccess/current");
  await expect(getDoc(ref)).rejects.toMatchObject({ code: "permission-denied" });
  for (const action of [() => setDoc(ref, { mode: "standard" }), () => updateDoc(ref, { allowedUids: [deniedUid] }), () => deleteDoc(ref)]) await expect(action()).rejects.toMatchObject({ code: "permission-denied" });
});
it.each([null, {}, { mode: "unknown" }, { mode: "restricted" }, { mode: "restricted", allowedUids: uid }, { mode: "restricted", allowedUids: [] }, { mode: "restricted", allowedUids: [uid, 7] }, { mode: "restricted", allowedUids: [uid, "bad uid"] }, { mode: "restricted", allowedUids: [uid, "bad/uid"] }, { mode: "restricted", allowedUids: [uid, "bad\nuid"] }, { mode: "restricted", allowedUids: Array(11).fill(uid) }])("fails closed for missing or malformed policy %j", async policy => {
  if (policy === null) await db.doc("deploymentAccess/current").delete(); else await db.doc("deploymentAccess/current").set(policy);
  await expect(setDoc(doc(client(uid), `users/${uid}`), { displayName: "Must fail" })).rejects.toMatchObject({ code: "permission-denied" });
});
it("standard mode preserves existing per-user isolation", async () => {
  await db.doc("deploymentAccess/current").set({ mode: "standard" }); const connection = client(deniedUid);
  await expect(setDoc(doc(connection, `users/${deniedUid}`), { displayName: "Synthetic" })).resolves.toBeUndefined();
  await expect(getDoc(doc(connection, `users/${uid}`))).rejects.toMatchObject({ code: "permission-denied" });
});
