import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AnalysisResult, Claim, PersistedAnalysisResult, ProjectStatus } from "./types";

type JsonObject = Record<string, unknown>;

function throwDatabaseError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function ensureWorkspace(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("ensure_personal_workspace");
  throwDatabaseError(error, "Unable to resolve the workspace");
  if (typeof data !== "number") throw new Error("The workspace could not be created.");
  return data;
}

export async function persistAnalysis(
  client: SupabaseClient,
  user: User,
  result: AnalysisResult,
): Promise<PersistedAnalysisResult> {
  const workspaceId = await ensureWorkspace(client);
  const { data: project, error: projectError } = await client
    .from("projects")
    .upsert({
      workspace_id: workspaceId,
      created_by: user.id,
      name: result.profile.company,
      url: result.profile.sourceUrl,
      lifecycle_status: "evidence_review",
    }, { onConflict: "workspace_id,url" })
    .select("id")
    .single();
  throwDatabaseError(projectError, "Unable to save the project");
  if (!project) throw new Error("The project was not returned after saving.");

  const { data: profile, error: profileError } = await client
    .from("brand_profiles")
    .upsert({
      project_id: project.id,
      company: result.profile.company,
      product: result.profile.product,
      audience: result.profile.audience,
      positioning: result.profile.positioning,
      source_url: result.profile.sourceUrl,
      readiness_score: result.readiness.score,
      readiness_label: result.readiness.label,
      story_angle: result.readiness.strongestStoryAngle,
      rationale: result.readiness.rationale,
      missing_information: result.readiness.missingInformation,
      fetched_at: result.fetchedAt,
    }, { onConflict: "project_id" })
    .select("id")
    .single();
  throwDatabaseError(profileError, "Unable to save brand intelligence");
  if (!profile) throw new Error("The brand profile was not returned after saving.");

  const { error: deleteClaimsError } = await client.from("claims").delete().eq("brand_profile_id", profile.id);
  throwDatabaseError(deleteClaimsError, "Unable to refresh the evidence claims");
  const { error: claimsError } = await client.from("claims").insert(result.profile.claims.map((claim) => ({
    brand_profile_id: profile.id,
    stable_key: claim.id,
    claim_text: claim.text,
    source_url: claim.sourceUrl,
    evidence_state: claim.state,
    approved: claim.approved,
  })));
  throwDatabaseError(claimsError, "Unable to save the evidence claims");

  const { error: campaignError } = await client.from("campaigns").upsert({
    project_id: project.id,
    status: "evidence_review",
  }, { onConflict: "project_id" });
  throwDatabaseError(campaignError, "Unable to initialize the campaign");

  if (result.sources?.length) {
    const { error: evidenceError } = await client.from("evidence_items").upsert(result.sources.map((source) => ({
      project_id: project.id,
      source_url: source.url,
      evidence_type: "source",
      state: "observed",
      excerpt: source.description || null,
      metadata: { title: source.title },
      observed_at: result.fetchedAt,
      verified_at: result.fetchedAt,
    })), { onConflict: "project_id,source_url,evidence_type" });
    throwDatabaseError(evidenceError, "Unable to save source evidence");
  }

  return { ...result, projectId: project.id, persistence: "saved", campaignStatus: "evidence_review" };
}

