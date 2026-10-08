import { createHash } from "node:crypto";
import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignDigest } from "../lib/campaign-approval";
import { prepareFulfillment } from "../lib/fulfillment";
import { persistAnalysis, saveCampaignRevision, saveGeneratedCampaign, updateProjectCampaign } from "../lib/persistence";
import type { CampaignDraft, PersistedAnalysisResult } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

type MemoryRef = ReturnType<MemoryFirestore["doc"]>;
type MemoryTransaction = Parameters<Parameters<MemoryFirestore["runTransaction"]>[0]>[0];
type MemorySnapshot = Awaited<ReturnType<MemoryRef["get"]>>;
type WebSnapshot = { id: string; exists: () => boolean; data: MemorySnapshot["data"] };
type WebTransaction = Omit<MemoryTransaction, "get"> & { get: (ref: MemoryRef) => Promise<WebSnapshot> };

const standaloneReads = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; db: unknown }>,
  failures: new Map<string, Error>(),
}));

// Adapt only the modular Web SDK surface used by the real persistence helpers.
// Both SDKs share the storage double's atomic, serialized transactions, including
// read-before-write checks. This is not an emulator: it does not model Web SDK
// optimistic retries, nested merge semantics, auth, or Firestore security rules.
vi.mock("firebase/firestore", async () => {
  const { FieldValue } = await import("firebase-admin/firestore");
  const webSnapshot = (snapshot: MemorySnapshot): WebSnapshot => ({
    id: snapshot.id,
    exists: () => snapshot.exists,
    data: () => snapshot.data(),
  });
  return {
    doc: (parent: MemoryFirestore | MemoryRef, ...segments: string[]) => "path" in parent
      ? parent.db.doc([parent.path, ...segments].join("/"))
      : parent.doc(segments.join("/")),
    getDoc: async (ref: MemoryRef) => {
      standaloneReads.calls.push({ path: ref.path, db: ref.db });
      const failure = standaloneReads.failures.get(ref.path);
      if (failure) throw failure;
      return webSnapshot(await ref.get());
    },
    serverTimestamp: () => FieldValue.serverTimestamp(),
    setDoc: (ref: MemoryRef, data: Record<string, unknown>, options?: { merge: boolean }) =>
      ref.db.runTransaction(async (transaction) => { transaction.set(ref, data, options); }),
    writeBatch: (db: MemoryFirestore) => {
      const writes: Array<(transaction: MemoryTransaction) => void> = [];
      return {
        set: (ref: MemoryRef, data: Record<string, unknown>, options?: { merge: boolean }) => {
          writes.push((transaction) => transaction.set(ref, data, options));
        },
        commit: () => db.runTransaction(async (transaction) => { for (const write of writes) write(transaction); }),
      };
    },
    runTransaction: <T>(db: MemoryFirestore, callback: (transaction: WebTransaction) => Promise<T>) =>
      db.runTransaction((transaction) => callback({
        ...transaction,
        get: async (ref) => webSnapshot(await transaction.get(ref)),
      })),
  };
});

const uid = "owner";
const user = { uid, email: "owner@example.com", displayName: "Owner" } as User;
const sourceUrl = "https://acme.example/";
const projectId = createHash("sha256").update(`${uid}:${sourceUrl}`).digest("hex").slice(0, 24);
const workspacePath = `workspaces/personal_${uid}`;
const projectPath = `${workspacePath}/projects/${projectId}`;
const campaignPath = `${projectPath}/campaigns/current`;
const orderPath = `${projectPath}/orders/current`;
const timestamp = "2026-09-11T00:00:00.000Z";
const versionPath = (version: number) => `${campaignPath}/versions/${String(version).padStart(6, "0")}`;

function analysis(company = "Acme"): PersistedAnalysisResult {
  return {
    profile: {
      company, product: "Software", audience: "Teams", positioning: "A simpler workflow", sourceUrl,
      claims: [{ id: "approved", text: "Acme makes software.", sourceUrl, state: "VERIFIED", approved: true, evidenceIds: ["source"], observedAt: timestamp }],
      findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] },
    },
    readiness: { score: 80, label: "Ready", rationale: [], missingInformation: [], strongestStoryAngle: "A product launch" },
    sources: [{ id: "source", url: sourceUrl, title: "Acme", description: "Software", excerpt: "Software", contentHash: "original", capturedAt: timestamp }],
    fetchedAt: timestamp,
  };
}

