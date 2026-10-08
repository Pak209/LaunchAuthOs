import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import * as firestoreSdk from "firebase/firestore";
import { connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getFirestore, runTransaction, setDoc, setLogLevel, updateDoc, writeBatch, type Firestore, type Transaction, type TransactionOptions } from "firebase/firestore";
import type { User } from "firebase/auth";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp, type App } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from "firebase-admin/firestore";
import { ProjectMutationConflictError, saveCampaignRevision } from "../lib/persistence";
import type { CampaignDraft, GeneratedCampaignAsset } from "../lib/types";

// Native ESM exports are immutable. A shallow export mirror lets the final test
// insert a timing-only spy while every operation still uses the real SDK. No
// Firestore reads, writes, commits, retries, permissions or responses are faked.
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
}));

// Deliberately independent of .env, .firebaserc, application auth, and live tests.
// Run only through scripts/test-firestore-order-lock.mjs (or an identically
// configured local emulator). Fail closed before constructing either SDK.
const projectId = "demo-launch-order-lock";
const emulatorHost = "127.0.0.1:18891";
const ownerId = "order-lock-owner";
const clientApps: FirebaseApp[] = [];
const clients = new Map<string, Firestore>();
let adminApp: App;
let admin: AdminFirestore;
let workspaceId: string;
let projectPath: string;

function client(uid: string): Firestore {
  const cached = clients.get(uid);
  if (cached) return cached;
  const app = initializeApp({ projectId, apiKey: "demo-emulator-only" }, `order-lock-${uid}`);
  clientApps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 18891, { mockUserToken: { sub: uid, user_id: uid } });
  clients.set(uid, db);
  return db;
}

function projectData() {
  return { workspaceId, createdBy: ownerId, name: "Original company", url: "https://example.com/", lifecycleStatus: "draft_ready", campaignStatus: "draft_ready" };
}

const childData: Record<string, Record<string, unknown>> = {
  "profiles/current": { company: "Original company" },
  "claims/claim-1": { id: "claim-1", text: "Original claim", approved: true },
  "evidence/evidence-1": { id: "evidence-1", url: "https://example.com/", contentHash: "original-hash" },
  "campaigns/current": { version: 1, status: "approved", assets: [{ content: "Original campaign" }] },
  "campaigns/current/versions/000001": { version: 1, status: "approved" },
};

async function seedProject(extra: Record<string, unknown> = {}) {
  const batch = admin.batch();
  batch.set(admin.doc(projectPath), { ...projectData(), ...extra });
  for (const [path, data] of Object.entries(childData)) batch.set(admin.doc(`${projectPath}/${path}`), data);
  await batch.commit();
}

async function denied(operation: Promise<unknown>) {
  // Do not accept a network/setup error as evidence that the rules worked.
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

async function ordinaryWritesAreDenied(db = client(ownerId)) {
  const project = doc(db, projectPath);
  await denied(updateDoc(project, { name: "Changed company", campaignStatus: "draft_ready", lifecycleStatus: "draft_ready" }));
  await denied(setDoc(project, projectData()));
  await denied(deleteDoc(project));
  for (const [path, data] of Object.entries(childData)) {
    const existing = doc(db, `${projectPath}/${path}`);
    await denied(setDoc(existing, { ...data, changed: true }));
    await denied(updateDoc(existing, { changed: true }));
    await denied(deleteDoc(existing));
  }
  for (const [path, data] of Object.entries({
    "profiles/new": { company: "New profile" },
    "claims/new": { id: "new", text: "New claim" },
    "evidence/new": { id: "new", url: "https://example.com/", contentHash: "new-hash" },
    "campaigns/new": { status: "draft" },
    "campaigns/current/versions/000002": { version: 2, status: "draft" },
  })) await denied(setDoc(doc(db, `${projectPath}/${path}`), data));
}

beforeAll(() => {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== emulatorHost
    || process.env.GCLOUD_PROJECT !== projectId) {
    throw new Error("Refusing non-isolated rules test. Use node scripts/test-firestore-order-lock.mjs.");
  }
  setLogLevel("silent");
  adminApp = initializeAdminApp({ projectId }, "order-lock-emulator-admin");
  admin = getAdminFirestore(adminApp);
});

beforeEach(async () => {
  const suffix = randomUUID().replaceAll("-", "");
  workspaceId = `order_lock_${suffix}`;
  projectPath = `workspaces/${workspaceId}/projects/${suffix.slice(0, 24)}`;
  const batch = admin.batch();
  batch.set(admin.doc(`workspaces/${workspaceId}`), { createdBy: ownerId });
  for (const [uid, role] of [[ownerId, "owner"], ["workspace-admin", "admin"], ["workspace-member", "member"]]) {
    batch.set(admin.doc(`workspaces/${workspaceId}/members/${uid}`), { userId: uid, role });
  }
  await batch.commit();
});

