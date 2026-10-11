import { bootstrapPersonalWorkspace } from "../lib/personal-workspace";
import { CompanionService } from "../lib/companion/service";
import { emptyBrief } from "../lib/companion/model";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initializeApp as webApp, deleteApp as deleteWebApp, type FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore as webDb, doc, getDoc, setDoc, updateDoc, deleteDoc, setLogLevel } from "firebase/firestore";
let app: App, db: Firestore;
const clients: FirebaseApp[] = [];
const uid = "namespace_owner", deniedUid = "namespace_foreign";
function client(user: string | null) {
  const instance = webApp({ projectId: "demo-launch-order-lock", apiKey: "demo" }, `gate-${randomUUID()}`); clients.push(instance);
  const connection = webDb(instance);
  connectFirestoreEmulator(connection, "127.0.0.1", 18891, user ? { mockUserToken: { sub: user, user_id: user } } : {});
  return connection;
}
beforeAll(() => {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18891" || process.env.GCLOUD_PROJECT !== "demo-launch-order-lock") throw new Error("Refusing non-isolated deployment gate test.");
  setLogLevel("silent"); app = initializeApp({ projectId: "demo-launch-order-lock" }, "workspace-namespace"); db = getFirestore(app);
});
beforeEach(async () => { await db.doc("deploymentAccess/current").set({ mode: "restricted", allowedUids: [uid] }); });
afterEach(async () => { await db.recursiveDelete(db.doc(`workspaces/personal_${uid}`)); await db.recursiveDelete(db.doc(`workspaces/personal_${deniedUid}`)); await Promise.all(clients.splice(0).map(deleteWebApp)); await db.doc("deploymentAccess/current").set({ mode: "standard" }); });
afterAll(async () => { await db.doc(`users/${uid}`).delete(); await db.doc(`users/${deniedUid}`).delete(); await deleteApp(app); });

it("denies foreign namespace creation and legacy foreign member access", async () => {
  const web = client(uid), path = `workspaces/personal_${deniedUid}`;
  await expect(setDoc(doc(web, path), { createdBy: uid })).rejects.toMatchObject({ code: "permission-denied" });
  await db.doc(path).set({ createdBy: deniedUid });
  await db.doc(`${path}/members/${uid}`).set({ userId: uid, role: "owner" });
  await db.doc(`${path}/projects/test`).set({ createdBy: deniedUid });
  await expect(getDoc(doc(web, `${path}/projects/test`))).rejects.toMatchObject({ code: "permission-denied" });
});
it("denies parent and membership deletion and preserves own access", async () => {
  await bootstrapPersonalWorkspace(db, uid); const web = client(uid), path = `workspaces/personal_${uid}`;
  await expect(getDoc(doc(web, path))).resolves.toBeDefined();
  await expect(deleteDoc(doc(web, path))).rejects.toMatchObject({ code: "permission-denied" });
  await expect(deleteDoc(doc(web, `${path}/members/${uid}`))).rejects.toMatchObject({ code: "permission-denied" });
});
it.each([false, true])("rejects orphan/contaminated membership during bootstrap (parent=%s)", async parent => {
  const path = `workspaces/personal_${uid}`;
  if (parent) { await db.doc(path).set({ createdBy: uid }); await db.doc(`${path}/members/${uid}`).set({ userId: uid, role: "owner" }); }
  await db.doc(`${path}/members/${deniedUid}`).set({ userId: deniedUid, role: "owner" });
  await expect(bootstrapPersonalWorkspace(db, uid)).rejects.toThrow("Workspace access denied");
  await expect(new CompanionService(db).saveBrief(uid, "a".repeat(24), { expectedRevision: 0, brief: emptyBrief }, true)).rejects.toThrow("Workspace access denied");
  expect((await db.doc(`${path}/projects/${"a".repeat(24)}`).get()).exists).toBe(false);
});
it("denies orphan self-member access to leftover data", async () => {
  const path = `workspaces/personal_${uid}`;
  await db.doc(`${path}/members/${uid}`).set({ userId: uid, role: "owner" });
  await db.doc(`${path}/projects/test`).set({ createdBy: uid });
  await expect(getDoc(doc(client(uid), `${path}/projects/test`))).rejects.toMatchObject({ code: "permission-denied" });
  await expect(bootstrapPersonalWorkspace(db, uid)).rejects.toThrow("Workspace access denied");
});
it("serializes concurrent fresh bootstrap and creates exactly one owner", async () => {
  await Promise.all([bootstrapPersonalWorkspace(db, uid), bootstrapPersonalWorkspace(db, uid)]);
  const members = await db.doc(`workspaces/personal_${uid}`).collection("members").get();
  expect(members.docs.map(item => item.id)).toEqual([uid]);
  await expect(bootstrapPersonalWorkspace(db, uid)).resolves.toBe(`personal_${uid}`);
});
