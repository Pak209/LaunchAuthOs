import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { AccessError } from "../customer-mcp/auth";
export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 86_400_000;
const MAX_LEGACY_REVISIONS = 50;

// The prototype used embedded source copies. Scrub them atomically before a
// source edit succeeds. New history never contains sources. Oversized legacy
// projects fail closed, requiring a separately reviewed migration, not partial deletion.
export async function legacySourceHistory(tx: Transaction, project: DocumentReference, data: Record<string, any> | undefined) {
  if (!data || data.sourceHistorySanitized === true) return [];
  const history = await tx.get(project.collection("briefVersions").limit(MAX_LEGACY_REVISIONS + 1));
  if (history.size > MAX_LEGACY_REVISIONS) throw new AccessError(409, "Source history needs an operator migration before editing. No sources were removed.");
  return history.docs.filter(d => d.data().brief?.sources?.length);
}
export function writeOperationalEvent(tx: Transaction, project: DocumentReference, event: "brief_saved" | "facts_reviewed" | "draft_saved" | "campaign_approved" | "archived" | "restored", now: string) {
  // Explicit allowlist: no arbitrary message, request payload, source, draft,
  // token, email or provider response can enter these application logs.
  tx.create(project.collection("companionOperationalLogs").doc(), { event, createdAt: now, expiresAt: new Date(Date.parse(now) + RETENTION_MS).toISOString() });
}

/** No scheduler, route, CLI or TTL policy invokes this. Default is dry-run.
 * Live execution requires separate operational approval. Bounded per-project
 * batches can be repeated until candidate counts are zero. */
export async function applyCompanionRetention(db: Firestore, uid: string, id: string, options: { execute?: boolean; now?: number } = {}) {
  if (!/^[a-f0-9]{24}$/.test(id) || !uid || /[/\x00-\x1f]/.test(uid)) throw new AccessError(400, "Invalid identifier.");
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new AccessError(400, "Invalid retention clock.");
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  const workspace = db.doc(`workspaces/personal_${uid}`), project = workspace.collection("projects").doc(id);
  return db.runTransaction(async tx => {
    const [p, m, orders, approvals, placements, reports, campaign, approvedVersions, logs] = await Promise.all([
      tx.get(project), tx.get(workspace.collection("members").doc(uid)),
      tx.get(project.collection("orders").limit(1)), tx.get(project.collection("campaignApprovals").limit(1)),
      tx.get(project.collection("placements").limit(1)), tx.get(project.collection("siteDiagnosticReports").limit(1)),
      tx.get(project.collection("campaigns").doc("current")),
      tx.get(project.collection("campaigns").doc("current").collection("versions").where("status", "==", "approved").limit(1)),
      tx.get(project.collection("companionOperationalLogs").where("createdAt", "<=", cutoff).limit(50)),
    ]);
    const data = p.data();
    if (m.data()?.userId !== uid || m.data()?.role !== "owner") throw new AccessError(403, "Owner access required.");
    if (!data || data.createdBy !== uid || data.workspaceId !== `personal_${uid}` || !data.brief) throw new AccessError(404, "Guided project not found.");
    // Payment, approval and report retention is undecided: never expire their
    // evidence/history implicitly, even for canceled/refunded orders.
    const protectedRecords = !!(orders.size || approvedVersions.size || approvals.size || placements.size || reports.size || campaign.data()?.status === "approved" || [data.campaignStatus, data.lifecycleStatus].some(s => ["awaiting_payment", "fulfillment", "campaign_approved"].includes(s)));
    const briefHistory = !protectedRecords ? await tx.get(project.collection("briefVersions").where("savedAt", "<=", cutoff).limit(50)) : null;
    const campaignHistory = !protectedRecords ? await tx.get(project.collection("campaigns").doc("current").collection("versions").where("updatedAt", "<=", cutoff).limit(50)) : null;
    const recommendationHistory = !protectedRecords ? await tx.get(project.collection("contentRecommendationVersions").where("reviewedAt", "<=", cutoff).limit(50)) : null;
    const archivedAt = typeof data.archivedAt === "string" ? Date.parse(data.archivedAt) : NaN;
    const expireSources = !protectedRecords && Number.isFinite(archivedAt) && archivedAt <= now - RETENTION_MS && !!data.brief.sources?.length;
    const legacy = expireSources ? await legacySourceHistory(tx, project, data) : [];
    const history = [...(recommendationHistory?.docs ?? []), ...(briefHistory?.docs ?? []), ...(campaignHistory?.docs ?? []).filter(d => d.data().status !== "approved")];
    if (options.execute === true) {
      const deleting = new Set(history.map(d => d.ref.path));
      for (const d of legacy) if (!deleting.has(d.ref.path)) tx.update(d.ref, { brief: { ...d.data().brief, sources: [] } });
      for (const d of [...history, ...logs.docs]) tx.delete(d.ref);
      if (expireSources) {
        const facts = data.brief.facts.map((f: Record<string, unknown>) => ({ ...f, approved: false }));
        const claims = (data.claims ?? []).map((c: Record<string, unknown>) => ({ ...c, approved: false }));
        tx.update(project, { brief: { ...data.brief, sources: [], facts }, claims, profile: { ...data.profile, claims }, briefRevision: data.briefRevision + 1, sourceHistorySanitized: true, sourcesExpiredAt: new Date(now).toISOString() });
      }
    }
    return { dryRun: options.execute !== true, protectedRecords, expiredSources: expireSources, historyCandidates: history.length, logCandidates: logs.size };
  });
}