export async function loadLatestProject(client: SupabaseClient): Promise<PersistedAnalysisResult | null> {
  const workspaceId = await ensureWorkspace(client);
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,name,url,lifecycle_status")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwDatabaseError(projectError, "Unable to load projects");
  if (!project) return null;

  const [{ data: profile, error: profileError }, { data: campaign, error: campaignError }, { data: sources, error: sourcesError }] = await Promise.all([
    client.from("brand_profiles").select("*").eq("project_id", project.id).maybeSingle(),
    client.from("campaigns").select("status").eq("project_id", project.id).maybeSingle(),
    client.from("evidence_items").select("source_url,excerpt,metadata").eq("project_id", project.id).eq("evidence_type", "source").order("id"),
  ]);
  throwDatabaseError(profileError, "Unable to load brand intelligence");
  throwDatabaseError(campaignError, "Unable to load the campaign");
  throwDatabaseError(sourcesError, "Unable to load source evidence");
  if (!profile) return null;

  const { data: storedClaims, error: claimsError } = await client
    .from("claims")
    .select("stable_key,claim_text,source_url,evidence_state,approved")
    .eq("brand_profile_id", profile.id)
    .order("id");
  throwDatabaseError(claimsError, "Unable to load evidence claims");

  const claims: Claim[] = (storedClaims ?? []).map((claim) => ({
    id: claim.stable_key,
    text: claim.claim_text,
    sourceUrl: claim.source_url,
    state: claim.evidence_state,
    approved: claim.approved,
  }));

  return {
    projectId: project.id,
    persistence: "saved",
    campaignStatus: (campaign?.status ?? "evidence_review") as ProjectStatus,
    profile: {
      company: profile.company,
      product: profile.product,
      audience: profile.audience,
      positioning: profile.positioning,
      sourceUrl: profile.source_url,
      claims,
    },
    readiness: {
      score: profile.readiness_score,
      label: profile.readiness_label,
      rationale: profile.rationale as string[],
      missingInformation: profile.missing_information as string[],
      strongestStoryAngle: profile.story_angle,
    },
    sources: (sources ?? []).map((source) => ({
      url: source.source_url,
      title: typeof source.metadata?.title === "string" ? source.metadata.title : "Observed source",
      description: source.excerpt ?? "",
    })),
    fetchedAt: profile.fetched_at,
  };
}

export async function updateProjectCampaign(
  client: SupabaseClient,
  user: User,
  projectId: number,
  claims: Claim[],
  status: ProjectStatus,
): Promise<void> {
  const { data: profile, error: profileError } = await client
    .from("brand_profiles")
    .select("id")
    .eq("project_id", projectId)
    .single();
  throwDatabaseError(profileError, "Unable to resolve project evidence");
  if (!profile) throw new Error("The project evidence was not found.");

  const { data: storedClaims, error: storedClaimsError } = await client
    .from("claims")
    .select("stable_key,claim_text,evidence_state")
    .eq("brand_profile_id", profile.id);
  throwDatabaseError(storedClaimsError, "Unable to validate project evidence");
  const storedByKey = new Map((storedClaims ?? []).map((claim) => [claim.stable_key, claim]));
  if (storedByKey.size !== claims.length || claims.some((claim) => !storedByKey.has(claim.id))) {
    throw new Error("The submitted evidence set does not match the saved project.");
  }
  if ((status === "approved" || status === "campaign") && claims.some((claim) => !claim.approved)) {
    throw new Error("Every evidence claim must be approved before the campaign can advance.");
  }

  const approvedAt = status === "approved" || status === "campaign" ? new Date().toISOString() : null;
  const updates = claims.map((claim) => {
    const stored = storedByKey.get(claim.id)!;
    const evidenceState = claim.text === stored.claim_text ? stored.evidence_state : "ASSUMED";
    return client
      .from("claims")
      .update({
        claim_text: claim.text,
        evidence_state: evidenceState,
        approved: claim.approved,
        approved_by: claim.approved ? user.id : null,
        approved_at: claim.approved ? approvedAt : null,
      })
      .eq("brand_profile_id", profile.id)
      .eq("stable_key", claim.id);
  });
  const results = await Promise.all(updates);
  results.forEach(({ error }) => throwDatabaseError(error, "Unable to update claim approval"));

  const campaignStatus = status === "campaign" ? "draft_ready" : status;
  const { error: campaignError } = await client
    .from("campaigns")
    .update({
      status: campaignStatus,
      approved_at: approvedAt,
      generated_at: status === "campaign" ? new Date().toISOString() : null,
    })
    .eq("project_id", projectId);
  throwDatabaseError(campaignError, "Unable to update campaign status");

  const { error: projectError } = await client
    .from("projects")
    .update({ lifecycle_status: campaignStatus })
    .eq("id", projectId);
  throwDatabaseError(projectError, "Unable to update project status");
}

export function persistenceResponse(configured: boolean, result: PersistedAnalysisResult | null): JsonObject {
  return { configured, project: result };
}
