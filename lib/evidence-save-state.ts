import type { EditorSnapshot } from "./editor-conflict";
import type { BrandProfile, CampaignDraft, PersistedAnalysisResult, ProjectStatus } from "./types";

export type EvidenceSaveOutcome = {
  profile: BrandProfile;
  campaign: CampaignDraft | null;
  campaignStatus: ProjectStatus;
  updatedAt: string;
};

// Claim approval is not campaign approval. Keep the last generated content and
// immutable version history, but require a new reviewed campaign revision.
export function invalidateCampaignApproval(campaign: CampaignDraft, updatedAt: string): CampaignDraft {
  return { version: campaign.version, model: campaign.model, generatedAt: campaign.generatedAt, status: "draft", updatedAt, assets: campaign.assets.map((asset) => ({ ...asset, status: "draft" })) };
}

export function mergeEvidenceSave(
  current: PersistedAnalysisResult,
  savedBeforeRequest: EditorSnapshot | null,
  outcome: EvidenceSaveOutcome,
  replaceEvidence: boolean,
): PersistedAnalysisResult {
  const campaignIsSaved = savedBeforeRequest && savedBeforeRequest.projectId === current.projectId
    && savedBeforeRequest.campaign === JSON.stringify(current.campaign ?? null);
  // Asset edits may predate this save or arrive while it is in flight. Never
  // replace them with the server campaign, or record them as saved by a PATCH
  // that only sent evidence. Both copies lose the old approval consistently.
  const campaign = campaignIsSaved
    ? outcome.campaign
    : current.campaign ? invalidateCampaignApproval(current.campaign, outcome.updatedAt) : current.campaign;
  return {
    ...current,
    ...(replaceEvidence ? { profile: outcome.profile } : {}),
    campaign,
    campaignStatus: outcome.campaignStatus,
  };
}

export function evidenceSaveBaseline(projectId: string, outcome: EvidenceSaveOutcome): EditorSnapshot {
  return { projectId, evidence: JSON.stringify(outcome.profile), campaign: JSON.stringify(outcome.campaign) };
}
