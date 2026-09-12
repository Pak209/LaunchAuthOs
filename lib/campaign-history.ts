import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import type { CampaignDraft, Claim, EvidenceSnapshot } from "./types";

const PAGE_SIZE = 25;
const MAX_VERSION = 999_999;
const versionSchema = z.number().int().min(1).max(MAX_VERSION);
const assetTypes = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"] as const;
const campaignSchema = z.object({
  version: versionSchema,
  status: z.enum(["draft", "approved"]),
  model: z.string().min(1).max(200),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assets: z.array(z.object({
    id: z.string().min(1).max(160),
    type: z.enum(assetTypes),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(30_000),
    claimIds: z.array(z.string().min(1).max(160)).min(1).max(100),
    status: z.enum(["draft", "approved"]),
  })).length(assetTypes.length),
}).refine((campaign) => new Set(campaign.assets.map((asset) => asset.type)).size === assetTypes.length
  && new Set(campaign.assets.map((asset) => asset.id)).size === assetTypes.length);

export type CampaignVersionSummary = Pick<CampaignDraft, "version" | "status" | "model" | "generatedAt" | "updatedAt"> & { assetCount: number; restoredFromVersion?: number };
export type CampaignHistoryPage = {
  versions: CampaignVersionSummary[];
  currentVersion: number;
  currentDigest: string;
  nextBeforeVersion: number | null;
};
export type CampaignVersionPreview = { campaign: CampaignDraft; currentVersion: number; currentDigest: string };

export class CampaignHistoryError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) { super(message); }
}

function references(db: Firestore, uid: string, projectId: string) {
  if (!/^[^/\u0000-\u001f]{1,128}$/.test(uid) || !/^[a-f0-9]{24}$/.test(projectId)) throw new CampaignHistoryError("Invalid project identifier.", 400);
  const workspaceId = `personal_${uid}`;
  const workspace = db.doc(`workspaces/${workspaceId}`);
  const project = workspace.collection("projects").doc(projectId);
  return {
    workspaceId, workspace, project,
    member: workspace.collection("members").doc(uid),
    campaign: project.collection("campaigns").doc("current"),
    order: project.collection("orders").doc("current"),
    lock: workspace.collection("intelligenceRequests").doc(projectId),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

// Both evidence edits and same-version campaign edits invalidate a displayed
// restore confirmation. No client-supplied asset content is accepted.
function guardDigest(project: unknown, campaign: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical({ project, campaign }))).digest("hex");
}

async function readAccess(transaction: Transaction, target: ReturnType<typeof references>, uid: string, writable = false) {
  const [memberSnapshot, projectSnapshot, campaignSnapshot] = await Promise.all([
    transaction.get(target.member), transaction.get(target.project), transaction.get(target.campaign),
  ]);
  const member = memberSnapshot.data();
  const roles = writable ? ["owner", "admin", "member"] : ["owner", "admin", "member", "viewer"];
  if (member?.userId !== uid || !roles.includes(String(member.role))) throw new CampaignHistoryError("Workspace access denied.", 403);
  const project = projectSnapshot.data();
  if (!project || project.createdBy !== uid || project.workspaceId !== target.workspaceId) throw new CampaignHistoryError("Project not found.", 404);
  const campaign = campaignSnapshot.data();
  const currentVersion = campaign?.version ?? 0;
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0 || currentVersion > MAX_VERSION) throw new CampaignHistoryError("Campaign history is unavailable. Reload the project or contact support.", 409);
  return { project, campaign, currentVersion: currentVersion as number, currentDigest: guardDigest(project, campaign) };
}

function versionReference(target: ReturnType<typeof references>, version: number) {
  return target.campaign.collection("versions").doc(String(version).padStart(6, "0"));
}

function parseVersion(data: unknown, version: number): CampaignDraft {
  const parsed = campaignSchema.safeParse(data);
  if (!parsed.success || parsed.data.version !== version) throw new CampaignHistoryError("This saved version cannot be restored safely. Choose another version.", 409);
  return parsed.data;
}

