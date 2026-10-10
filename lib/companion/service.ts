import { createHash } from "node:crypto";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { campaignDigest } from "../campaign-approval";
import type { CampaignDraft, Claim } from "../types";
import { AccessError } from "../customer-mcp/auth";
import { archiveSchema, approveCampaignSchema, approveFactsSchema, briefSchema, contextBundle, draftSchema, emptyBrief, saveBriefSchema, type Brief } from "./model";
import { legacySourceHistory, writeOperationalEvent } from "./retention";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function refs(db: Firestore, uid: string, id: string) {
  if (!/^[a-f0-9]{24}$/.test(id) || !uid || /[/\x00-\x1f]/.test(uid)) throw new AccessError(400, "Invalid identifier.");
  const workspace = db.doc(`workspaces/personal_${uid}`), project = workspace.collection("projects").doc(id);
  return { workspace, project, member: workspace.collection("members").doc(uid), campaign: project.collection("campaigns").doc("current"), order: project.collection("orders").doc("current") };
}
function check(data: Record<string, any> | undefined, member: Record<string, any> | undefined, uid: string, editable: boolean, order: boolean) {
  if (member?.userId !== uid || !["owner", "admin", "member"].includes(member.role)) throw new AccessError(403, "Workspace access denied.");
  if (!data || data.createdBy !== uid || data.workspaceId !== `personal_${uid}`) throw new AccessError(404, "Project not found.");
  if (editable && data.archivedAt) throw new AccessError(409, "Restore this archived project before editing.");
  if (editable && (order || [data.campaignStatus, data.lifecycleStatus].some(s => ["awaiting_payment", "fulfillment"].includes(s)))) throw new AccessError(409, "A fulfillment order freezes this project.");
}
export class CompanionService {
  constructor(private db: Firestore) {}
  async read(uid: string, id: string) {
    const r = refs(this.db, uid, id);
    const [p, m, c, o] = await Promise.all([r.project.get(), r.member.get(), r.campaign.get(), r.order.get()]);
    check(p.data(), m.data(), uid, false, o.exists);
    const data = p.data()!;
    const brief: Brief = data.brief ? briefSchema.parse(data.brief) : { ...emptyBrief, company: data.name ?? "", product: data.profile?.product ?? "", audience: data.profile?.audience ?? "", angle: data.profile?.positioning ?? "", facts: (data.claims ?? []).slice(0, 40).map((f: Claim) => ({ id: f.id, text: f.text, kind: f.state === "ASSUMED" || f.state === "UNKNOWN" ? "assumption" as const : "fact" as const, reference: f.sourceUrl ?? "", approved: f.approved })) };
    const campaign = c.data() as CampaignDraft | undefined;
    return { projectId: id, archivedAt: typeof data.archivedAt === "string" ? data.archivedAt : null, revision: data.briefRevision ?? 0, brief, frozen: !!data.archivedAt || o.exists || [data.campaignStatus, data.lifecycleStatus].some(s => ["awaiting_payment", "fulfillment"].includes(s)), campaign: campaign?.assets ? { version: campaign.version, status: campaign.status, assets: campaign.assets, digest: campaignDigest(campaign) } : null };
  }
  async archive(uid: string, id: string, input: unknown) {
    const args = archiveSchema.parse(input), r = refs(this.db, uid, id);
    return this.db.runTransaction(async tx => {
      const [p, m, o] = await Promise.all([tx.get(r.project), tx.get(r.member), tx.get(r.order)]);
      check(p.data(), m.data(), uid, false, o.exists);
      if (m.data()?.role !== "owner" || !p.data()?.brief) throw new AccessError(403, "Owner access required.");
      if (p.data()?.briefRevision !== args.expectedRevision) throw new AccessError(409, "Brief changed. Reload before archiving.");
      if (o.exists) throw new AccessError(409, "Order retention is undecided; this project cannot be archived.");
      const archivedAt = args.archived ? p.data()?.archivedAt ?? new Date().toISOString() : null;
      tx.update(r.project, { archivedAt, briefRevision: args.expectedRevision + 1 });
      writeOperationalEvent(tx, r.project, args.archived ? "archived" : "restored", new Date().toISOString());
      return { archivedAt, revision: args.expectedRevision + 1 };
    });
  }
  async context(uid: string, id: string) {
    const current = await this.read(uid, id);
    return { projectId: id, briefRevision: current.revision, frozen: current.frozen, ...contextBundle(current.brief) };
  }
  async saveBrief(uid: string, id: string, input: unknown, create = false) {
    const payload = saveBriefSchema.parse(input), r = refs(this.db, uid, id);
    return this.db.runTransaction(async tx => {
      const [p, m, w, c, o] = await Promise.all([tx.get(r.project), tx.get(r.member), tx.get(r.workspace), tx.get(r.campaign), tx.get(r.order)]);
      const data = p.data();
      if (!p.exists && create) {
        if (payload.expectedRevision !== 0 || o.exists) throw new AccessError(409, "Project already exists or is frozen.");
        if (w.exists && (w.data()?.createdBy !== uid || m.data()?.userId !== uid || m.data()?.role !== "owner")) throw new AccessError(403, "Workspace access denied.");
      } else check(data, m.data(), uid, true, o.exists);
      if ((data?.briefRevision ?? 0) !== payload.expectedRevision) throw new AccessError(409, "Brief changed. Reload before saving.");
      const legacy = await legacySourceHistory(tx, r.project, data);
      const before = data?.brief as Brief | undefined;
      const changedSources = JSON.stringify(before?.sources ?? []) !== JSON.stringify(payload.brief.sources);
      const brief = { ...payload.brief, facts: payload.brief.facts.map(f => {
        const old = before?.facts.find(x => x.id === f.id);
        return { ...f, approved: !changedSources && !!old?.approved && old.text === f.text && old.reference === f.reference && old.kind === f.kind };
      }) };
      const revision = payload.expectedRevision + 1;
      for (const d of legacy) tx.update(d.ref, { brief: { ...d.data().brief, sources: [] } });
      if (!w.exists && create) { tx.set(r.workspace, { name: "My Launch Workspace", createdBy: uid }); tx.set(r.member, { userId: uid, role: "owner" }); }
      this.writeBrief(tx, r.project, r.campaign, data, c.data() as CampaignDraft | undefined, uid, brief, revision);
      writeOperationalEvent(tx, r.project, "brief_saved", new Date().toISOString());
      return { revision };
    });
  }
  private writeBrief(tx: Transaction, project: DocumentReference, campaignRef: DocumentReference, old: Record<string, any> | undefined, campaign: CampaignDraft | undefined, uid: string, brief: Brief, revision: number) {
    const now = new Date().toISOString();
    const claims: Claim[] = brief.facts.map(f => ({ id: f.id, text: f.text, sourceUrl: f.reference, approved: f.approved && f.kind === "fact", state: f.kind === "fact" ? "INFERRED" : "ASSUMED" }));
    const profile = { ...(old?.profile ?? {}), company: brief.company, product: brief.product, audience: brief.audience, positioning: brief.angle, sourceUrl: old?.url ?? "", claims, findings: old?.profile?.findings ?? { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] } };
    tx.set(project, { workspaceId: `personal_${uid}`, createdBy: uid, name: brief.company || "Untitled announcement", url: old?.url ?? "", profile, claims, brief, sourceHistorySanitized: true, briefRevision: revision, campaignStatus: "evidence_review", lifecycleStatus: "evidence_review", fetchedAt: old?.fetchedAt ?? now, updatedAtIso: now, updatedAt: FieldValue.serverTimestamp(), readiness: old?.readiness ?? { score: 0, label: "Customer brief", rationale: [], missingInformation: [], strongestStoryAngle: brief.angle } }, { merge: true });
    tx.set(project.collection("briefVersions").doc(String(revision).padStart(6, "0")), { brief: { ...brief, sources: [] }, revision, savedAt: now });
    if (campaign?.assets?.length) {
      if (campaign.version >= 999999) throw new AccessError(409, "Campaign version limit reached.");
      const draft = { ...campaign, version: campaign.version + 1, status: "draft" as const, assets: campaign.assets.map(a => ({ ...a, status: "draft" as const })), updatedAt: now };
      tx.set(campaignRef, draft); tx.create(campaignRef.collection("versions").doc(String(draft.version).padStart(6, "0")), draft);
    }
  }
  async approveFacts(uid: string, id: string, input: unknown) {
    const args = approveFactsSchema.parse(input), r = refs(this.db, uid, id);
    return this.db.runTransaction(async tx => {
      const [p, m, c, o] = await Promise.all([tx.get(r.project), tx.get(r.member), tx.get(r.campaign), tx.get(r.order)]);
      check(p.data(), m.data(), uid, true, o.exists);
      if (p.data()?.briefRevision !== args.expectedRevision) throw new AccessError(409, "Brief changed. Reload before approving.");
      const legacy = await legacySourceHistory(tx, r.project, p.data());
      const brief = briefSchema.parse(p.data()?.brief);
      if (args.factIds.some(id => !brief.facts.some(f => f.id === id && f.kind === "fact"))) throw new AccessError(400, "Only factual claims can be approved.");
      brief.facts = brief.facts.map(f => ({ ...f, approved: args.factIds.includes(f.id) }));
      for (const d of legacy) tx.update(d.ref, { brief: { ...d.data().brief, sources: [] } });
      this.writeBrief(tx, r.project, r.campaign, p.data(), c.data() as CampaignDraft | undefined, uid, brief, args.expectedRevision + 1);
      writeOperationalEvent(tx, r.project, "facts_reviewed", new Date().toISOString());
      return { revision: args.expectedRevision + 1 };
    });
  }
  async saveDraft(uid: string, id: string, input: unknown) {
    const args = draftSchema.parse(input), r = refs(this.db, uid, id), receipt = r.project.collection("companionRequests").doc(args.requestId), digest = hash(args);
    return this.db.runTransaction(async tx => {
      const [p, m, c, o, prior] = await Promise.all([tx.get(r.project), tx.get(r.member), tx.get(r.campaign), tx.get(r.order), tx.get(receipt)]);
      check(p.data(), m.data(), uid, true, o.exists);
      if (prior.exists) { if (prior.data()?.digest !== digest) throw new AccessError(409, "Request ID was already used for different content."); return { version: prior.data()!.version as number, duplicate: true }; }
      const current = c.data() as CampaignDraft | undefined;
      if ((current?.version ?? 0) !== args.expectedVersion || p.data()?.briefRevision !== args.briefRevision) throw new AccessError(409, "Campaign or brief changed. Reload before saving.");
      const brief = briefSchema.parse(p.data()?.brief), approved = new Set(brief.facts.filter(f => f.approved && f.kind === "fact").map(f => f.id));
      if (!approved.size || args.assets.some(a => a.claimIds.some(id => !approved.has(id)))) throw new AccessError(409, "Drafts must cite approved factual claims.");
      const now = new Date().toISOString(), campaign: CampaignDraft = { version: args.expectedVersion + 1, status: "draft", model: "customer-supplied", generatedAt: current?.generatedAt ?? now, updatedAt: now, assets: args.assets.map(a => ({ ...a, status: "draft" })) };
      tx.set(r.campaign, campaign); tx.create(r.campaign.collection("versions").doc(String(campaign.version).padStart(6, "0")), campaign);
      tx.update(r.project, { campaignStatus: "draft_ready", lifecycleStatus: "draft_ready", updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
      tx.create(receipt, { digest, version: campaign.version });
      writeOperationalEvent(tx, r.project, "draft_saved", now);
      return { version: campaign.version, duplicate: false };
    });
  }
  async approveCampaign(uid: string, id: string, input: unknown) {
    const args = approveCampaignSchema.parse(input), r = refs(this.db, uid, id);
    return this.db.runTransaction(async tx => {
      const [p, m, c, o] = await Promise.all([tx.get(r.project), tx.get(r.member), tx.get(r.campaign), tx.get(r.order)]);
      check(p.data(), m.data(), uid, true, o.exists);
      const current = c.data() as CampaignDraft | undefined;
      if (!current?.assets?.length || current.version !== args.expectedVersion || campaignDigest(current) !== args.digest || current.version >= 999999) throw new AccessError(409, "Campaign changed. Reload before approving.");
      const approved = new Set(briefSchema.parse(p.data()?.brief).facts.filter(f => f.approved && f.kind === "fact").map(f => f.id));
      if (current.assets.some(a => !a.claimIds.length || a.claimIds.some(id => !approved.has(id)))) throw new AccessError(409, "Review facts before approving this campaign.");
      const campaign: CampaignDraft = { ...current, version: current.version + 1, status: "approved", assets: current.assets.map(a => ({ ...a, status: "approved" })), updatedAt: new Date().toISOString() };
      tx.set(r.campaign, campaign); tx.create(r.campaign.collection("versions").doc(String(campaign.version).padStart(6, "0")), campaign);
      tx.set(r.project.collection("campaignApprovals").doc("current"), { campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), approvedBy: uid, approvedAt: FieldValue.serverTimestamp() });
      tx.update(r.project, { campaignStatus: "campaign_approved", lifecycleStatus: "campaign_approved" });
      writeOperationalEvent(tx, r.project, "campaign_approved", new Date().toISOString());
      return { version: campaign.version };
    });
  }
}
