import type { Claim, PersistedAnalysisResult } from "./types";

export type EditorSnapshot = { projectId?: string; evidence: string; campaign: string };
export type EditorRequest = { projectId?: string; epoch: number };

export function editorSnapshot(project: PersistedAnalysisResult, claims = project.profile.claims): EditorSnapshot {
  return {
    projectId: project.projectId,
    evidence: JSON.stringify({ ...project.profile, claims }),
    campaign: JSON.stringify(project.campaign ?? null),
  };
}

export function editorChanges(current: EditorSnapshot | null, saved: EditorSnapshot | null) {
  const sameProject = Boolean(current && saved && current.projectId === saved.projectId);
  return {
    evidence: Boolean(current && (!sameProject || current.evidence !== saved?.evidence)),
    campaign: Boolean(current && (!sameProject || current.campaign !== saved?.campaign)),
  };
}

// A project ID alone is insufficient: returning to the same project or making
// another edit must invalidate an earlier asynchronous response as well.
export function canApplyEditorResponse(request: EditorRequest, projectId: string | undefined, epoch: number) {
  return request.projectId === projectId && request.epoch === epoch;
}

export function localDraftMarkdown(project: PersistedAnalysisResult, claims: Claim[]) {
  const findings = Object.values(project.profile.findings).flat().map((finding) =>
    `- ${finding.kind}: ${finding.value}\n  Source: ${finding.sourceUrl} · Evidence: ${finding.evidenceId}`,
  ).join("\n");
  const claimText = claims.map((claim) =>
    `- ${claim.text}\n  Local review selection: ${claim.approved ? "selected" : "not selected"} (not saved approval)\n  Source: ${claim.sourceUrl}\n  Evidence: ${(claim.evidenceIds ?? []).join(", ")}`,
  ).join("\n");
  const assets = project.campaign?.assets.map((asset) =>
    `### ${asset.title}\n\n${asset.content}\n\nEvidence references: ${asset.claimIds.join(", ")}`,
  ).join("\n\n---\n\n") ?? "No campaign assets in this local draft.";
  return `# LOCAL DRAFT — ${project.profile.company}\n\nThis is a copy of this tab's local editor, not proof of saved approval and not the ordered campaign. Local edits may never have been saved. Use the saved project and server-generated report for saved records.\n\nProject reference: ${project.projectId ?? "local analysis only"}\nCampaign version reference: ${project.campaign?.version ?? "none"} (local content may differ)\n\n## Company profile\n\nCompany: ${project.profile.company}\n\nProduct: ${project.profile.product}\n\nAudience: ${project.profile.audience}\n\nPositioning: ${project.profile.positioning}\n\nSource: ${project.profile.sourceUrl}\n\n## Structured findings\n\n${findings}\n\n## Local claim review\n\n${claimText}\n\n## Local campaign assets — not approved or ordered\n\n${assets}\n`;
}