export async function listCampaignVersions(db: Firestore, uid: string, projectId: string, beforeVersion?: number): Promise<CampaignHistoryPage> {
  if (beforeVersion !== undefined && !versionSchema.safeParse(beforeVersion).success) throw new CampaignHistoryError("Invalid history cursor.", 400);
  const target = references(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    const current = await readAccess(transaction, target, uid);
    const first = Math.min(current.currentVersion, beforeVersion === undefined ? current.currentVersion : beforeVersion - 1);
    const last = Math.max(1, first - PAGE_SIZE + 1);
    // Deterministic version IDs permit a bounded page without an extra index.
    // Missing legacy entries do not cause unbounded scans.
    const numbers = Array.from({ length: Math.max(0, first - last + 1) }, (_, index) => first - index);
    const snapshots = await Promise.all(numbers.map((version) => transaction.get(versionReference(target, version))));
    const versions = snapshots.flatMap((snapshot, index): CampaignVersionSummary[] => {
      const parsed = campaignSchema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.version !== numbers[index]) return [];
      const { version, status, model, generatedAt, updatedAt, assets } = parsed.data;
      const restoredFromVersion = snapshot.data()?.restoredFromVersion;
      return [{ version, status, model, generatedAt, updatedAt, assetCount: assets.length,
        ...(versionSchema.safeParse(restoredFromVersion).success ? { restoredFromVersion: restoredFromVersion as number } : {}),
      }];
    });
    return { versions, currentVersion: current.currentVersion, currentDigest: current.currentDigest, nextBeforeVersion: last > 1 ? last : null };
  });
}

export async function readCampaignVersion(db: Firestore, uid: string, projectId: string, version: number): Promise<CampaignVersionPreview> {
  if (!versionSchema.safeParse(version).success) throw new CampaignHistoryError("Invalid campaign version.", 400);
  const target = references(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    const current = await readAccess(transaction, target, uid);
    const snapshot = await transaction.get(versionReference(target, version));
    if (!snapshot.exists || version > current.currentVersion) throw new CampaignHistoryError("Campaign version not found.", 404);
    return { campaign: parseVersion(snapshot.data(), version), currentVersion: current.currentVersion, currentDigest: current.currentDigest };
  });
}

const restoreSchema = z.object({
  version: versionSchema,
  expectedVersion: z.number().int().min(0).max(MAX_VERSION),
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
}).strict();
export type RestoreCampaignInput = z.infer<typeof restoreSchema>;

