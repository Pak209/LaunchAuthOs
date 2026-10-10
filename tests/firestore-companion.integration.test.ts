import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { CompanionService } from "../lib/companion/service";
import { emptyBrief } from "../lib/companion/model";

let app: App, db: Firestore, service: CompanionService, uid: string, id: string;
const root = () => db.doc(`workspaces/personal_${uid}`);
const project = () => root().collection("projects").doc(id);
const brief = () => ({ ...emptyBrief, company: "Synthetic test", facts: [{ id: "fact", text: "A supported statement", kind: "fact" as const, reference: "Owner evidence", approved: false }] });
const draft = (requestId = randomUUID()) => ({ expectedVersion: 0, briefRevision: 2, requestId, assets: [{ id: "press", type: "press_release", title: "Draft", content: "A supported statement", claimIds: ["fact"] }] });
async function approvedFacts() { await service.approveFacts(uid, id, { expectedRevision: 1, factIds: ["fact"] }); }
beforeAll(() => {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18891" || process.env.GCLOUD_PROJECT !== "demo-launch-order-lock") throw new Error("Use the isolated emulator launcher; refusing live data.");
  app = initializeApp({ projectId: "demo-launch-order-lock" }, "companion-emulator"); db = getFirestore(app); service = new CompanionService(db);
});
beforeEach(async () => {
  uid = `companion_${randomUUID().replaceAll("-", "")}`; id = randomUUID().replaceAll("-", "").slice(0, 24);
  await service.saveBrief(uid, id, { expectedRevision: 0, brief: brief() }, true);
});
afterEach(async () => { await db.recursiveDelete(root()); });
afterAll(async () => { await deleteApp(app); });
it("persists fact approval and invalidates it and campaign approval consistently after editing", async () => {
  await approvedFacts(); await service.saveDraft(uid, id, draft());
  const before = await service.read(uid, id);
  await service.approveCampaign(uid, id, { expectedVersion: 1, digest: before.campaign!.digest });
  const edited = brief(); edited.facts[0].text = "Changed statement";
  await service.saveBrief(uid, id, { expectedRevision: 2, brief: edited });
  const after = await service.read(uid, id);
  expect(after.revision).toBe(3); expect(after.brief.facts[0].approved).toBe(false);
  expect(after.campaign).toMatchObject({ version: 3, status: "draft" });
  expect((await project().collection("briefVersions").doc("000003").get()).data()?.brief).toEqual(after.brief);
  expect((await project().get()).data()?.claims[0].approved).toBe(false);
  await expect(service.approveCampaign(uid, id, { expectedVersion: 3, digest: after.campaign!.digest })).rejects.toMatchObject({ status: 409 });
});
it("serializes concurrent fact approval against a brief edit with no mixed revision", async () => {
  const results = await Promise.allSettled([
    service.approveFacts(uid, id, { expectedRevision: 1, factIds: ["fact"] }),
    service.saveBrief(uid, id, { expectedRevision: 1, brief: { ...brief(), angle: "New angle" } }),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  const current = await service.read(uid, id);
  expect(current.revision).toBe(2);
  expect((await project().collection("briefVersions").doc("000002").get()).data()?.brief).toEqual(current.brief);
});
it("deduplicates concurrent identical draft requests in real transactions", async () => {
  await approvedFacts(); const input = draft();
  const results = await Promise.all([service.saveDraft(uid, id, input), service.saveDraft(uid, id, input)]);
  expect(results.map(r => r.version)).toEqual([1, 1]);
  expect(results.filter(r => r.duplicate)).toHaveLength(1);
  expect((await project().collection("campaigns").doc("current").collection("versions").get()).size).toBe(1);
  await expect(service.saveDraft(uid, id, { ...input, assets: [{ ...input.assets[0], content: "Different content" }] })).rejects.toMatchObject({ status: 409 });
});
it("allows only one competing draft at the same expected version", async () => {
  await approvedFacts();
  const results = await Promise.allSettled([service.saveDraft(uid, id, draft()), service.saveDraft(uid, id, draft())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect((await project().collection("companionRequests").get()).size).toBe(1);
});
it.each(["pending", "approved", "canceled", "refunded"])("freezes every mutation with a %s order", async status => {
  await approvedFacts(); const input = draft(); await service.saveDraft(uid, id, input);
  const before = await service.read(uid, id); await project().collection("orders").doc("current").set({ status });
  for (const action of [
    () => service.saveBrief(uid, id, { expectedRevision: 2, brief: brief() }),
    () => service.approveFacts(uid, id, { expectedRevision: 2, factIds: [] }),
    () => service.saveDraft(uid, id, input),
    () => service.approveCampaign(uid, id, { expectedVersion: 1, digest: before.campaign!.digest }),
  ]) await expect(action()).rejects.toMatchObject({ status: 409 });
  expect((await service.read(uid, id)).campaign).toEqual(before.campaign);
});
it("rejects foreign owner bindings and revoked membership for reads and writes", async () => {
  await expect(service.read("different_customer", id)).rejects.toMatchObject({ status: 403 });
  await project().update({ createdBy: "different_customer" });
  await expect(service.read(uid, id)).rejects.toMatchObject({ status: 404 });
  await expect(service.saveBrief(uid, id, { expectedRevision: 1, brief: brief() })).rejects.toMatchObject({ status: 404 });
  await project().update({ createdBy: uid }); await root().collection("members").doc(uid).delete();
  await expect(service.read(uid, id)).rejects.toMatchObject({ status: 403 });
  await expect(service.approveFacts(uid, id, { expectedRevision: 1, factIds: ["fact"] })).rejects.toMatchObject({ status: 403 });
});

it("never embeds new source copies in history and scrubs legacy copies on removal", async () => {
  await project().collection("briefVersions").doc("legacy").set({ brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "LEGACY_SOURCE" }] }, savedAt: "2020-01-01T00:00:00.000Z" });
  await project().update({ sourceHistorySanitized: false });
  await service.saveBrief(uid, id, { expectedRevision: 1, brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "CURRENT_SOURCE" }] } });
  await service.saveBrief(uid, id, { expectedRevision: 2, brief: brief() });
  for (const d of (await project().collection("briefVersions").get()).docs) expect(d.data().brief.sources).toEqual([]);
  expect((await service.read(uid, id)).brief.sources).toEqual([]);
});
it("fails source editing atomically when legacy history exceeds migration bound", async () => {
  const batch = db.batch();
  for (let i = 0; i < 51; i++) batch.set(project().collection("briefVersions").doc(`old${i}`), { brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "OLD" }] } });
  batch.update(project(), { sourceHistorySanitized: false }); await batch.commit();
  await expect(service.saveBrief(uid, id, { expectedRevision: 1, brief: brief() })).rejects.toMatchObject({ status: 409 });
  expect((await service.read(uid, id)).revision).toBe(1);
  expect((await project().collection("briefVersions").doc("old0").get()).data()?.brief.sources).toHaveLength(1);
});
it("retains active sources and current drafts, expires archived sources/history/logs only on explicit execution", async () => {
  const { applyCompanionRetention, RETENTION_MS } = await import("../lib/companion/retention");
  await service.saveBrief(uid, id, { expectedRevision: 1, brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "SOURCE" }] } });
  await service.approveFacts(uid, id, { expectedRevision: 2, factIds: ["fact"] });
  await service.saveDraft(uid, id, { ...draft(), briefRevision: 3 });
  const future = Date.now() + RETENTION_MS + 1000;
  const active = await applyCompanionRetention(db, uid, id, { now: future });
  expect(active.expiredSources).toBe(false); expect(active.historyCandidates).toBeGreaterThan(0);
  expect((await project().collection("briefVersions").get()).size).toBeGreaterThan(0);
  await service.archive(uid, id, { expectedRevision: 3, archived: true });
  await expect(service.saveDraft(uid, id, { ...draft(), expectedVersion: 1, briefRevision: 4 })).rejects.toThrow(/archived/);
  const plan = await applyCompanionRetention(db, uid, id, { now: future });
  expect(plan.expiredSources).toBe(true); expect(plan.dryRun).toBe(true);
  expect((await service.read(uid, id)).brief.sources).toHaveLength(1);
  await applyCompanionRetention(db, uid, id, { now: future, execute: true });
  const current = await service.read(uid, id);
  expect(current.brief.sources).toEqual([]); expect(current.brief.facts[0].approved).toBe(false);
  expect(current.campaign?.assets[0].content).toBe("A supported statement");
  expect((await project().collection("briefVersions").get()).size).toBe(0);
  expect((await project().collection("companionOperationalLogs").get()).size).toBe(0);
});
it("restoring before expiry cancels source expiry and logs never contain customer text", async () => {
  const { applyCompanionRetention, RETENTION_MS } = await import("../lib/companion/retention");
  await service.saveBrief(uid, id, { expectedRevision: 1, brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "PRIVATE_SOURCE" }] } });
  await service.archive(uid, id, { expectedRevision: 2, archived: true });
  await service.archive(uid, id, { expectedRevision: 3, archived: false });
  const plan = await applyCompanionRetention(db, uid, id, { now: Date.now() + RETENTION_MS + 1000, execute: true });
  expect(plan.expiredSources).toBe(false);
  expect((await service.read(uid, id)).brief.sources).toHaveLength(1);
  await service.archive(uid, id, { expectedRevision: 4, archived: true });
  for (const d of (await project().collection("companionOperationalLogs").get()).docs) {
    expect(Object.keys(d.data()).sort()).toEqual(["createdAt", "event", "expiresAt"]);
    expect(JSON.stringify(d.data())).not.toContain("PRIVATE_SOURCE");
  }
});
it.each(["orders", "campaignApprovals", "placements", "siteDiagnosticReports"])("protects undecided %s retention and rejects foreign cleanup", async collection => {
  const { applyCompanionRetention, RETENTION_MS } = await import("../lib/companion/retention");
  await service.saveBrief(uid, id, { expectedRevision: 1, brief: { ...brief(), sources: [{ id: "s", name: "s.txt", excerpt: "SOURCE" }] } });
  await service.archive(uid, id, { expectedRevision: 2, archived: true });
  await project().collection(collection).doc("record").set({ status: "refunded" });
  const result = await applyCompanionRetention(db, uid, id, { execute: true, now: Date.now() + RETENTION_MS + 1000 });
  expect(result.protectedRecords).toBe(true); expect(result.historyCandidates).toBe(0); expect(result.expiredSources).toBe(false);
  expect((await project().collection(collection).doc("record").get()).exists).toBe(true);
  await expect(applyCompanionRetention(db, "foreign", id, { execute: true })).rejects.toMatchObject({ status: 403 });
});
it("denies direct client mutation of server-owned guided projects", async () => {
  const web = await import("firebase/app"), fs = await import("firebase/firestore");
  const client = web.initializeApp({ projectId: "demo-launch-order-lock", apiKey: "demo" }, `companion-client-${randomUUID()}`);
  try {
    const connection = fs.getFirestore(client); fs.connectFirestoreEmulator(connection, "127.0.0.1", 18891, { mockUserToken: { sub: uid, user_id: uid } });
    const ref = fs.doc(connection, project().path);
    await expect(fs.updateDoc(ref, { "brief.facts": [{ approved: true }], archivedAt: "2020-01-01" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(fs.deleteDoc(ref)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(fs.setDoc(fs.doc(connection, `${project().path}/campaigns/current`), { status: "approved" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(fs.setDoc(fs.doc(connection, `${root().path}/projects/${"b".repeat(24)}`), { workspaceId: `personal_${uid}`, createdBy: uid, lifecycleStatus: "evidence_review", brief: brief() })).rejects.toMatchObject({ code: "permission-denied" });
  } finally { await web.deleteApp(client); }
});