const campaign: CampaignDraft = {
  version: 1, status: "approved", model: "original-model", generatedAt: timestamp, updatedAt: timestamp,
  assets: [{ id: "release", type: "press_release", title: "Acme Introduces A New Product Today", content: "word ".repeat(300), claimIds: ["approved"], status: "approved" }],
};
const newAssets = campaign.assets.map((asset) => ({ ...asset, content: "Changed approved content. ".repeat(100), status: "draft" as const }));
const details = { country: "United States", city: "Boston", categories: ["Technology"], contactName: "Founder", contactEmail: "press@example.com" };
const quote = { provider: "prnow", sandbox: false, nonBillable: false, currency: "usd", providerCostCents: 2175, providerPlan: "standard", requiredCredits: 10 };

function fixture() {
  const db = new MemoryFirestore();
  const result = analysis();
  db.seed(`${workspacePath}/members/${uid}`, { userId: uid, role: "owner" });
  db.seed(projectPath, {
    ...result, workspaceId: `personal_${uid}`, createdBy: uid, name: "Acme", url: sourceUrl,
    claims: result.profile.claims, campaignStatus: "campaign_approved", lifecycleStatus: "campaign_approved", updatedAtIso: timestamp,
  });
  db.seed(`${projectPath}/profiles/current`, { ...result.profile, version: 1 });
  db.seed(`${projectPath}/claims/approved`, result.profile.claims[0]);
  db.seed(`${projectPath}/evidence/source`, result.sources![0]);
  db.seed(campaignPath, campaign);
  db.seed(versionPath(1), { ...campaign, createdAt: timestamp });
  db.seed(`${projectPath}/campaignApprovals/current`, { approvedBy: uid, campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
  return db;
}

function projectTree(db: MemoryFirestore) {
  return [...db.rows.entries()]
    .filter(([path]) => path === projectPath || path.startsWith(`${projectPath}/`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => [path, structuredClone(data)]);
}

const webDb = (db: MemoryFirestore) => db as unknown as Firestore;
const mutators = [
  { name: "persistAnalysis", save: (db: MemoryFirestore) => persistAnalysis(webDb(db), user, analysis("Updated company")), expectedStatus: "evidence_review" },
  { name: "updateProjectCampaign", save: (db: MemoryFirestore) => updateProjectCampaign(webDb(db), user, projectId, analysis("Updated company").profile, analysis().profile.claims, "campaign"), expectedStatus: "draft_ready" },
  { name: "saveGeneratedCampaign", save: (db: MemoryFirestore) => saveGeneratedCampaign(webDb(db), user, projectId, newAssets, "new-model"), expectedStatus: "draft_ready" },
  { name: "saveCampaignRevision", save: (db: MemoryFirestore) => saveCampaignRevision(webDb(db), user, projectId, newAssets, "approved"), expectedStatus: "campaign_approved" },
];
const versionMutators = mutators.slice(2);
const prepare = (db: MemoryFirestore) => prepareFulfillment(db.asFirestore(), uid, projectId, campaign, quote, details, "launch");
const settled = (promise: Promise<unknown>) => promise.then(
  (value) => ({ ok: true as const, value }),
  (error: unknown) => ({ ok: false as const, error }),
);

beforeEach(() => {
  standaloneReads.calls.length = 0;
  standaloneReads.failures.clear();
});

function projectRechecks() {
  return standaloneReads.calls.filter(({ path }) => path === projectPath || path === orderPath);
}

describe("evidence saves invalidate current campaign approval", () => {
  it.each(["evidence_review", "approved", "campaign"] as const)("returns normalized evidence and a draft campaign for %s, without altering immutable history", async (status) => {
    const db = fixture();
    const originalVersion = db.read(versionPath(1));
    const profile = analysis("Corrected company").profile;
    const claims = profile.claims.map((claim) => ({ ...claim, text: "Corrected founder claim", sourceUrl: "https://untrusted.example/", evidenceIds: ["wrong-source"] }));
    const saved = await updateProjectCampaign(webDb(db), user, projectId, profile, claims, status);
    expect(saved.profile.company).toBe("Corrected company");
    expect(saved.profile.claims[0]).toMatchObject({ sourceUrl, evidenceIds: ["source"], state: "ASSUMED" });
    expect(saved.campaign?.status).toBe("draft");
    expect(saved.campaign?.assets.every((asset) => asset.status === "draft")).toBe(true);
    expect(db.read(campaignPath)).toMatchObject(saved.campaign!);
    expect(saved.campaignStatus).toBe(status === "campaign" ? "draft_ready" : status);
    expect(db.read(projectPath).profile).toEqual(saved.profile);
    expect(db.read(versionPath(1))).toEqual(originalVersion);
  });

  it("does not revive an old campaign attestation after evidence is saved and claims are reapproved", async () => {
    const db = fixture();
    const profile = analysis("Corrected company").profile;
    await updateProjectCampaign(webDb(db), user, projectId, profile, profile.claims, "evidence_review");
    await updateProjectCampaign(webDb(db), user, projectId, profile, profile.claims, "approved");
    await expect(prepare(db)).rejects.toThrow(/campaign changed/i);
    expect(db.rows.has(orderPath)).toBe(false);
    expect(db.read(campaignPath).status).toBe("draft");
    expect(db.read(versionPath(1)).status).toBe("approved");
  });

  it("returns no campaign before any assets have been generated", async () => {
    const db = fixture();
    db.seed(campaignPath, { status: "evidence_review", approvedClaimIds: [] });
    const profile = analysis().profile;
    const saved = await updateProjectCampaign(webDb(db), user, projectId, profile, profile.claims, "approved");
    expect(saved.campaign).toBeNull();
    expect(db.read(campaignPath).status).toBe("draft");
    expect(db.read(campaignPath).assets).toBeUndefined();
  });
});

describe.each(mutators)("$name mutation fence", ({ save, expectedStatus }) => {
  it("still saves an unlocked project and preserves existing immutable history", async () => {
    const db = fixture();
    const originalVersion = db.read(versionPath(1));
    await save(db);
    expect(db.read(projectPath).campaignStatus).toBe(expectedStatus);
    expect(db.read(versionPath(1))).toEqual(originalVersion);
    expect(db.rows.has(orderPath)).toBe(false);
  });

  it.each(["quote_ready", "awaiting_payment", "paid", "submitted", "processing", "published", "failed", "canceled", "refunded", undefined])(
    "rejects any existing order (%s), without changing the project subtree",
    async (status) => {
      const db = fixture();
      // Even an incomplete order is a fence; status is never the authority.
      db.seed(orderPath, status === undefined ? {} : { status });
      const before = projectTree(db);
      await expect(save(db)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fulfillment order/i) });
      expect(projectTree(db)).toEqual(before);
    },
  );

  it.each([
    { campaignStatus: "awaiting_payment" },
    { campaignStatus: "fulfillment" },
    { lifecycleStatus: "awaiting_payment" },
    { lifecycleStatus: "fulfillment" },
  ])("rejects a legacy locked project without an order: %j", async (legacyStatus) => {
    const db = fixture();
    db.seed(projectPath, { ...db.read(projectPath), ...legacyStatus });
    const before = projectTree(db);
    await expect(save(db)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fulfillment order/i) });
    expect(projectTree(db)).toEqual(before);
  });

  it("does not leave partial project writes when commit fails", async () => {
    const db = fixture();
    const before = projectTree(db);
    db.beforeCommit = (writes) => {
      if (writes.some((write) => write.ref.path === projectPath)) throw new Error("Simulated commit failure");
    };
    await expect(save(db)).rejects.toThrow("Simulated commit failure");
    expect(projectTree(db)).toEqual(before);
  });

  it("translates permission-denied at commit into 409 when a concurrent order is readable", async () => {
    const db = fixture();
    const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    let mutationAttempts = 0;
    let concurrentlyLockedTree: ReturnType<typeof projectTree> | undefined;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === projectPath)) return;
      mutationAttempts += 1;
      // Inject the externally committed order after this transaction's reads.
      // Throwing models a rules denial without pretending to emulate SDK retries.
      db.seed(orderPath, { status: "awaiting_payment", campaignVersion: 1 });
      concurrentlyLockedTree = projectTree(db);
      throw denied;
    };
    await expect(save(db)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fulfillment order/i) });
    expect(projectRechecks()).toEqual([{ path: projectPath, db }, { path: orderPath, db }]);
    expect(mutationAttempts).toBe(1);
    expect(projectTree(db)).toEqual(concurrentlyLockedTree);
    expect(db.rows.has(versionPath(2))).toBe(false);
  });

  it("rethrows the original permission-denied error when the recheck finds no lock", async () => {
    const db = fixture();
    const before = projectTree(db);
    const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    let mutationAttempts = 0;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === projectPath)) return;
      mutationAttempts += 1;
      throw denied;
    };
    await expect(save(db)).rejects.toBe(denied);
    expect(projectRechecks()).toEqual([{ path: projectPath, db }, { path: orderPath, db }]);
    expect(mutationAttempts).toBe(1);
    expect(projectTree(db)).toEqual(before);
  });

  it.each([
    { path: projectPath, code: "permission-denied" },
    { path: orderPath, code: "permission-denied" },
    { path: projectPath, code: "unavailable" },
    { path: orderPath, code: "unavailable" },
  ])("preserves the original denial when the authenticated recheck fails: %j", async ({ path, code }) => {
    const db = fixture();
    const denied = Object.assign(new Error("Original commit permission failure."), { code: "permission-denied" });
    const readFailure = Object.assign(new Error("Recheck access revoked or temporarily unavailable."), { code });
    let mutationAttempts = 0;
    let concurrentlyLockedTree: ReturnType<typeof projectTree> | undefined;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === projectPath)) return;
      mutationAttempts += 1;
      db.seed(orderPath, { status: "awaiting_payment" });
      concurrentlyLockedTree = projectTree(db);
      standaloneReads.failures.set(path, readFailure);
      throw denied;
    };
    await expect(save(db)).rejects.toBe(denied);
    expect(projectRechecks()).toEqual([{ path: projectPath, db }, { path: orderPath, db }]);
    expect(mutationAttempts).toBe(1);
    expect(projectTree(db)).toEqual(concurrentlyLockedTree);
  });

  it.each([
    new Error("Unclassified commit failure."),
    Object.assign(new Error("Storage temporarily unavailable."), { code: "unavailable" }),
  ])("does not recheck or relabel a non-permission transaction failure: %s", async (original) => {
    const db = fixture();
    let mutationAttempts = 0;
    let concurrentlyLockedTree: ReturnType<typeof projectTree> | undefined;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === projectPath)) return;
      mutationAttempts += 1;
      db.seed(orderPath, { status: "awaiting_payment" });
      concurrentlyLockedTree = projectTree(db);
      throw original;
    };
    await expect(save(db)).rejects.toBe(original);
    expect(projectRechecks()).toEqual([]);
    expect(mutationAttempts).toBe(1);
    expect(projectTree(db)).toEqual(concurrentlyLockedTree);
  });

  it("rejects a concurrent ordinary save when fulfillment commits first", async () => {
    const db = fixture();
    let saving: ReturnType<typeof settled> | undefined;
    let checkoutTree: ReturnType<typeof projectTree> | undefined;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === orderPath)) return;
      db.beforeCommit = undefined;
      // Begin the real ordinary save while checkout still holds the transaction.
      saving = settled(save(db));
    };
    db.afterCommit = (writes) => {
      if (writes.some((write) => write.ref.path === orderPath)) checkoutTree = projectTree(db);
    };
    await prepare(db);
    expect(saving).toBeDefined();
    expect(await saving).toMatchObject({ ok: false, error: { status: 409, message: expect.stringMatching(/fulfillment order/i) } });
    expect(db.read(orderPath)).toMatchObject({ status: "awaiting_payment", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
    expect(projectTree(db)).toEqual(checkoutTree);
  });

  it("rejects stale fulfillment when the concurrent ordinary save commits first", async () => {
    const db = fixture();
    let preparing: ReturnType<typeof settled> | undefined;
    let savedTree: ReturnType<typeof projectTree> | undefined;
    db.beforeCommit = (writes) => {
      if (!writes.some((write) => write.ref.path === campaignPath)) return;
      db.beforeCommit = undefined;
      // The checkout begins before the staged ordinary mutation is committed.
      preparing = settled(prepare(db));
    };
    db.afterCommit = (writes) => {
      if (writes.some((write) => write.ref.path === campaignPath)) savedTree = projectTree(db);
    };
    await save(db);
    expect(preparing).toBeDefined();
    expect(await preparing).toMatchObject({ ok: false, error: { message: expect.stringMatching(/campaign changed/i) } });
    expect(db.rows.has(orderPath)).toBe(false);
    expect(db.rows.has(`${projectPath}/jobs/provider_submission_current`)).toBe(false);
    expect(projectTree(db)).toEqual(savedTree);
  });
});

describe.each(versionMutators)("$name immutable versions", ({ save }) => {
  it("rejects a conflicting next version without changing any project document", async () => {
    const db = fixture();
    db.seed(versionPath(2), { immutable: "Do not overwrite", version: 2, assets: campaign.assets });
    const before = projectTree(db);
    await expect(save(db)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/newer saved version/i) });
    expect(projectTree(db)).toEqual(before);
  });

  it("creates exactly the next snapshot and preserves earlier history", async () => {
    const db = fixture();
    const original = db.read(versionPath(1));
    await save(db);
    expect(db.read(campaignPath).version).toBe(2);
    expect(db.read(versionPath(2))).toMatchObject({ version: 2, assets: db.read(campaignPath).assets });
    expect(db.read(versionPath(1))).toEqual(original);
  });

  it.each([-1, 1.5, 999999, "1", null, NaN, Infinity])("rejects an invalid or exhausted current version (%s) without writes", async (version) => {
    const db = fixture();
    db.seed(campaignPath, { ...campaign, version });
    const before = projectTree(db);
    await expect(save(db)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/version limit/i) });
    expect(projectTree(db)).toEqual(before);
  });
});
