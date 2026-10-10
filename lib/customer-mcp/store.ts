import { assertDeploymentAccess } from "../deployment-access";
import { FieldPath, type Firestore, type Query } from "firebase-admin/firestore";
import { CompanionService } from "../companion/service";
import { AccessError, mappingId } from "./auth";

type Data = Record<string, unknown>;
const text = (value: unknown, max = 200) => typeof value === "string" ? value.slice(0, max) : null;
const state = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : "unknown";
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) ? value : null;
const campaignStates = ["evidence_review", "approved", "draft_ready", "campaign_approved", "awaiting_payment", "fulfillment"];
const jobStates = ["blocked", "scheduled", "queued", "running", "complete", "completed", "failed", "superseded"];
function publicUrl(value: unknown) {
  try { const url = new URL(String(value)); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null; url.search = ""; url.hash = ""; return url.href.slice(0, 2048); } catch { return null; }
}
export class CustomerStore {
  constructor(private db: Firestore, private activeUser: (uid: string) => Promise<boolean>) {}
  get companion() { return new CompanionService(this.db); }
  async resolve(issuer: string, subject: string) {
    const data = (await this.db.doc(`customerMcpLinks/${mappingId(issuer, subject)}`).get()).data();
    if (!data || data.enabled !== true || data.issuer !== issuer || data.subject !== subject || typeof data.firebaseUid !== "string") return null;
    try {
      if (!await this.activeUser(data.firebaseUid)) return null;
      await assertDeploymentAccess(data.firebaseUid, async () => (await this.db.doc("deploymentAccess/current").get()).data());
      return data.firebaseUid;
    } catch { return null; }
  }
  private async workspace(uid: string) {
    const ref = this.db.doc(`workspaces/personal_${uid}`);
    const member = (await ref.collection("members").doc(uid).get()).data();
    if (member?.userId !== uid || !["owner", "admin", "member"].includes(member.role)) throw new AccessError(403, "Workspace access denied.");
    return ref;
  }
  private own(data: Data | undefined, uid: string) {
    return data && data.createdBy === uid && data.workspaceId === `personal_${uid}`;
  }
  private async project(uid: string, id: string) {
    const workspace = await this.workspace(uid);
    const ref = workspace.collection("projects").doc(id);
    const data = (await ref.get()).data();
    if (!this.own(data, uid)) throw new AccessError(404, "Project not found.");
    return { workspace, ref, data: data! };
  }
  private async page(query: Query, limit: number, after?: string) {
    let page = query.orderBy(FieldPath.documentId());
    if (after) page = page.startAfter(after);
    const docs = (await page.limit(limit + 1).get()).docs;
    return { docs: docs.slice(0, limit), nextCursor: docs.length > limit ? docs[limit - 1].id : null };
  }
  async projects(uid: string, limit: number, after?: string) {
    const workspace = await this.workspace(uid);
    const page = await this.page(workspace.collection("projects"), limit, after);
    return { projects: page.docs.filter(doc => this.own(doc.data(), uid)).map(doc => ({ id: doc.id, name: text(doc.data().name), campaignStatus: state(doc.data().campaignStatus, campaignStates), updatedAt: timestamp(doc.data().updatedAtIso) })), nextCursor: page.nextCursor };
  }
  async status(uid: string, projectId: string, limit: number, after?: string, jobKind: "intelligence" | "fulfillment" = "intelligence") {
    const { workspace, ref, data } = await this.project(uid, projectId);
    if (jobKind === "fulfillment") {
      const page = await this.page(ref.collection("jobs"), limit, after);
      return { projectId, campaignStatus: state(data.campaignStatus, campaignStates), jobKind, jobs: page.docs.map(doc => ({ id: doc.id, type: state(doc.data().type, ["provider_submission", "directory_submission", "placement_verification", "customer_email"]), status: state(doc.data().status, jobStates), updatedAt: timestamp(doc.data().updatedAt) })), nextCursor: page.nextCursor };
    }
    const page = await this.page(workspace.collection("intelligenceJobs").where("projectId", "==", projectId), limit, after);
    return { projectId, campaignStatus: state(data.campaignStatus, campaignStates), jobKind, jobs: page.docs.filter(doc => doc.data().userId === uid && doc.data().workspaceId === workspace.id).map(doc => ({ id: doc.id, type: state(doc.data().type, ["analysis", "campaign_generation"]), status: state(doc.data().status, jobStates), updatedAt: timestamp(doc.data().updatedAt) })), nextCursor: page.nextCursor };
  }
  async report(uid: string, projectId: string, limit: number, after?: string) {
    const { ref } = await this.project(uid, projectId);
    const page = await this.page(ref.collection("placements"), limit, after);
    return { projectId, placements: page.docs.map(doc => ({ id: doc.id, outlet: text(doc.data().outlet), url: publicUrl(doc.data().url), state: state(doc.data().state, ["submitted", "accepted", "published", "indexed", "failed", "removed"]), publishedAt: timestamp(doc.data().publishedAt), lastVerifiedAt: timestamp(doc.data().lastVerifiedAt) })), nextCursor: page.nextCursor, limitations: "HTTP checks establish URL availability, not content accuracy or earned editorial coverage. Indexed states are supplier-reported. No independent backlink, ranking, or AI visibility measurements are included." };
  }
}
