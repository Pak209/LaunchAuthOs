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
  const digest = campaignDigest(campaign);
  await db.runTransaction(async (transaction) => {
    const projectSnapshot = await transaction.get(project);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== uid) throw new Error("The project was not found.");
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