export async function restoreCampaignVersion(db: Firestore, uid: string, projectId: string, input: RestoreCampaignInput, now = Date.now()): Promise<CampaignDraft> {
  if (!restoreSchema.safeParse(input).success) throw new CampaignHistoryError("Confirm the saved version before restoring it.", 400);
  const target = references(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    const current = await readAccess(transaction, target, uid, true);
    const [snapshot, order, lock] = await Promise.all([
      transaction.get(versionReference(target, input.version)), transaction.get(target.order), transaction.get(target.lock),
    ]);
    if (order.exists || ["awaiting_payment", "fulfillment"].includes(String(current.project.campaignStatus))) throw new CampaignHistoryError("This project has a fulfillment order. Its campaign can no longer be restored.", 409);
    const activeId = lock.data()?.jobId;
    if (typeof activeId === "string") {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(activeId)) throw new CampaignHistoryError("The project has unfinished background work. Reload before restoring.", 409);
      const active = await transaction.get(target.workspace.collection("intelligenceJobs").doc(activeId));
      if (!active.exists || ["queued", "scheduled", "running"].includes(String(active.data()?.status))) throw new CampaignHistoryError("Wait for the current project job to finish before restoring a version.", 409);
    }
    if (current.currentVersion !== input.expectedVersion || current.currentDigest !== input.expectedDigest) throw new CampaignHistoryError("The project changed since this preview. Reload history and review the version again.", 409);
    if (!snapshot.exists || input.version > current.currentVersion) throw new CampaignHistoryError("Campaign version not found.", 404);
    if (input.version === current.currentVersion) throw new CampaignHistoryError("Choose an earlier version to restore.", 409);
    if (current.currentVersion >= MAX_VERSION) throw new CampaignHistoryError("This campaign has reached its version limit. Contact support.", 409);
    const source = parseVersion(snapshot.data(), input.version);
    const claims = current.project.claims as Claim[] | undefined;
    if (!Array.isArray(claims) || !claims.length || claims.some((claim) => claim.approved !== true)) throw new CampaignHistoryError("Approve the current evidence claims before restoring a campaign.", 409);
    const byId = new Map(claims.map((claim) => [claim.id, claim]));
    if (byId.size !== claims.length) throw new CampaignHistoryError("The current evidence set needs review before restoring a campaign.", 409);
    const referencedClaims = new Set(source.assets.flatMap((asset) => asset.claimIds));
    const evidenceIds = new Set<string>();
    for (const claimId of referencedClaims) {
      const claim = byId.get(claimId);
      if (!claim || !Array.isArray(claim.evidenceIds) || !claim.evidenceIds.length) throw new CampaignHistoryError("This version references evidence that is no longer approved or available. Review the current evidence first.", 409);
      for (const evidenceId of claim.evidenceIds) {
        if (typeof evidenceId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(evidenceId)) throw new CampaignHistoryError("This version has unavailable evidence references.", 409);
        evidenceIds.add(evidenceId);
      }
    }
    if (evidenceIds.size > 100) throw new CampaignHistoryError("This version has too many evidence references to restore safely.", 409);
    const sources = current.project.sources as EvidenceSnapshot[] | undefined;
    const currentSources = new Map((Array.isArray(sources) ? sources : []).map((source) => [source.id, source]));
    const evidence = await Promise.all([...evidenceIds].map((id) => transaction.get(target.project.collection("evidence").doc(id))));
    for (const captured of evidence) {
      const original = captured.data();
      const currentSource = currentSources.get(captured.id);
      if (!original || !currentSource || !original.contentHash || original.id !== captured.id || original.contentHash !== currentSource.contentHash || original.url !== currentSource.url) throw new CampaignHistoryError("This version references evidence that is no longer available in the current project.", 409);
    }
    const next = versionReference(target, current.currentVersion + 1);
    if ((await transaction.get(next)).exists) throw new CampaignHistoryError("A newer saved version already exists. Reload the project before restoring.", 409);
    const timestamp = new Date(now).toISOString();
    const draft: CampaignDraft = {
      ...source, version: current.currentVersion + 1, status: "draft", updatedAt: timestamp,
      assets: source.assets.map((asset) => ({ ...asset, status: "draft" })),
    };
    transaction.set(target.campaign, { ...draft, updatedAtServer: FieldValue.serverTimestamp() });
    transaction.create(next, { ...draft, restoredFromVersion: source.version, createdAt: FieldValue.serverTimestamp() });
    // Replace, never merge, so no approvedBy/version/digest can survive. This
    // also serializes against checkout's attestation read and order creation.
    transaction.set(target.project.collection("campaignApprovals").doc("current"), {
      status: "revoked", reason: "campaign_restored", revokedBy: uid, revokedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(target.project, {
      campaignStatus: "draft_ready", lifecycleStatus: "draft_ready", approvedAt: null,
      updatedAtIso: timestamp, updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(target.project.collection("auditLogs").doc(), {
      actorId: uid, action: "campaign.restored", targetId: String(draft.version),
      restoredFromVersion: source.version, previousVersion: current.currentVersion, createdAt: FieldValue.serverTimestamp(),
    });
    return draft;
  });
}
