import { describe, expect, it } from "vitest";
import { editorChanges, editorSnapshot } from "../lib/editor-conflict";
import { evidenceSaveBaseline, invalidateCampaignApproval, mergeEvidenceSave, type EvidenceSaveOutcome } from "../lib/evidence-save-state";
import type { PersistedAnalysisResult } from "../lib/types";

const date = "2026-10-03T00:00:00.000Z";
const project: PersistedAnalysisResult = {
  projectId: "a".repeat(24), persistence: "saved", campaignStatus: "campaign_approved", fetchedAt: date,
  profile: {
    company: "Acme", product: "Software", audience: "Teams", positioning: "Simple", sourceUrl: "https://example.com/",
    findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] },
    claims: [{ id: "claim", text: "Original evidence", state: "VERIFIED", approved: true, sourceUrl: "https://example.com/", evidenceIds: ["source"] }],
  },
  readiness: { score: 70, label: "Ready", rationale: [], missingInformation: [], strongestStoryAngle: "A launch" },
  campaign: { version: 2, model: "test", status: "approved", generatedAt: date, updatedAt: date, assets: [{ id: "asset", type: "press_release", title: "Title", content: "Original copy", claimIds: ["claim"], status: "approved" }] },
};
const savedBefore = editorSnapshot(project);
const outcome: EvidenceSaveOutcome = {
  profile: { ...project.profile, company: "Saved company" },
  campaign: invalidateCampaignApproval(project.campaign!, "2026-10-03T01:00:00.000Z"),
  campaignStatus: "evidence_review", updatedAt: "2026-10-03T01:00:00.000Z",
};

describe("evidence save campaign approval reconciliation", () => {
  it("updates a clean campaign from the saved outcome, downgrades approval and stays clean", () => {
    const updated = mergeEvidenceSave(project, savedBefore, outcome, true);
    expect(updated.campaign?.status).toBe("draft");
    expect(updated.campaign?.assets.every((asset) => asset.status === "draft")).toBe(true);
    expect(updated.campaign?.version).toBe(2);
    expect(updated.profile.company).toBe("Saved company");
    expect(editorChanges(editorSnapshot(updated), evidenceSaveBaseline(project.projectId!, outcome))).toEqual({ evidence: false, campaign: false });
  });

  it("does not approve generated assets when only claims are approved", () => {
    const updated = mergeEvidenceSave(project, savedBefore, { ...outcome, campaignStatus: "approved" }, true);
    expect(updated.campaignStatus).toBe("approved");
    expect(updated.campaign?.status).toBe("draft");
    expect(updated.campaign?.assets[0].status).toBe("draft");
  });

  it("preserves asset edits made before or during the evidence save and does not mark them saved", () => {
    const current = { ...project, campaign: { ...project.campaign!, assets: [{ ...project.campaign!.assets[0], content: "Unsaved campaign copy" }] } };
    const updated = mergeEvidenceSave(current, savedBefore, outcome, true);
    expect(updated.campaign?.assets[0].content).toBe("Unsaved campaign copy");
    expect(updated.campaign?.status).toBe("draft");
    expect(updated.campaign?.assets[0].status).toBe("draft");
    expect(editorChanges(editorSnapshot(updated), evidenceSaveBaseline(project.projectId!, outcome))).toEqual({ evidence: false, campaign: true });
    expect(outcome.campaign?.assets[0].content).toBe("Original copy");
  });

  it("keeps newer evidence or a revert dirty while recording what the server actually saved", () => {
    for (const company of ["Newer local company", "Acme"]) {
      const current = { ...project, profile: { ...project.profile, company } };
      const updated = mergeEvidenceSave(current, savedBefore, outcome, false);
      expect(updated.profile.company).toBe(company);
      expect(updated.campaign?.status).toBe("draft");
      expect(editorChanges(editorSnapshot(updated), evidenceSaveBaseline(project.projectId!, outcome))).toEqual({ evidence: true, campaign: false });
    }
  });

  it("keeps a reverted asset clean when it matches the newly invalidated saved campaign", () => {
    const current = { ...project, campaign: invalidateCampaignApproval(project.campaign!, date) };
    const updated = mergeEvidenceSave(current, savedBefore, outcome, true);
    expect(editorChanges(editorSnapshot(updated), evidenceSaveBaseline(project.projectId!, outcome))).toEqual({ evidence: false, campaign: false });
  });

  it("does not invent a campaign for an evidence-only project", () => {
    const current = { ...project, campaign: null };
    const updated = mergeEvidenceSave(current, editorSnapshot(current), { ...outcome, campaign: null }, true);
    expect(updated.campaign).toBeNull();
    expect(editorChanges(editorSnapshot(updated), evidenceSaveBaseline(project.projectId!, { ...outcome, campaign: null }))).toEqual({ evidence: false, campaign: false });
  });

  it("returns a public campaign without storage-only timestamp or approval fields", () => {
    const campaign = { ...project.campaign!, approvedClaimIds: ["claim"], updatedAtServer: { seconds: 123 } };
    const draft = invalidateCampaignApproval(campaign, date);
    expect(draft).not.toHaveProperty("updatedAtServer");
    expect(draft).not.toHaveProperty("approvedClaimIds");
    expect(project.campaign?.status).toBe("approved");
  });
});
