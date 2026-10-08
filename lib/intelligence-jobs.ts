import { createHash, randomUUID } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { analyzeCompany } from "./analyze";
import { generateCampaignAssets } from "./campaign";
import { parsePublicHttpUrl } from "./url-security";
import type { AnalysisResult, BrandProfile, CampaignDraft, Claim } from "./types";

export type IntelligenceJobStatus = {
  id: string;
  projectId: string;
  type: "analysis" | "campaign_generation";
  status: "queued" | "scheduled" | "running" | "completed" | "failed" | "superseded";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  message?: string;
};

type IntelligenceJob = IntelligenceJobStatus & {
  userId: string;
  workspaceId: string;
  projectDigest: string;
  campaignDigest: string;
  runToken?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
};

type ProjectData = { workspaceId: string; createdBy: string; url: string; profile: BrandProfile; claims: Claim[]; updatedAtIso?: string };
type WorkerDependencies = {
  analyze?: typeof analyzeCompany;
  generate?: typeof generateCampaignAssets;
  now?: () => number;
  limit?: number;
};
const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;
const activeStatuses = new Set(["queued", "scheduled", "running"]);

// Canonical JSON ignores object key ordering, but includes all stored evidence,
// timestamps and campaign content so an edit/approval invalidates an old result.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value ?? null))).digest("hex"); }
function serializable<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function refs(db: Firestore, userId: string, projectId: string) {
  const workspaceId = `personal_${userId}`;
  const workspace = db.doc(`workspaces/${workspaceId}`);
  const project = workspace.collection("projects").doc(projectId);
  return { workspaceId, workspace, member: workspace.collection("members").doc(userId), project, campaign: project.collection("campaigns").doc("current"), order: project.collection("orders").doc("current") };
}
function assertMember(member: Record<string, unknown> | undefined, userId: string) {
  if (member?.userId !== userId || !["owner", "admin", "member"].includes(String(member.role))) throw new Error("Workspace access denied.");
}
function assertProjectOwner(project: ProjectData | undefined, userId: string, workspaceId: string) {
  if (project && (project.createdBy !== userId || project.workspaceId !== workspaceId)) throw new Error("Project access denied.");
}
function assertApproved(project: ProjectData) {
  if (!project.claims?.length || project.claims.some((claim) => !claim.approved)) throw new Error("Every evidence claim must be approved before campaign generation.");
}
export function publicIntelligenceJob(job: IntelligenceJob): IntelligenceJobStatus {
  const { id, projectId, type, status, attempts, createdAt, updatedAt, url, message } = job;
  return { id, projectId, type, status, attempts, createdAt, updatedAt, url, ...(message ? { message } : {}) };
}

export async function enqueueIntelligenceJob(db: Firestore, userId: string, input: { type: "analysis"; url: string } | { type: "campaign_generation"; projectId: string }, now = Date.now()): Promise<IntelligenceJobStatus> {
  const url = input.type === "analysis" ? parsePublicHttpUrl(input.url).href : "";
  const projectId = input.type === "analysis" ? createHash("sha256").update(`${userId}:${url}`).digest("hex").slice(0, 24) : input.projectId;
  if (!/^[a-f0-9]{24}$/.test(projectId)) throw new Error("Invalid project identifier.");
  const target = refs(db, userId, projectId);
  // One in-flight operation of either type per project. A retry returns the same
  // job; finished attempts retain history instead of overwriting the job record.
  const lock = target.workspace.collection("intelligenceRequests").doc(projectId);
  return db.runTransaction(async (transaction) => {
    const [member, projectSnapshot, campaignSnapshot, order, lockSnapshot] = await Promise.all([transaction.get(target.member), transaction.get(target.project), transaction.get(target.campaign), transaction.get(target.order), transaction.get(lock)]);
    assertMember(member.data(), userId);
    const project = projectSnapshot.data() as ProjectData | undefined;
    assertProjectOwner(project, userId, target.workspaceId);
    if (order.exists) throw new Error("This project already has a fulfillment order. Create a new project for a new campaign.");
    const activeId = lockSnapshot.data()?.jobId;
    const active = typeof activeId === "string" ? (await transaction.get(target.workspace.collection("intelligenceJobs").doc(activeId))).data() as IntelligenceJob | undefined : undefined;
    if (active && activeStatuses.has(active.status)) {
      if (active.type !== input.type) throw new Error("Wait for the current project job to finish before starting another operation.");
      return publicIntelligenceJob(active);
    }
    if (input.type === "campaign_generation") {
      if (!project) throw new Error("Project not found.");
      assertApproved(project);
    }
    const timestamp = new Date(now).toISOString();
    const job: IntelligenceJob = {
      id: randomUUID(), userId, workspaceId: target.workspaceId, projectId,
      type: input.type, status: "queued", attempts: 0, createdAt: timestamp, updatedAt: timestamp,
      url: input.type === "analysis" ? url : project!.url,
      projectDigest: digest(projectSnapshot.data()), campaignDigest: digest(campaignSnapshot.data()),
    };
    transaction.create(target.workspace.collection("intelligenceJobs").doc(job.id), job);
    transaction.set(lock, { jobId: job.id });
    return publicIntelligenceJob(job);
  });
}