afterAll(async () => {
  await Promise.all(clientApps.map(deleteApp));
  if (admin) await admin.terminate();
  if (adminApp) await deleteAdminApp(adminApp);
});

describe("local Firestore order-lock rules", () => {
  it("allows a normal 100-claim, four-evidence normalized batch within rule access limits", async () => {
    const db = client(ownerId);
    const batch = writeBatch(db);
    batch.set(doc(db, projectPath), projectData());
    batch.set(doc(db, `${projectPath}/profiles/current`), { company: "Large evidence project" });
    batch.set(doc(db, `${projectPath}/campaigns/current`), { version: 1, status: "draft" });
    batch.set(doc(db, `${projectPath}/campaigns/current/versions/000001`), { version: 1, status: "draft" });
    for (let index = 0; index < 100; index++) {
      const id = `claim-${index}`;
      batch.set(doc(db, `${projectPath}/claims/${id}`), { id, text: `Claim ${index}`, approved: false });
    }
    for (let index = 0; index < 4; index++) {
      const id = `evidence-${index}`;
      batch.set(doc(db, `${projectPath}/evidence/${id}`), { id, url: `https://example.com/${index}`, contentHash: `hash-${index}` });
    }
    await batch.commit();
    const edit = writeBatch(db);
    edit.update(doc(db, projectPath), { name: "Reviewed large evidence project" });
    for (let index = 0; index < 100; index++) edit.update(doc(db, `${projectPath}/claims/claim-${index}`), { approved: true });
    await edit.commit();
    expect((await getDocFromServer(doc(db, `${projectPath}/claims/claim-99`))).data()?.approved).toBe(true);
  });

  it("allows unlocked owner creation, ordinary edits, and existing cleanup semantics", async () => {
    const db = client(ownerId);
    const batch = writeBatch(db);
    batch.set(doc(db, projectPath), projectData());
    for (const [path, data] of Object.entries(childData)) batch.set(doc(db, `${projectPath}/${path}`), data);
    await batch.commit();
    await updateDoc(doc(db, projectPath), { name: "Updated company" });
    for (const path of ["profiles/current", "claims/claim-1", "campaigns/current"]) {
      await updateDoc(doc(db, `${projectPath}/${path}`), { changed: true });
    }
    await setDoc(doc(db, `${projectPath}/campaigns/current/versions/000002`), { version: 2 });
    await denied(updateDoc(doc(db, `${projectPath}/evidence/evidence-1`), { contentHash: "changed" }));
    await denied(updateDoc(doc(db, `${projectPath}/campaigns/current/versions/000001`), { version: 2 }));
    expect((await getDocFromServer(doc(db, projectPath))).data()?.name).toBe("Updated company");
    await deleteDoc(doc(db, projectPath));
    for (const path of Object.keys(childData)) await deleteDoc(doc(db, `${projectPath}/${path}`));
    await deleteDoc(doc(db, `${projectPath}/campaigns/current/versions/000002`));
  });

  it.each(["workspace-admin", "workspace-member"])("preserves unlocked edits by %s", async (uid) => {
    await seedProject();
    const db = client(uid);
    await updateDoc(doc(db, projectPath), { name: "Allowed workspace edit" });
    await updateDoc(doc(db, `${projectPath}/profiles/current`), { company: "Allowed workspace edit" });
    await updateDoc(doc(db, `${projectPath}/claims/claim-1`), { approved: false });
    await updateDoc(doc(db, `${projectPath}/campaigns/current`), { status: "draft" });
  });

  it.each(["quote_ready", "awaiting_payment", "paid", "submitted", "processing", "published", "failed", "canceled", "refunded", "missing-status"])("denies all ordinary create/update/delete paths for order status %s", async (status) => {
    await seedProject();
    await admin.doc(`${projectPath}/orders/current`).set(status === "missing-status" ? {} : { status });
    await ordinaryWritesAreDenied();
    const db = client(ownerId);
    expect((await getDocFromServer(doc(db, projectPath))).exists()).toBe(true);
    expect((await getDocFromServer(doc(db, `${projectPath}/orders/current`))).exists()).toBe(true);
    expect((await admin.doc(`${projectPath}/profiles/current`).get()).data()?.company).toBe("Original company");
  });

  it.each(["workspace-admin", "workspace-member"])("does not let %s bypass an order lock", async (uid) => {
    await seedProject();
    await admin.doc(`${projectPath}/orders/current`).set({ status: "paid" });
    await ordinaryWritesAreDenied(client(uid));
  });

  it.each([
    ["campaignStatus", "awaiting_payment"], ["campaignStatus", "fulfillment"],
    ["lifecycleStatus", "awaiting_payment"], ["lifecycleStatus", "fulfillment"],
  ])("fences legacy %s=%s even without an order", async (field, status) => {
    await seedProject({ [field]: status });
    await ordinaryWritesAreDenied();
  });

  it("blocks orphan project recreation and orphan child edits/deletes while the order survives", async () => {
    await seedProject();
    await admin.doc(`${projectPath}/orders/current`).set({ status: "canceled" });
    await admin.doc(projectPath).delete();
    const db = client(ownerId);
    await denied(setDoc(doc(db, projectPath), projectData()));
    for (const [path, data] of Object.entries(childData)) {
      await denied(setDoc(doc(db, `${projectPath}/${path}`), { ...data, changed: true }));
      await denied(deleteDoc(doc(db, `${projectPath}/${path}`)));
    }
    const recreate = writeBatch(db);
    recreate.set(doc(db, projectPath), projectData());
    recreate.set(doc(db, `${projectPath}/campaigns/current`), { status: "draft" });
    await denied(recreate.commit());
    expect((await admin.doc(projectPath).get()).exists).toBe(false);
    expect((await admin.doc(`${projectPath}/orders/current`).get()).exists).toBe(true);
  });

  it("keeps cross-tenant reads and writes denied before and after ordering", async () => {
    await seedProject();
    const stranger = client("other-tenant-owner");
    for (const ordered of [false, true]) {
      if (ordered) await admin.doc(`${projectPath}/orders/current`).set({ status: "paid" });
      await denied(getDocFromServer(doc(stranger, projectPath)));
      await denied(getDocFromServer(doc(stranger, `${projectPath}/profiles/current`)));
      await denied(updateDoc(doc(stranger, projectPath), { name: "Wrong tenant" }));
      await denied(setDoc(doc(stranger, `${projectPath}/campaigns/new`), { status: "draft" }));
    }
  });

  it("denies tenant operations writes while preserving Admin SDK fulfillment writes", async () => {
    await seedProject();
    await admin.doc(`${projectPath}/orders/current`).set({ status: "paid" });
    const db = client(ownerId);
    for (const path of ["orders/current", "jobs/current", "directorySubmissions/current", "placements/current", "campaignApprovals/current", "auditLogs/current"]) {
      await denied(setDoc(doc(db, `${projectPath}/${path}`), { status: "submitted" }));
      await denied(deleteDoc(doc(db, `${projectPath}/${path}`)));
    }
    const operational = admin.batch();
    operational.update(admin.doc(projectPath), { campaignStatus: "fulfillment", lifecycleStatus: "fulfillment" });
    operational.update(admin.doc(`${projectPath}/orders/current`), { status: "submitted", externalId: "emulator-only-release" });
    operational.set(admin.doc(`${projectPath}/jobs/current`), { status: "complete" });
    operational.set(admin.doc(`${projectPath}/directorySubmissions/current`), { status: "submitted" });
    operational.set(admin.doc(`${projectPath}/placements/current`), { state: "published" });
    operational.set(admin.doc(`${projectPath}/auditLogs/current`), { action: "provider.submitted" });
    await operational.commit();
    expect((await getDocFromServer(doc(db, projectPath))).data()?.campaignStatus).toBe("fulfillment");
    expect((await getDocFromServer(doc(db, `${projectPath}/orders/current`))).data()?.status).toBe("submitted");
    expect((await getDocFromServer(doc(db, `${projectPath}/jobs/current`))).data()?.status).toBe("complete");
  });

  it("fences a real Web SDK transaction when Admin creates an order after its reads", async () => {
    await seedProject();
    const db = client(ownerId);
    let readComplete!: () => void;
    let releaseSave!: () => void;
    const read = new Promise<void>((resolve) => { readComplete = resolve; });
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    // This uses the actual optimistic Web SDK transaction implementation, not
    // the serial in-memory double. Its read-set matches the persistence guard.
    const saving = runTransaction(db, async (transaction) => {
      const [project, order] = await Promise.all([
        transaction.get(doc(db, projectPath)),
        transaction.get(doc(db, `${projectPath}/orders/current`)),
      ]);
      if (order.exists()) throw new Error("Fulfillment order locked the edit.");
      if (!project.exists()) throw new Error("Missing fixture project.");
      readComplete();
      await gate;
      transaction.update(doc(db, projectPath), { name: "Stale customer edit" });
      transaction.update(doc(db, `${projectPath}/profiles/current`), { company: "Stale customer edit" });
      transaction.update(doc(db, `${projectPath}/campaigns/current`), { status: "draft" });
    });
    // Attach a rejection handler before releasing the delayed operation.
    const outcome = saving.then(() => ({ saved: true, error: undefined }), (error: unknown) => ({ saved: false, error }));
    await read;
    try {
      await admin.runTransaction(async (transaction) => {
        await transaction.get(admin.doc(projectPath));
        transaction.create(admin.doc(`${projectPath}/orders/current`), { status: "awaiting_payment" });
        transaction.update(admin.doc(projectPath), { campaignStatus: "awaiting_payment", lifecycleStatus: "awaiting_payment" });
      });
    } finally { releaseSave(); }
    const result = await outcome;
    expect(result.saved).toBe(false);
    const error = result.error as { code?: string; message?: string };
    console.info(`[order-lock-race] observed ${error.code ?? error.message}`);
    expect(error.code === "permission-denied" || error.message === "Fulfillment order locked the edit.").toBe(true);
    expect((await admin.doc(projectPath).get()).data()?.name).toBe("Original company");
    expect((await admin.doc(`${projectPath}/profiles/current`).get()).data()?.company).toBe("Original company");
    expect((await admin.doc(`${projectPath}/campaigns/current`).get()).data()?.status).toBe("approved");
  });

  it("returns the production 409 conflict when an order races saveCampaignRevision's real commit", async () => {
    const localProjectId = randomUUID().replaceAll("-", "").slice(0, 24);
    workspaceId = `personal_${ownerId}`;
    projectPath = `workspaces/${workspaceId}/projects/${localProjectId}`;
    await admin.doc(`workspaces/${workspaceId}`).set({ createdBy: ownerId });
    await admin.doc(`workspaces/${workspaceId}/members/${ownerId}`).set({ userId: ownerId, role: "owner" });
    const assets: GeneratedCampaignAsset[] = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"].map((type, index) => ({
      id: `asset-${index}`, type: type as GeneratedCampaignAsset["type"], title: "Approved asset", content: "Original approved content", claimIds: ["claim-1"], status: "approved",
    }));
    const campaign: CampaignDraft = { version: 1, model: "emulator-test", status: "approved", assets, generatedAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z" };
    await seedProject({ claims: [{ id: "claim-1", text: "Approved claim", approved: true, sourceUrl: "https://example.com/", state: "VERIFIED" }] });
    await admin.doc(`${projectPath}/campaigns/current`).set(campaign);
    await admin.doc(`${projectPath}/campaigns/current/versions/000001`).set(campaign);
    const originalTransaction = firestoreSdk.runTransaction;
    let intercepted = false;
    let rawErrorCode: string | undefined;
    function racingTransaction<T>(db: Firestore, action: (transaction: Transaction) => Promise<T>, options?: TransactionOptions): Promise<T> {
      return originalTransaction(db, async (transaction) => {
        // The production helper has completed its real reads and queued writes;
        // the actual Web SDK commit remains pending until this callback returns.
        const result = await action(transaction);
        if (!intercepted) {
          intercepted = true;
          await admin.runTransaction(async (serverTransaction) => {
            await serverTransaction.get(admin.doc(projectPath));
            serverTransaction.create(admin.doc(`${projectPath}/orders/current`), { status: "awaiting_payment" });
            serverTransaction.update(admin.doc(projectPath), { campaignStatus: "awaiting_payment", lifecycleStatus: "awaiting_payment" });
          });
        }
        return result;
      }, options).catch((error: unknown) => {
        rawErrorCode = (error as { code?: string }).code;
        throw error;
      });
    }
    const intercept = vi.spyOn(firestoreSdk, "runTransaction").mockImplementation(racingTransaction);
    try {
      const user = { uid: ownerId, email: null, displayName: null } as User;
      const editing = saveCampaignRevision(client(ownerId), user, localProjectId, assets.map((asset) => ({ ...asset, content: "Stale replacement content" })), "draft");
      await expect(editing).rejects.toBeInstanceOf(ProjectMutationConflictError);
      await expect(editing).rejects.toMatchObject({ status: 409 });
      expect(intercepted).toBe(true);
      expect(rawErrorCode).toBe("permission-denied");
      console.info(`[order-lock-helper-race] observed ${rawErrorCode} translated to ProjectMutationConflictError (409)`);
      expect((await admin.doc(`${projectPath}/campaigns/current`).get()).data()).toEqual(campaign);
      expect((await admin.doc(`${projectPath}/campaigns/current/versions/000002`).get()).exists).toBe(false);
      expect((await admin.doc(projectPath).get()).data()?.campaignStatus).toBe("awaiting_payment");
    } finally { intercept.mockRestore(); }
  });
});
