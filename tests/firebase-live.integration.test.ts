import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth, type User } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore, writeBatch, type Firestore } from "firebase/firestore";

type TestTenant = { app: FirebaseApp; db: Firestore; user: User; workspaceId: string; projectId: string };
const tenants: TestTenant[] = [];

function config() {
  const required = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(required).some((value) => !value)) throw new Error("Firebase integration environment is incomplete.");
  return required as Record<keyof typeof required, string>;
}

async function createTenant(label: string): Promise<TestTenant> {
  const suffix = randomUUID().replaceAll("-", "");
  const app = initializeApp(config(), `integration-${label}-${suffix}`);
  const credential = await createUserWithEmailAndPassword(getAuth(app), `launch-auth-${label}-${suffix}@example.com`, `Test-${suffix}!`);
  const db = getFirestore(app);
  const workspaceId = `integration_${credential.user.uid}`;
  const projectId = suffix.slice(0, 24);
  const workspace = doc(db, "workspaces", workspaceId);
  const project = doc(workspace, "projects", projectId);
  const tenantBatch = writeBatch(db);
  tenantBatch.set(workspace, { name: `${label} workspace`, createdBy: credential.user.uid, billingStatus: "not_configured" });
  tenantBatch.set(doc(workspace, "members", credential.user.uid), { userId: credential.user.uid, role: "owner" });
  await tenantBatch.commit();
  const projectBatch = writeBatch(db);
  projectBatch.set(project, { workspaceId, createdBy: credential.user.uid, name: `${label} project`, url: "https://example.com", lifecycleStatus: "evidence_review", campaignStatus: "evidence_review" });
  projectBatch.set(doc(project, "profiles", "current"), { company: label, version: 1 });
  projectBatch.set(doc(project, "evidence", "snapshot"), { id: "snapshot", url: "https://example.com", contentHash: "abc123" });
  projectBatch.set(doc(project, "claims", "claim"), { id: "claim", text: `${label} claim`, approved: false });
  projectBatch.set(doc(project, "campaigns", "current"), { status: "evidence_review" });
  projectBatch.set(doc(project, "campaigns", "current", "versions", "000001"), { version: 1, status: "draft" });
  await projectBatch.commit();
  const tenant = { app, db, user: credential.user, workspaceId, projectId };
  tenants.push(tenant);
  return tenant;
}

async function cleanTenant(tenant: TestTenant) {
  const workspace = doc(tenant.db, "workspaces", tenant.workspaceId);
  const project = doc(workspace, "projects", tenant.projectId);
  async function step(label: string, operation: Promise<unknown>) {
    try { await operation; } catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  await step("delete project", deleteDoc(project));
  await step("delete profile", deleteDoc(doc(project, "profiles", "current")));
  await step("delete claim", deleteDoc(doc(project, "claims", "claim")));
  await step("delete campaign version", deleteDoc(doc(project, "campaigns", "current", "versions", "000001")));
  await step("delete campaign", deleteDoc(doc(project, "campaigns", "current")));
  await step("delete evidence", deleteDoc(doc(project, "evidence", "snapshot")));
  await step("delete member", deleteDoc(doc(workspace, "members", tenant.user.uid)));
  await step("delete workspace", deleteDoc(workspace));
  await step("delete user", deleteUser(tenant.user));
  await step("delete app", deleteApp(tenant.app));
}

afterAll(async () => {
  await Promise.all(tenants.map(cleanTenant));
}, 30_000);

describe("live Firebase tenant isolation", () => {
  it("allows normalized owner records and denies cross-tenant access", async () => {
    const [alpha, beta] = await Promise.all([createTenant("alpha"), createTenant("beta")]);
    const alphaProject = doc(alpha.db, "workspaces", alpha.workspaceId, "projects", alpha.projectId);
    expect((await getDoc(alphaProject)).exists()).toBe(true);
    const crossTenantProject = doc(beta.db, "workspaces", alpha.workspaceId, "projects", alpha.projectId);
    await expect(getDoc(crossTenantProject)).rejects.toMatchObject({ code: "permission-denied" });
  }, 30_000);

  it("prevents evidence snapshots from being changed after capture", async () => {
    const tenant = tenants[0] ?? await createTenant("immutable");
    const evidence = doc(tenant.db, "workspaces", tenant.workspaceId, "projects", tenant.projectId, "evidence", "snapshot");
    const batch = writeBatch(tenant.db);
    batch.update(evidence, { contentHash: "changed" });
    await expect(batch.commit()).rejects.toMatchObject({ code: "permission-denied" });
  }, 30_000);
});
