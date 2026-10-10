import { createHash } from "node:crypto";
import { z } from "zod";
import type { Brief } from "./companion/model";
import { secretPattern } from "./companion/model";
import { AccessError } from "./customer-mcp/auth";
import { campaignDigest } from "./campaign-approval";
import type { CampaignDraft } from "./types";
import type { Firestore } from "firebase-admin/firestore";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const field = z.string().trim().max(4000).refine(s => !secretPattern.test(s), "Remove credentials.");
export const recommendationReview = z.object({ expectedVersion: z.number().int().min(0), snapshot: z.string().regex(/^[a-f0-9]{64}$/), audience: field.min(1), question: field.min(1), destination: field.min(1), publicationOwner: field.min(1), proposedChange: field.min(1), action: field.min(1), approved: z.boolean() }).strict();
export function recommendContent(brief: Brief, revision: number, campaignVersion: number, campaignDigest: string | null) {
  const facts = brief.facts.filter(f => f.kind === "fact" && f.approved).map(f => ({ id: f.id, text: f.text, reference: f.reference, freshness: "Not independently checked; revalidate before publication." }));
  const sources = brief.sources.map(s => ({ id: s.id, name: s.name, contentHash: hash(s.excerpt), capturedAt: null }));
  return { snapshot: hash({ brief, revision, campaignVersion, campaignDigest }), briefRevision: revision, campaignVersion, campaignDigest, audience: brief.audience, question: "What does this product do, who is it for, and what can the reader do next?", destination: "", publicationOwner: "", proposedChange: "Review the page introduction and FAQ against the approved factual references below. Add only supported answers and clearly state the intended customer action.", action: brief.cta, rationale: "Make the audience, supported product information and next action explicit.", facts, sources, gaps: [...(!facts.length ? ["No current approved factual claims. Approve evidence in the guided brief first."] : []), ...facts.filter(f => !f.reference.trim()).map(f => `Fact ${f.id} has no source reference.`), ...(!sources.length ? ["No retained source snapshots are available."] : []), "Source capture dates and independent freshness are unknown; customer revalidation is required."], reviewStatus: "unreviewed" as const, limitation: "No ranking or AI-citation guarantee. This does not publish, change a campaign or alter an order." };
}
export class ContentRecommendationService {
  constructor(private db: Firestore) {}
  async access(tx: FirebaseFirestore.Transaction, uid: string, id: string) {
    if (!/^[a-f0-9]{24}$/.test(id) || !uid || /[/\x00-\x1f]/.test(uid)) throw new AccessError(400, "Invalid identifier.");
    const project = this.db.doc(`workspaces/personal_${uid}/projects/${id}`);
    const [p, m, c, r] = await Promise.all([tx.get(project), tx.get(this.db.doc(`workspaces/personal_${uid}/members/${uid}`)), tx.get(project.collection("campaigns").doc("current")), tx.get(project.collection("contentRecommendations").doc("current"))]);
    if (m.data()?.userId !== uid || m.data()?.role !== "owner") throw new AccessError(403, "Owner access required.");
    if (!p.exists || p.data()?.createdBy !== uid || p.data()?.workspaceId !== `personal_${uid}`) throw new AccessError(404, "Project not found.");
    if (!p.data()?.brief) throw new AccessError(409, "Save a guided brief before reviewing content recommendations.");
    const campaign = c.data();
    const recommendation = recommendContent(p.data()!.brief, p.data()!.briefRevision, campaign?.version ?? 0, Array.isArray(campaign?.assets) ? campaignDigest(campaign as CampaignDraft) : null);
    return { project, p, r, recommendation };
  }
  async read(uid: string, id: string) { return this.db.runTransaction(async tx => { const { r, recommendation } = await this.access(tx, uid, id); return { recommendation, review: r.data() ?? null, stale: r.exists && r.data()?.snapshot !== recommendation.snapshot }; }); }
  async save(uid: string, id: string, input: unknown) {
    const args = recommendationReview.parse(input);
    return this.db.runTransaction(async tx => {
      const { project, p, r, recommendation } = await this.access(tx, uid, id);
      if (p.data()?.archivedAt) throw new AccessError(409, "Restore the project before editing recommendations.");
      if (args.snapshot !== recommendation.snapshot || args.expectedVersion !== (r.data()?.version ?? 0)) throw new AccessError(409, "Evidence or review changed. Reload and review again.");
      if (args.approved && (!recommendation.facts.length || recommendation.facts.some(f => !f.reference.trim()))) throw new AccessError(409, "Approval requires referenced approved facts.");
      const record = { ...args, version: args.expectedVersion + 1, reviewedBy: uid, reviewedAt: new Date().toISOString(), briefRevision: recommendation.briefRevision, campaignVersion: recommendation.campaignVersion, factualReferences: recommendation.facts.map(f => f.id), sourceHashes: recommendation.sources, freshnessAcknowledged: args.approved };
      tx.set(project.collection("contentRecommendations").doc("current"), record);
      tx.create(project.collection("contentRecommendationVersions").doc(String(record.version).padStart(8, "0")), record);
      return record;
    });
  }
}
