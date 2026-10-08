import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enqueueIntelligenceJob, listIntelligenceJobs, runQueuedIntelligenceJobs } from "../lib/intelligence-jobs";
import { MemoryFirestore } from "./helpers/memory-firestore";
import type { AnalysisResult, CampaignAssetType, GeneratedCampaignAsset } from "../lib/types";

const initialTime = Date.parse("2026-09-11T12:00:00.000Z");
const companyUrl = "https://example.com/";
const userId = "alice";
const projectId = createHash("sha256").update(`${userId}:${companyUrl}`).digest("hex").slice(0, 24);
const workspacePath = `workspaces/personal_${userId}`;
const projectPath = `${workspacePath}/projects/${projectId}`;
const campaignPath = `${projectPath}/campaigns/current`;
const assetTypes: CampaignAssetType[] = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"];

function result(company = "Example"): AnalysisResult {
  const claim = { id: "claim-1", text: `${company} makes software.`, sourceUrl: companyUrl, state: "VERIFIED" as const, approved: true, evidenceIds: ["source-1"], observedAt: new Date(initialTime).toISOString() };
  return {
    profile: { company, product: "Software", audience: "Teams", positioning: "Productivity", sourceUrl: companyUrl, claims: [claim], findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] } },
    readiness: { score: 55, label: "Review required", rationale: [], missingInformation: [], strongestStoryAngle: "A new product" },
    sources: [{ id: "source-1", url: companyUrl, title: company, description: "Software", excerpt: "Software", contentHash: "abc", capturedAt: new Date(initialTime).toISOString() }],
    fetchedAt: new Date(initialTime).toISOString(),
  };
}
function generated(title = "Example campaign") {
  return { model: "test-model", assets: assetTypes.map((type, index): GeneratedCampaignAsset => ({ id: `asset-${index}`, type, title, content: "Approved company facts.", claimIds: ["claim-1"], status: "draft" })) };
}
function database(existingProject = false) {
  const db = new MemoryFirestore();
  for (const uid of ["alice", "bob"]) db.seed(`workspaces/personal_${uid}/members/${uid}`, { userId: uid, role: "owner" });
  if (existingProject) {
    const analysis = result();
    db.seed(projectPath, { ...analysis, workspaceId: "personal_alice", createdBy: "alice", name: analysis.profile.company, url: companyUrl, claims: analysis.profile.claims, campaignStatus: "approved", updatedAtIso: new Date(initialTime).toISOString() });
    db.seed(campaignPath, { status: "approved", version: 1, ...generated(), generatedAt: new Date(initialTime).toISOString(), updatedAt: new Date(initialTime).toISOString() });
    db.seed(`${campaignPath}/versions/000001`, { version: 1, preserved: true });
  }
  return db;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const jobPath = (id: string) => `${workspacePath}/intelligenceJobs/${id}`;

describe("durable intelligence jobs", () => {
  it("deduplicates concurrent enqueue and isolates each user's URL workspace", async () => {
    const db = database();
    const enqueue = () => enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    const [first, second] = await Promise.all([enqueue(), enqueue()]);
    const bob = await enqueueIntelligenceJob(db.asFirestore(), "bob", { type: "analysis", url: companyUrl }, initialTime);
    expect(second.id).toBe(first.id);
    expect(bob.projectId).not.toBe(first.projectId);
    expect(db.rows.has(projectPath)).toBe(false);
    expect(await listIntelligenceJobs(db.asFirestore(), "bob", first.id)).toEqual([]);
    expect((await listIntelligenceJobs(db.asFirestore(), userId)).map((job) => job.id)).toEqual([first.id]);
    expect(JSON.stringify(first)).not.toContain("projectDigest");
  });

  it("requires writable membership and refuses cross-user project ownership", async () => {
    const db = database(true);
    db.seed(`${workspacePath}/members/alice`, { userId: userId, role: "viewer" });
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId })).rejects.toThrow("access denied");
    db.seed(`${workspacePath}/members/alice`, { userId: userId, role: "owner" });
    db.seed(projectPath, { ...db.read(projectPath), createdBy: "bob" });
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId })).rejects.toThrow("Project access denied");
    await expect(enqueueIntelligenceJob(db.asFirestore(), "bob", { type: "campaign_generation", projectId })).rejects.toThrow("Project not found");
  });

  it("saves analysis, evidence and job completion in one transaction and can resume by listing jobs", async () => {
    const db = database();
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    const analyze = vi.fn(async () => result());
    expect(await runQueuedIntelligenceJobs(db.asFirestore(), { analyze, now: () => initialTime })).toEqual({ intelligenceProcessed: 1, intelligenceRecovered: 0 });
    expect(analyze).toHaveBeenCalledWith(companyUrl);
    expect(db.read(projectPath).profile.company).toBe("Example");
    expect(db.read(`${projectPath}/evidence/source-1`).contentHash).toBe("abc");
    expect(db.read(campaignPath).status).toBe("evidence_review");
    expect(db.read(projectPath).claims[0].approved).toBe(false);
    expect((await listIntelligenceJobs(db.asFirestore(), userId, job.id))[0].status).toBe("completed");
  });

  it("generates a new immutable draft version without carrying approval forward", async () => {
    const db = database(true);
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime);
    const generate = vi.fn(async () => generated());
    await runQueuedIntelligenceJobs(db.asFirestore(), { generate, now: () => initialTime });
    expect(generate).toHaveBeenCalledWith(result().profile, result().profile.claims, userId);
    expect(db.read(campaignPath)).toMatchObject({ version: 2, status: "draft" });
    expect(db.read(`${campaignPath}/versions/000001`)).toEqual({ version: 1, preserved: true });
    expect(db.read(`${campaignPath}/versions/000002`).assets).toHaveLength(8);
    expect(db.read(jobPath(job.id)).status).toBe("completed");
  });

  it("only lets one concurrent worker claim a queued job", async () => {
    const db = database();
    await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    const analyze = vi.fn(async () => result());
    await Promise.all([runQueuedIntelligenceJobs(db.asFirestore(), { analyze, now: () => initialTime }), runQueuedIntelligenceJobs(db.asFirestore(), { analyze, now: () => initialTime })]);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("preserves campaign version numbering through a new analysis and requires fresh evidence approval", async () => {
    const db = database(true);
    const first = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    await runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => result(), now: () => initialTime });
    expect(db.read(campaignPath)).toMatchObject({ version: 1, status: "evidence_review" });
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId })).rejects.toThrow("approved");
    db.seed(projectPath, { ...db.read(projectPath), claims: result().profile.claims, profile: result().profile });
    const second = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime + 10_000);
    expect(second.id).not.toBe(first.id);
    await runQueuedIntelligenceJobs(db.asFirestore(), { generate: async () => generated(), now: () => initialTime + 10_000 });
    expect(db.read(campaignPath).version).toBe(2);
    expect(db.read(`${campaignPath}/versions/000001`)).toEqual({ version: 1, preserved: true });
  });

  it("does not partially save output when the persistence transaction fails", async () => {
    const db = database();
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    db.beforeCommit = (writes) => {
      if (writes.some((write) => write.ref.path === projectPath)) throw new Error("Simulated transaction outage");
    };
    await runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => result(), now: () => initialTime });
    expect(db.rows.has(projectPath)).toBe(false);
    expect(db.rows.has(`${projectPath}/evidence/source-1`)).toBe(false);
    expect(db.read(jobPath(job.id)).status).toBe("scheduled");
    db.beforeCommit = undefined;
    await runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => result(), now: () => initialTime + 60_000 });
    expect(db.read(projectPath).profile.company).toBe("Example");
    expect(db.read(jobPath(job.id)).status).toBe("completed");
  });

  it("bounds retries, preserves prior work, and redacts provider errors from status", async () => {
    const db = database(true);
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime);
    const generate = vi.fn(async () => { throw new Error("Bearer secret_do_not_expose"); });
    let time = initialTime;
    for (let attempt = 0; attempt < 4; attempt++) {
      await runQueuedIntelligenceJobs(db.asFirestore(), { generate, now: () => time });
      time += 120_000;
    }
    expect(generate).toHaveBeenCalledTimes(3);
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "failed", attempts: 3 });
    expect(db.read(campaignPath).version).toBe(1);
    expect(JSON.stringify(await listIntelligenceJobs(db.asFirestore(), userId))).not.toContain("secret_do_not_expose");
  });

  it("recovers an expired lease and fences off the late original worker's result", async () => {
    const db = database();
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    const gate = deferred<AnalysisResult>();
    const started = deferred<void>();
    const original = runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => { started.resolve(); return gate.promise; }, now: () => initialTime });
    await started.promise;
    const resumed = await runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => result("Recovered result"), now: () => initialTime + 6 * 60_000 });
    expect(resumed.intelligenceRecovered).toBe(1);
    gate.resolve(result("Stale worker"));
    await original;
    expect(db.read(projectPath).profile.company).toBe("Recovered result");
    expect(db.read(jobPath(job.id))).toMatchObject({ status: "completed", attempts: 2 });
  });

  it("discards generated output when evidence is edited while the model is running", async () => {
    const db = database(true);
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime);
    const gate = deferred<ReturnType<typeof generated>>();
    const started = deferred<void>();
    const running = runQueuedIntelligenceJobs(db.asFirestore(), { generate: async () => { started.resolve(); return gate.promise; }, now: () => initialTime });
    await started.promise;
    db.seed(projectPath, { ...db.read(projectPath), profile: { ...result().profile, company: "Customer edit" } });
    gate.resolve(generated()); await running;
    expect(db.read(projectPath).profile.company).toBe("Customer edit");
    expect(db.read(campaignPath).version).toBe(1);
    expect(db.read(jobPath(job.id)).status).toBe("superseded");
    expect(db.rows.has(`${campaignPath}/versions/000002`)).toBe(false);
  });

  it("discards work before calling the model when the campaign was revised in the queue", async () => {
    const db = database(true);
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime);
    db.seed(campaignPath, { ...db.read(campaignPath), version: 2 });
    const generate = vi.fn(async () => generated());
    await runQueuedIntelligenceJobs(db.asFirestore(), { generate, now: () => initialTime });
    expect(generate).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id)).status).toBe("superseded");
  });

  it("does not overwrite an immutable evidence snapshot or advance a failed commit", async () => {
    const db = database();
    db.seed(`${projectPath}/evidence/source-1`, { ...result().sources![0], contentHash: "original" });
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    await runQueuedIntelligenceJobs(db.asFirestore(), { analyze: async () => result(), now: () => initialTime });
    expect(db.read(`${projectPath}/evidence/source-1`).contentHash).toBe("original");
    expect(db.rows.has(projectPath)).toBe(false);
    expect(db.read(jobPath(job.id)).status).toBe("scheduled");
  });

  it("never starts new intelligence work after a fulfillment order is prepared", async () => {
    const db = database(true);
    db.seed(`${projectPath}/orders/current`, { status: "awaiting_payment" });
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId })).rejects.toThrow("fulfillment order");
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl })).rejects.toThrow("fulfillment order");
  });

  it("rejects enqueue replay for an existing job once an order appears", async () => {
    const db = database(true);
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId }, initialTime);
    db.seed(`${projectPath}/orders/current`, { status: "refunded" });
    await expect(enqueueIntelligenceJob(db.asFirestore(), userId, { type: "campaign_generation", projectId })).rejects.toThrow("fulfillment order");
    const generate = vi.fn(async () => generated());
    await runQueuedIntelligenceJobs(db.asFirestore(), { generate, now: () => initialTime });
    expect(generate).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id)).status).toBe("superseded");
    expect(db.read(campaignPath).version).toBe(1);
  });

  it("checks membership again before executing persisted work", async () => {
    const db = database();
    const job = await enqueueIntelligenceJob(db.asFirestore(), userId, { type: "analysis", url: companyUrl }, initialTime);
    db.rows.delete(`${workspacePath}/members/alice`);
    const analyze = vi.fn(async () => result());
    await runQueuedIntelligenceJobs(db.asFirestore(), { analyze, now: () => initialTime });
    expect(analyze).not.toHaveBeenCalled();
    expect(db.read(jobPath(job.id)).status).toBe("failed");
  });
});
