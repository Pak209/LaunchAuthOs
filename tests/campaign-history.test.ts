import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listCampaignVersions, readCampaignVersion, restoreCampaignVersion, type RestoreCampaignInput } from "../lib/campaign-history";
import { assertCampaignAttestation, campaignDigest } from "../lib/campaign-approval";
import { prepareFulfillment } from "../lib/fulfillment";
import { enqueueIntelligenceJob } from "../lib/intelligence-jobs";
import type { CampaignDraft, CampaignAssetType } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const uid = "alice";
const projectId = "a".repeat(24);
const workspacePath = `workspaces/personal_${uid}`;
const projectPath = `${workspacePath}/projects/${projectId}`;
const campaignPath = `${projectPath}/campaigns/current`;
const approvalPath = `${projectPath}/campaignApprovals/current`;
const now = "2026-09-11T12:00:00.000Z";
const types: CampaignAssetType[] = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"];
const versionPath = (version: number) => `${campaignPath}/versions/${String(version).padStart(6, "0")}`;

function campaign(version = 2): CampaignDraft {
  return {
    version, status: "approved", model: "test-model", generatedAt: now, updatedAt: now,
    assets: types.map((type, index) => ({ id: `asset-${index}`, type, title: `Acme Introduces A New Product Version ${version}`, content: `Version ${version}. ${"Verified company facts. ".repeat(100)}`, claimIds: ["claim-1"], status: "approved" })),
  };
}

function database(version = 2) {
  const db = new MemoryFirestore();
  db.seed(`${workspacePath}/members/${uid}`, { userId: uid, role: "owner" });
  db.seed("workspaces/personal_bob/members/bob", { userId: "bob", role: "owner" });
  const source = { id: "source-1", url: "https://example.com/", title: "Company", description: "Facts", excerpt: "Facts", contentHash: "abc123", capturedAt: now };
  const claim = { id: "claim-1", text: "Company fact.", sourceUrl: source.url, state: "VERIFIED", approved: true, evidenceIds: [source.id] };
  db.seed(projectPath, { workspaceId: "personal_alice", createdBy: uid, url: source.url, claims: [claim], sources: [source], profile: { company: "Acme", sourceUrl: source.url, claims: [claim] }, campaignStatus: "campaign_approved", approvedAt: now });
  db.seed(`${projectPath}/evidence/${source.id}`, source);
  db.seed(campaignPath, campaign(version));
  db.seed(approvalPath, { approvedBy: uid, campaignVersion: version, campaignDigest: campaignDigest(campaign(version)) });
  for (let index = 1; index <= version; index++) db.seed(versionPath(index), { ...campaign(index), createdAt: now, privateMetadata: "do not serialize" });
  return db;
}

async function input(db: MemoryFirestore, version = 1): Promise<RestoreCampaignInput> {
  const preview = await readCampaignVersion(db.asFirestore(), uid, projectId, version);
  return { version, expectedVersion: preview.currentVersion, expectedDigest: preview.currentDigest, confirmed: true };
}

const details = { country: "United States", city: "Boston", categories: ["Technology"], contactName: "Founder", contactEmail: "press@example.com" };
const quote = { provider: "prnow", sandbox: false, nonBillable: false, currency: "usd", providerCostCents: 2175, providerPlan: "standard", requiredCredits: 10 };

