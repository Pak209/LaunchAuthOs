import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { CampaignDraft } from "./types";

export type CampaignApprovalAttestation = {
  campaignVersion: number;
  campaignDigest: string;
  approvedBy: string;
};

export function campaignDigest(campaign: CampaignDraft): string {
  const material = {
    version: campaign.version,
    model: campaign.model,
    generatedAt: campaign.generatedAt,
    assets: campaign.assets.map(({ id, type, title, content, claimIds, status }) => ({
      id,
      type,
      title,
      content,
      claimIds,
      status,
    })),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export function assertCampaignAttestation(
  campaign: CampaignDraft,
  approval: CampaignApprovalAttestation | undefined,
  uid: string,
) {
  if (campaign.status !== "approved") throw new Error("Approve the complete campaign before fulfillment.");
  if (!approval
    || approval.approvedBy !== uid
    || approval.campaignVersion !== campaign.version
    || approval.campaignDigest !== campaignDigest(campaign)) {
    throw new Error("The campaign approval is missing or no longer matches the approved assets.");
  }
}

export async function attestCampaignApproval(
  db: Firestore,
  uid: string,
  projectId: string,
  campaign: CampaignDraft,
) {
  if (campaign.status !== "approved") throw new Error("Only an approved campaign can be attested.");
  const project = db.doc(`workspaces/personal_${uid}/projects/${projectId}`);
  const approval = project.collection("campaignApprovals").doc("current");
  const currentCampaign = project.collection("campaigns").doc("current");
  const digest = campaignDigest(campaign);
  await db.runTransaction(async (transaction) => {
    const [projectSnapshot, campaignSnapshot] = await Promise.all([
      transaction.get(project), transaction.get(currentCampaign),
    ]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== uid) throw new Error("The project was not found.");
    const current = campaignSnapshot.data() as CampaignDraft | undefined;
    // Approval is a separate server write after the customer revision. An edit,
    // generation or restore can win between those writes; never attest an old
    // response merely because it was approved when originally saved.
    if (!current || current.status !== "approved" || !Array.isArray(current.assets)
      || !current.assets.length || current.assets.some((asset) => asset.status !== "approved")
      || campaignDigest(current) !== digest) {
      throw new Error("The approved campaign no longer matches the saved version. Reload and approve the current campaign.");
    }
    transaction.set(approval, {
      campaignVersion: campaign.version,
      campaignDigest: digest,
      approvedBy: uid,
      approvedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(project.collection("auditLogs").doc(), {
      actorId: uid,
      action: "campaign.approved",
      targetId: String(campaign.version),
      campaignDigest: digest,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { campaignVersion: campaign.version, campaignDigest: digest, approvedBy: uid };
}