export async function listIntelligenceJobs(db: Firestore, userId: string, jobId?: string): Promise<IntelligenceJobStatus[]> {
  const target = refs(db, userId, "unused");
  assertMember((await target.member.get()).data(), userId);
  const collection = target.workspace.collection("intelligenceJobs");
  const documents = jobId ? [await collection.doc(jobId).get()] : (await collection.orderBy("createdAt", "desc").limit(50).get()).docs;
  return documents.filter((document) => document.exists).map((document) => document.data() as IntelligenceJob).filter((job) => job.userId === userId && job.workspaceId === target.workspaceId).map(publicIntelligenceJob);
}

async function readCurrent(transaction: Transaction, db: Firestore, job: IntelligenceJob) {
  const target = refs(db, job.userId, job.projectId);
  if (target.workspaceId !== job.workspaceId) throw new Error("Job workspace does not match its owner.");
  const [member, project, campaign, order] = await Promise.all([transaction.get(target.member), transaction.get(target.project), transaction.get(target.campaign), transaction.get(target.order)]);
  assertMember(member.data(), job.userId);
  assertProjectOwner(project.data() as ProjectData | undefined, job.userId, target.workspaceId);
  return { target, project, campaign, unchanged: !order.exists && digest(project.data()) === job.projectDigest && digest(campaign.data()) === job.campaignDigest };
}

async function claim(db: Firestore, ref: DocumentReference, now: number): Promise<{ job: IntelligenceJob; project?: ProjectData } | null> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const job = snapshot.data() as IntelligenceJob | undefined;
    if (!job || job.status !== "queued") return null;
    const current = await readCurrent(transaction, db, job);
    if (!current.unchanged) {
      transaction.update(ref, { status: "superseded", message: "The project changed while this job was waiting. Review your latest work and run it again.", updatedAt: new Date(now).toISOString() });
      return null;
    }
    const claimed: IntelligenceJob = { ...job, status: "running", attempts: job.attempts + 1, runToken: randomUUID(), leaseExpiresAt: new Date(now + LEASE_MS).toISOString(), updatedAt: new Date(now).toISOString() };
    transaction.update(ref, claimed);
    return { job: claimed, project: current.project.data() as ProjectData | undefined };
  });
}

