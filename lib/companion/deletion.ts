import { isSafeUid } from "../identity";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { AccessError } from "../customer-mcp/auth";
const deleteSchema = z.object({ confirmation: z.string(), expectedRevision: z.number().int().min(1), expectedCampaignVersion: z.number().int().min(0), includeDerivedContent: z.literal(true) }).strict();
const removable = ["briefVersions", "companionRequests", "companionOperationalLogs", "profiles", "claims", "evidence", "contentRecommendations", "contentRecommendationVersions"];
const protectedCollections = ["orders", "campaignApprovals", "placements", "siteDiagnosticReports", "directorySubmissions", "jobs", "auditLogs"];
const LIMIT = 100;
const blocked = () => new AccessError(409, "Deletion blocked: this project has protected, linked, legacy or oversized records requiring a reviewed deletion plan. Nothing was deleted.");

/** Only synthetic tests have executed this workflow. No recursiveDelete: either
 * the entire bounded draft tree commits atomically or no content is removed. */
export async function deleteCompanionProject(db: Firestore, uid: string, id: string, input: unknown) {
  const args = deleteSchema.parse(input);
  if (!isSafeUid(uid) || !/^[a-f0-9]{24}$/.test(id)) throw new AccessError(400, "Invalid identifier.");
  if (args.confirmation !== `DELETE ${id}`) throw new AccessError(400, "Type DELETE followed by this exact project ID.");
  const workspace = db.doc(`workspaces/personal_${uid}`), project = workspace.collection("projects").doc(id), receipt = workspace.collection("companionDeletions").doc(id);
  // Schema inventory is read-only. Known producer paths are also read in the
  // transaction below, so their concurrent writes contend with deletion.
  // Unknown/admin-created schemas are blocked rather than recursively erased.
  const collections = await project.listCollections();
  if (collections.some(c => ![...removable, ...protectedCollections, "campaigns"].includes(c.id))) throw blocked();
  return db.runTransaction(async tx => {
    const [member, prior, p, campaign, ...protectedRows] = await Promise.all([
      tx.get(workspace.collection("members").doc(uid)), tx.get(receipt), tx.get(project), tx.get(project.collection("campaigns").doc("current")),
      ...protectedCollections.map(c => tx.get(project.collection(c).limit(1))),
      tx.get(workspace.collection("intelligenceJobs").where("projectId", "==", id).limit(1)),
      tx.get(workspace.collection("siteDiagnosticJobs").where("projectId", "==", id).limit(1)),
    ]);
    if (member.data()?.userId !== uid || member.data()?.role !== "owner") throw new AccessError(403, "Owner access required.");
    if (prior.exists) {
      if (prior.data()?.userId !== uid || prior.data()?.projectId !== id || p.exists || (await project.listCollections()).length || campaign.exists || protectedRows.some(q => q.size)) throw blocked();
      return { deleted: true as const, alreadyDeleted: true, accountDeleted: false as const };
    }
    const data = p.data();
    if (!data || data.createdBy !== uid || data.workspaceId !== workspace.id) throw new AccessError(404, "Project not found.");
    if (!data.brief || data.url || protectedRows.some(q => q.size) || campaign.data()?.status === "approved" || [data.campaignStatus, data.lifecycleStatus].some(s => ["awaiting_payment", "fulfillment", "campaign_approved"].includes(s))) throw blocked();
    if (data.briefRevision !== args.expectedRevision || (campaign.data()?.version ?? 0) !== args.expectedCampaignVersion) throw new AccessError(409, "Project changed. Reload and confirm its current content before deletion.");
    const pointers = await Promise.all(["intelligenceRequests", "siteDiagnosticRequests", "siteDiagnosticLatest"].map(c => tx.get(workspace.collection(c).doc(id))));
    if (pointers.some(p => p.exists)) throw blocked();
    const groups = await Promise.all([
      ...removable.map(c => tx.get(project.collection(c).limit(LIMIT + 1))),
      tx.get(project.collection("campaigns").limit(LIMIT + 1)),
      tx.get(project.collection("campaigns").doc("current").collection("versions").limit(LIMIT + 1)),
    ]);
    const docs: QueryDocumentSnapshot[] = groups.flatMap(g => g.docs);
    if (docs.length > LIMIT || docs.some(d => d.data().status === "approved") || groups[removable.length].docs.some(d => d.id !== "current")) throw blocked();
    // Queries omit missing documents with surviving subcollections. Inventory
    // document references too, and reject orphan-parent trees rather than
    // returning success while leaving their descendants behind.
    const known = new Set(docs.map(d => d.ref.path));
    for (const collection of [...collections, project.collection("campaigns").doc("current").collection("versions")]) {
      const refs = await collection.listDocuments();
      if (refs.some(ref => !known.has(ref.path))) throw blocked();
    }
    // Unknown descendants cannot be deleted safely or silently left behind.
    // Only the known current campaign may have its versions collection.
    for (const d of docs) {
      const children = await d.ref.listCollections();
      if (children.some(c => d.ref.path !== campaign.ref.path || c.id !== "versions")) throw blocked();
    }
    // Includes JSON payload and substantial headroom for protobuf/index overhead.
    // This guard is deliberately conservative; SDK limits remain an atomic fail.
    if (Buffer.byteLength(JSON.stringify([data, ...docs.map(d => d.data())])) > 2_000_000) throw blocked();
    for (const d of docs) tx.delete(d.ref);
    tx.delete(project);
    tx.create(receipt, { userId: uid, projectId: id, deletedAt: new Date().toISOString() });
    return { deleted: true as const, alreadyDeleted: false, accountDeleted: false as const };
  });
}