describe("customer campaign version history", () => {
  it("lists bounded descending pages and exposes only public summaries", async () => {
    const db = database(60);
    const first = await listCampaignVersions(db.asFirestore(), uid, projectId);
    expect(first.versions).toHaveLength(25);
    expect(first.versions.map((item) => item.version)).toEqual(Array.from({ length: 25 }, (_, index) => 60 - index));
    expect(first.nextBeforeVersion).toBe(36);
    const second = await listCampaignVersions(db.asFirestore(), uid, projectId, first.nextBeforeVersion!);
    expect(second.versions).toHaveLength(25);
    expect(second.versions[0].version).toBe(35);
    const last = await listCampaignVersions(db.asFirestore(), uid, projectId, second.nextBeforeVersion!);
    expect(last.versions).toHaveLength(10);
    expect(last.nextBeforeVersion).toBeNull();
    expect(JSON.stringify(first)).not.toContain("privateMetadata");
    expect(JSON.stringify(first)).not.toContain("Verified company facts");
  });

  it("reads one exact immutable snapshot without internal fields", async () => {
    const db = database();
    const preview = await readCampaignVersion(db.asFirestore(), uid, projectId, 1);
    expect(preview.campaign).toEqual(campaign(1));
    expect(preview.currentVersion).toBe(2);
    expect(preview.currentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(preview)).not.toContain("privateMetadata");
    await expect(readCampaignVersion(db.asFirestore(), uid, projectId, 3)).rejects.toThrow("not found");
  });

  it("does not scan beyond a bounded page when legacy entries are missing or malformed", async () => {
    const db = database(30);
    for (let index = 6; index <= 30; index++) db.rows.delete(versionPath(index));
    db.seed(versionPath(30), { version: 30, assets: "malformed" });
    const page = await listCampaignVersions(db.asFirestore(), uid, projectId);
    expect(page.versions).toEqual([]);
    expect(page.nextBeforeVersion).toBe(6);
    expect((await listCampaignVersions(db.asFirestore(), uid, projectId, 6)).versions).toHaveLength(5);
  });

  it("isolates users and rejects revoked membership or mismatched project tenancy", async () => {
    const db = database();
    await expect(listCampaignVersions(db.asFirestore(), "bob", projectId)).rejects.toThrow("not found");
    await expect(readCampaignVersion(db.asFirestore(), "bob", projectId, 1)).rejects.toThrow("not found");
    const restoreInput = await input(db);
    await expect(restoreCampaignVersion(db.asFirestore(), "bob", projectId, restoreInput)).rejects.toThrow("not found");
    db.rows.delete(`${workspacePath}/members/${uid}`);
    await expect(listCampaignVersions(db.asFirestore(), uid, projectId)).rejects.toThrow("access denied");
    db.seed(`${workspacePath}/members/${uid}`, { userId: uid, role: "owner" });
    db.seed(projectPath, { ...db.read(projectPath), workspaceId: "personal_bob" });
    await expect(readCampaignVersion(db.asFirestore(), uid, projectId, 1)).rejects.toThrow("not found");
  });

  it("lets viewers inspect history but never restore it", async () => {
    const db = database();
    db.seed(`${workspacePath}/members/${uid}`, { userId: uid, role: "viewer" });
    expect((await listCampaignVersions(db.asFirestore(), uid, projectId)).versions).toHaveLength(2);
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow("access denied");
  });

  it("restores a new immutable draft, revokes old approval, and preserves every old snapshot", async () => {
    const db = database();
    const original = db.read(versionPath(1));
    const previous = db.read(versionPath(2));
    const draft = await restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db), Date.parse(now) + 60_000);
    expect(draft).toMatchObject({ version: 3, status: "draft", generatedAt: now });
    expect(draft.assets.every((asset) => asset.status === "draft")).toBe(true);
    expect(draft.assets[0].content).toBe(campaign(1).assets[0].content);
    expect(db.read(versionPath(1))).toEqual(original);
    expect(db.read(versionPath(2))).toEqual(previous);
    expect(db.read(versionPath(3))).toMatchObject({ restoredFromVersion: 1, version: 3, status: "draft" });
    expect(db.read(approvalPath)).toMatchObject({ status: "revoked", reason: "campaign_restored" });
    expect(db.read(approvalPath).approvedBy).toBeUndefined();
    expect(db.read(approvalPath).campaignDigest).toBeUndefined();
    expect(db.read(projectPath)).toMatchObject({ campaignStatus: "draft_ready", lifecycleStatus: "draft_ready", approvedAt: null });
    expect(() => assertCampaignAttestation(draft, undefined, uid)).toThrow("Approve");
    const audits = [...db.rows.entries()].filter(([path]) => path.startsWith(`${projectPath}/auditLogs/`));
    expect(audits).toHaveLength(1);
    expect(audits[0][1]).toMatchObject({ action: "campaign.restored", actorId: uid, restoredFromVersion: 1, previousVersion: 2, targetId: "3" });
  });

  it("requires explicit confirmation and refuses client-supplied asset replacements", async () => {
    const db = database();
    const approvedInput = await input(db);
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, { ...approvedInput, confirmed: false } as unknown as RestoreCampaignInput)).rejects.toThrow("Confirm");
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, { ...approvedInput, assets: [] } as RestoreCampaignInput)).rejects.toThrow("Confirm");
    expect(db.read(campaignPath).version).toBe(2);
  });

  it("requires current approvals and rejects an old claim ID absent from the current evidence", async () => {
    const db = database();
    const project = db.read(projectPath);
    db.seed(projectPath, { ...project, claims: project.claims.map((claim: object) => ({ ...claim, approved: false })) });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow("Approve the current");
    db.seed(projectPath, { ...project, claims: project.claims.map((claim: object) => ({ ...claim, id: "new-claim" })) });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow("no longer approved");
    expect(db.rows.has(versionPath(3))).toBe(false);
  });

  it.each(["missing", "not-current", "changed-hash", "missing-reference"])("rejects unavailable current evidence: %s", async (scenario) => {
    const db = database();
    const project = db.read(projectPath);
    if (scenario === "missing") db.rows.delete(`${projectPath}/evidence/source-1`);
    if (scenario === "not-current") db.seed(projectPath, { ...project, sources: [] });
    if (scenario === "changed-hash") db.seed(`${projectPath}/evidence/source-1`, { ...db.read(`${projectPath}/evidence/source-1`), contentHash: "tampered" });
    if (scenario === "missing-reference") db.seed(projectPath, { ...project, claims: project.claims.map((claim: object) => ({ ...claim, evidenceIds: [] })) });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow(/evidence/);
    expect(db.read(campaignPath).version).toBe(2);
  });

  it.each(["awaiting_payment", "paid", "submitted", "published", "refunded", "canceled"])("rejects restoration once any fulfillment order exists: %s", async (status) => {
    const db = database();
    db.seed(`${projectPath}/orders/current`, { status });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow("fulfillment order");
  });

  it.each(["queued", "scheduled", "running"])("respects an active project intelligence lock: %s", async (status) => {
    const db = database();
    db.seed(`${workspacePath}/intelligenceRequests/${projectId}`, { jobId: "job-1" });
    db.seed(`${workspacePath}/intelligenceJobs/job-1`, { status });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).rejects.toThrow("current project job");
  });

  it("can restore after background work finishes", async () => {
    const db = database();
    db.seed(`${workspacePath}/intelligenceRequests/${projectId}`, { jobId: "job-1" });
    db.seed(`${workspacePath}/intelligenceJobs/job-1`, { status: "completed" });
    expect((await restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db))).version).toBe(3);
  });

  it.each(["version", "content", "evidence"])("invalidates stale preview when %s changes", async (field) => {
    const db = database();
    const confirmed = await input(db);
    if (field === "version") db.seed(campaignPath, campaign(3));
    if (field === "content") db.seed(campaignPath, { ...campaign(2), assets: campaign(2).assets.map((asset) => ({ ...asset, content: "An edit in another tab" })) });
    if (field === "evidence") db.seed(projectPath, { ...db.read(projectPath), claims: db.read(projectPath).claims.map((claim: object) => ({ ...claim, text: "Changed claim" })) });
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed)).rejects.toThrow("changed since this preview");
  });

  it("allows only one competing restore and never overwrites an existing version", async () => {
    const db = database();
    const confirmed = await input(db);
    const results = await Promise.allSettled([restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed), restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.read(campaignPath).version).toBe(3);
    const second = database();
    second.seed(versionPath(3), { immutable: "keep" });
    await expect(restoreCampaignVersion(second.asFirestore(), uid, projectId, await input(second))).rejects.toThrow("newer saved version");
    expect(second.read(versionPath(3))).toEqual({ immutable: "keep" });
  });

  it("keeps restoration atomic if the transaction fails", async () => {
    const db = database();
    const confirmed = await input(db);
    const oldApproval = db.read(approvalPath);
    db.beforeCommit = (writes) => { if (writes.length) throw new Error("Simulated outage"); };
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed)).rejects.toThrow("Simulated outage");
    expect(db.read(campaignPath)).toEqual(campaign(2));
    expect(db.read(approvalPath)).toEqual(oldApproval);
    expect(db.rows.has(versionPath(3))).toBe(false);
  });

  it("prevents stale approved checkout after restore wins a concurrent transaction", async () => {
    const db = database();
    const confirmed = await input(db);
    const results = await Promise.allSettled([
      restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed),
      prepareFulfillment(db.asFirestore(), uid, projectId, campaign(2), quote, details, "launch"),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(db.rows.has(`${projectPath}/orders/current`)).toBe(false);
  });

  it("rejects restore if checkout wins the transaction race", async () => {
    const db = database();
    const confirmed = await input(db);
    const results = await Promise.allSettled([
      prepareFulfillment(db.asFirestore(), uid, projectId, campaign(2), quote, details, "launch"),
      restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(db.read(campaignPath).version).toBe(2);
  });

  it("checks the generation request lock when enqueue wins a concurrent transaction", async () => {
    const db = database();
    const confirmed = await input(db);
    const results = await Promise.allSettled([
      enqueueIntelligenceJob(db.asFirestore(), uid, { type: "campaign_generation", projectId }),
      restoreCampaignVersion(db.asFirestore(), uid, projectId, confirmed),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(db.read(campaignPath).version).toBe(2);
  });

  it("retains history after reanalysis clears the current assets", async () => {
    const db = database();
    db.seed(campaignPath, { version: 2, status: "evidence_review", approvedClaimIds: [] });
    expect((await listCampaignVersions(db.asFirestore(), uid, projectId)).versions).toHaveLength(2);
    const restored = await restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db));
    expect(restored.version).toBe(3);
  });

  it("rejects invalid identifiers, malformed snapshots and restoration of the current version", async () => {
    const db = database();
    await expect(listCampaignVersions(db.asFirestore(), uid, "../other")).rejects.toThrow("Invalid");
    await expect(readCampaignVersion(db.asFirestore(), uid, projectId, -1)).rejects.toThrow("Invalid");
    await expect(restoreCampaignVersion(db.asFirestore(), uid, projectId, await input(db, 2))).rejects.toThrow("earlier version");
    db.seed(versionPath(1), { ...campaign(1), assets: campaign(1).assets.map((asset) => ({ ...asset, type: "press_release" })) });
    await expect(readCampaignVersion(db.asFirestore(), uid, projectId, 1)).rejects.toThrow("safely");
  });

  it("routes history through authenticated, origin-checked, rate-limited server access", () => {
    const route = readFileSync(new URL("../app/api/projects/[projectId]/campaign/versions/route.ts", import.meta.url), "utf8");
    expect(route.match(/getAuthenticatedFirebaseContext\(\)/g)).toHaveLength(2);
    expect(route.match(/assertSameOrigin\(request\)/g)).toHaveLength(2);
    expect(route).toContain('"campaign-history-restore", 10, 3_600');
    expect(route).toContain('"campaign-history-read", 120, 60');
    expect(route).toContain('"cache-control": "no-store"');
    expect(route).toContain('confirmed: z.literal(true)');
    expect(route).toContain("Campaign history is temporarily unavailable. Please try again.");
    expect(route).not.toContain("console.error");
  });
});
