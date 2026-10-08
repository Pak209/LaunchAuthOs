import { describe, expect, it } from "vitest";
import { canApplyEditorResponse, editorChanges, editorSnapshot, localDraftMarkdown } from "../lib/editor-conflict";
import type { PersistedAnalysisResult } from "../lib/types";

const project: PersistedAnalysisResult = {
  projectId: "first-project", persistence: "saved", campaignStatus: "campaign_approved", fetchedAt: "2026-09-11T00:00:00.000Z",
  profile: {
    company: "Example", product: "Product", audience: "Founders", positioning: "Source-backed", sourceUrl: "https://example.com/",
    findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] },
    claims: [{ id: "claim-1", text: "Original claim", state: "VERIFIED", approved: true, sourceUrl: "https://example.com/about", evidenceIds: ["source-1"] }],
  },
  readiness: { score: 70, label: "Ready", rationale: [], missingInformation: [], strongestStoryAngle: "Example launches" },
  campaign: { version: 2, status: "approved", model: "test", generatedAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", assets: [{ id: "asset-1", type: "press_release", title: "Original title", content: "Original campaign", claimIds: ["claim-1"], status: "approved" }] },
};

describe("project-scoped local draft tracking", () => {
  it("starts clean, detects profile and separately held claim edits, and becomes clean on saved reload", () => {
    const saved = editorSnapshot(project);
    expect(editorChanges(saved, saved)).toEqual({ evidence: false, campaign: false });
    const edited = { ...project, profile: { ...project.profile, company: "Local company" } };
    expect(editorChanges(editorSnapshot(edited), saved)).toEqual({ evidence: true, campaign: false });
    const localClaims = project.profile.claims.map((claim) => ({ ...claim, text: "Local claim", approved: false }));
    expect(editorChanges(editorSnapshot(project, localClaims), saved)).toEqual({ evidence: true, campaign: false });
    expect(editorChanges(editorSnapshot(project), saved)).toEqual({ evidence: false, campaign: false });
  });

  it("does not let a campaign save clear local evidence or an evidence save clear local campaign edits", () => {
    const saved = editorSnapshot(project);
    const changed = editorSnapshot({ ...project, profile: { ...project.profile, product: "Local product" }, campaign: { ...project.campaign!, status: "draft", assets: [{ ...project.campaign!.assets[0], content: "Local asset" }] } });
    expect(editorChanges(changed, { ...saved, evidence: changed.evidence })).toEqual({ evidence: false, campaign: true });
    expect(editorChanges(changed, { ...saved, campaign: changed.campaign })).toEqual({ evidence: true, campaign: false });
  });

  it("keeps a newer reverted field dirty when the in-flight edited value was saved", () => {
    const original = editorSnapshot(project);
    const submitted = editorSnapshot({ ...project, profile: { ...project.profile, company: "In-flight edit" } });
    // The editor has returned to its original text, but the server now holds
    // the submitted value. The next autosave must persist the newer revert.
    expect(editorChanges(original, { ...original, evidence: submitted.evidence })).toEqual({ evidence: true, campaign: false });
  });

  it("never compares another project's baseline as saved content", () => {
    const saved = editorSnapshot(project);
    expect(editorChanges(editorSnapshot({ ...project, projectId: "second-project" }), saved)).toEqual({ evidence: true, campaign: true });
    expect(editorChanges(null, saved)).toEqual({ evidence: false, campaign: false });
    const local = editorSnapshot({ ...project, projectId: undefined, persistence: "local" });
    expect(editorChanges(local, local)).toEqual({ evidence: false, campaign: false });
  });

  it("rejects stale success after another edit, a project switch, a saved reload, or an observed order lock", () => {
    const request = { projectId: project.projectId, epoch: 7 };
    expect(canApplyEditorResponse(request, project.projectId, 7)).toBe(true);
    expect(canApplyEditorResponse(request, project.projectId, 8)).toBe(false);
    expect(canApplyEditorResponse(request, "second-project", 7)).toBe(false);
    expect(canApplyEditorResponse(request, undefined, 8)).toBe(false);
    // Reopening the original project must not revive a stale save.
    expect(canApplyEditorResponse(request, project.projectId, 9)).toBe(false);
  });

  it("exports local profile, claims, and campaign text without claiming saved approval or ordered content", () => {
    const edited = { ...project, profile: { ...project.profile, company: "Local company", product: "Local product" }, campaign: { ...project.campaign!, assets: [{ ...project.campaign!.assets[0], content: "Local campaign" }] } };
    const markdown = localDraftMarkdown(edited, [{ ...project.profile.claims[0], text: "Local claim" }]);
    expect(markdown).toContain("# LOCAL DRAFT — Local company");
    expect(markdown).toContain("not proof of saved approval and not the ordered campaign");
    expect(markdown).toContain("Local product");
    expect(markdown).toContain("Local claim");
    expect(markdown).toContain("Local campaign");
    expect(markdown).toContain("Local review selection: selected (not saved approval)");
    expect(markdown).toContain("https://example.com/about");
    expect(markdown).toContain("Evidence references: claim-1");
  });
});