async function commitResult(db: Firestore, ref: DocumentReference, job: IntelligenceJob, output: AnalysisResult | Awaited<ReturnType<typeof generateCampaignAssets>>, now: number) {
  await db.runTransaction(async (transaction) => {
    const stored = (await transaction.get(ref)).data() as IntelligenceJob;
    if (stored?.status !== "running" || stored.runToken !== job.runToken) return;
    const current = await readCurrent(transaction, db, job);
    const timestamp = new Date(now).toISOString();
    if (!current.unchanged) {
      transaction.update(ref, { status: "superseded", message: "Your project or campaign changed during this job. The old result was not applied.", updatedAt: timestamp });
      return;
    }
    if (job.type === "analysis") {
      const result = output as AnalysisResult;
      const sources = result.sources ?? [];
      const claims = result.profile.claims.map((item) => ({ ...item, approved: false }));
      const profile = { ...result.profile, sourceUrl: job.url, claims };
      const evidenceRefs = sources.map((source) => current.target.project.collection("evidence").doc(source.id));
      const evidence = await Promise.all(evidenceRefs.map((evidenceRef) => transaction.get(evidenceRef)));
      for (let index = 0; index < sources.length; index++) {
        if (evidence[index].exists && digest(evidence[index].data()) !== digest(sources[index])) throw new Error("An immutable evidence snapshot already exists with different content.");
      }
      const project = {
        workspaceId: job.workspaceId, createdBy: job.userId, name: result.profile.company,
        url: job.url, profile, readiness: result.readiness,
        sources, claims, campaignStatus: "evidence_review", lifecycleStatus: "evidence_review",
        fetchedAt: result.fetchedAt, updatedAtIso: timestamp,
      };
      transaction.set(current.target.project, { ...serializable(project), updatedAt: FieldValue.serverTimestamp(), ...(current.project.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      transaction.set(current.target.project.collection("profiles").doc("current"), { ...serializable(profile), updatedAt: FieldValue.serverTimestamp() });
      sources.forEach((source, index) => { if (!evidence[index].exists) transaction.create(evidenceRefs[index], serializable(source)); });
      claims.forEach((item) => transaction.set(current.target.project.collection("claims").doc(item.id), serializable(item)));
      transaction.set(current.target.campaign, { status: "evidence_review", version: current.campaign.data()?.version ?? 0, approvedClaimIds: [], assetVersion: 0, updatedAt: FieldValue.serverTimestamp() });
    } else {
      const project = current.project.data() as ProjectData;
      assertApproved(project);
      const generated = output as Awaited<ReturnType<typeof generateCampaignAssets>>;
      const allowed = new Set(project.claims.map((item) => item.id));
      if (generated.assets.length !== 8 || generated.assets.some((asset) => !asset.claimIds.length || asset.claimIds.some((id) => !allowed.has(id)))) throw new Error("Generated assets referenced unapproved evidence.");
      const prior = current.campaign.data() as Partial<CampaignDraft> | undefined;
      const draft: CampaignDraft = { version: (prior?.version ?? 0) + 1, status: "draft", model: generated.model, assets: generated.assets.map((asset) => ({ ...asset, status: "draft" })), generatedAt: timestamp, updatedAt: timestamp };
      const versionRef = current.target.campaign.collection("versions").doc(String(draft.version).padStart(6, "0"));
      if ((await transaction.get(versionRef)).exists) throw new Error("Campaign version already exists. Reload the project before regenerating.");
      transaction.set(current.target.campaign, { ...serializable(draft), updatedAtServer: FieldValue.serverTimestamp() });
      transaction.create(versionRef, { ...serializable(draft), createdAt: FieldValue.serverTimestamp() });
      transaction.update(current.target.project, { campaignStatus: "draft_ready", lifecycleStatus: "draft_ready", generatedAt: timestamp, updatedAtIso: timestamp, updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.update(ref, { status: "completed", updatedAt: timestamp, message: "Your results are saved. Open the project to continue." });
  });
}

async function failJob(db: Firestore, ref: DocumentReference, token: string | undefined, now: number) {
  await db.runTransaction(async (transaction) => {
    const job = (await transaction.get(ref)).data() as IntelligenceJob | undefined;
    if (!job || job.status !== "running" || job.runToken !== token) return;
    const failed = job.attempts >= MAX_ATTEMPTS;
    transaction.update(ref, { status: failed ? "failed" : "scheduled", updatedAt: new Date(now).toISOString(), nextAttemptAt: new Date(now + 30_000 * job.attempts).toISOString(), message: failed ? "This job could not finish after three attempts. Your existing work is safe; try again or contact support." : "A temporary error interrupted the job. A retry is scheduled; your existing work is safe." });
  });
}

export async function runQueuedIntelligenceJobs(db: Firestore, dependencies: WorkerDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const [running, scheduled] = await Promise.all([db.collectionGroup("intelligenceJobs").where("status", "==", "running").limit(100).get(), db.collectionGroup("intelligenceJobs").where("status", "==", "scheduled").limit(100).get()]);
  let intelligenceRecovered = 0;
  for (const snapshot of [...running.docs, ...scheduled.docs]) {
    const recovered = await db.runTransaction(async (transaction) => {
      const job = (await transaction.get(snapshot.ref)).data() as IntelligenceJob;
      const time = now();
      const expired = job.status === "running" && (!job.leaseExpiresAt || !(Date.parse(job.leaseExpiresAt) > time));
      const due = job.status === "scheduled" && (!job.nextAttemptAt || !(Date.parse(job.nextAttemptAt) > time));
      if (!expired && !due) return false;
      const failed = job.attempts >= MAX_ATTEMPTS;
      transaction.update(snapshot.ref, { status: failed ? "failed" : "queued", updatedAt: new Date(time).toISOString(), message: failed ? "This job stopped after three interrupted attempts. Your existing work is safe; try again or contact support." : "Resuming saved background work." });
      return true;
    });
    if (recovered) intelligenceRecovered++;
  }
  const queued = await db.collectionGroup("intelligenceJobs").where("status", "==", "queued").limit(Math.min(Math.max(dependencies.limit ?? 2, 1), 4)).get();
  let intelligenceProcessed = 0;
  await Promise.all(queued.docs.map(async (snapshot) => {
    let claimed: Awaited<ReturnType<typeof claim>> = null;
    try {
      claimed = await claim(db, snapshot.ref, now());
      if (!claimed) return;
      intelligenceProcessed++;
      const { job, project } = claimed;
      const output = job.type === "analysis" ? await (dependencies.analyze ?? analyzeCompany)(job.url) : await (dependencies.generate ?? generateCampaignAssets)(project!.profile, project!.claims, job.userId);
      await commitResult(db, snapshot.ref, job, output, now());
    } catch {
      if (claimed) await failJob(db, snapshot.ref, claimed.job.runToken, now());
      else {
        // Revoked membership/missing project must not occupy a queue slot forever.
        await db.runTransaction(async (transaction) => {
          const job = (await transaction.get(snapshot.ref)).data() as IntelligenceJob | undefined;
          if (job?.status === "queued") transaction.update(snapshot.ref, { status: "failed", message: "Workspace access or project state changed. Reload your workspace before trying again.", updatedAt: new Date(now()).toISOString() });
        });
      }
    }
  }));
  return { intelligenceProcessed, intelligenceRecovered };
}
