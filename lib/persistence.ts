import { createHash } from "node:crypto";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { BrandProfile, CampaignDraft, Claim, EvidenceSnapshot, FindingKind, GeneratedCampaignAsset, PersistedAnalysisResult, ProjectStatus, ProjectSummary } from "./types";

type StoredProject = {
  workspaceId: string;
  createdBy: string;
  name: string;
  url: string;
  lifecycleStatus: string;
  profile: PersistedAnalysisResult["profile"];
  readiness: PersistedAnalysisResult["readiness"];
  sources: NonNullable<PersistedAnalysisResult["sources"]>;
  claims: Claim[];
  campaignStatus: ProjectStatus;
  fetchedAt: string;
  updatedAtIso?: string;
};

function personalWorkspaceId(uid: string): string {
  return `personal_${uid}`;
}

function projectDocumentId(uid: string, url: string): string {
  return createHash("sha256").update(`${uid}:${url}`).digest("hex").slice(0, 24);
}

export async function ensureWorkspace(db: Firestore, user: User): Promise<string> {
  const workspaceId = personalWorkspaceId(user.uid);
  const workspaceRef = doc(db, "workspaces", workspaceId);
  const memberRef = doc(db, "workspaces", workspaceId, "members", user.uid);
  await setDoc(doc(db, "users", user.uid), {
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
  if ((await getDoc(memberRef)).exists()) return workspaceId;

  const batch = writeBatch(db);
  batch.set(workspaceRef, {
    name: "My Launch Workspace",
    createdBy: user.uid,
    billingStatus: "not_configured",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(memberRef, {
    userId: user.uid,
    role: "owner",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return workspaceId;
}

function storedToResult(projectId: string, data: StoredProject, campaign: CampaignDraft | null = null): PersistedAnalysisResult {
  const findings = data.profile.findings ?? Object.fromEntries(
    ["product", "audience", "positioning", "founder", "milestone", "proof_point", "competitor"].map((kind) => [kind, []]),
  ) as Record<FindingKind, []>;
  const sources = (data.sources ?? []).map((source): EvidenceSnapshot => {
    if (source.id) return source;
    const legacy = source as EvidenceSnapshot & { url: string; title: string; description: string };
    return {
      id: createHash("sha256").update(`${legacy.url}:${data.fetchedAt}`).digest("hex").slice(0, 24),
      url: legacy.url,
      title: legacy.title,
      description: legacy.description,
      excerpt: legacy.description,
      contentHash: createHash("sha256").update(legacy.description ?? "").digest("hex"),
      capturedAt: data.fetchedAt,
    };
  });
  return {
    projectId,
    persistence: "saved",
    campaignStatus: data.campaignStatus,
    profile: { ...data.profile, findings },
    readiness: data.readiness,
    sources,
    fetchedAt: data.fetchedAt,
    campaign,
  };
}

export async function persistAnalysis(
  db: Firestore,
  user: User,
  result: PersistedAnalysisResult,
): Promise<PersistedAnalysisResult> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectId = projectDocumentId(user.uid, result.profile.sourceUrl);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
  const now = new Date().toISOString();
  const stored: StoredProject = {
    workspaceId,
    createdBy: user.uid,
    name: result.profile.company,
    url: result.profile.sourceUrl,
    lifecycleStatus: "evidence_review",
    profile: result.profile,
    readiness: result.readiness,
    sources: result.sources ?? [],
    claims: result.profile.claims,
    campaignStatus: "evidence_review",
    fetchedAt: result.fetchedAt,
    updatedAtIso: now,
  };
  const batch = writeBatch(db);
  batch.set(projectRef, {
    ...stored,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(projectRef, "profiles", "current"), {
    ...result.profile,
    version: 1,
    updatedAt: serverTimestamp(),
  });
  for (const evidence of result.sources ?? []) {
    batch.set(doc(projectRef, "evidence", evidence.id), evidence, { merge: false });
  }
  for (const claim of result.profile.claims) {
    batch.set(doc(projectRef, "claims", claim.id), claim, { merge: true });
  }
  batch.set(doc(projectRef, "campaigns", "current"), {
    status: "evidence_review",
    approvedClaimIds: [],
    assetVersion: 0,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { ...result, projectId, persistence: "saved", campaignStatus: "evidence_review" };
}

export async function listProjects(db: Firestore, user: User): Promise<ProjectSummary[]> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectsQuery = query(
    collection(db, "workspaces", workspaceId, "projects"),
    orderBy("updatedAt", "desc"),
    limit(50),
  );
  const snapshot = await getDocs(projectsQuery);
  return snapshot.docs.map((project) => {
    const data = project.data() as StoredProject;
    return {
      id: project.id,
      name: data.name,
      url: data.url,
      campaignStatus: data.campaignStatus,
      updatedAt: data.updatedAtIso ?? data.fetchedAt,
    };
  });
}

export async function loadProject(db: Firestore, user: User, projectId: string): Promise<PersistedAnalysisResult | null> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
  const [snapshot, campaignSnapshot] = await Promise.all([
    getDoc(projectRef),
    getDoc(doc(projectRef, "campaigns", "current")),
  ]);
  if (!snapshot.exists()) return null;
  const campaignData = campaignSnapshot.data() as CampaignDraft | undefined;
  const campaign = campaignData?.assets?.length ? campaignData : null;
  return storedToResult(snapshot.id, snapshot.data() as StoredProject, campaign);
}

export async function loadLatestProject(db: Firestore, user: User): Promise<PersistedAnalysisResult | null> {
  const projects = await listProjects(db, user);
  return projects[0] ? loadProject(db, user, projects[0].id) : null;
}

export async function updateProjectCampaign(
  db: Firestore,
  user: User,
  projectId: string,
  profile: BrandProfile,
  claims: Claim[],
  status: ProjectStatus,
): Promise<void> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(projectRef);
    if (!snapshot.exists()) throw new Error("The project was not found.");
    const stored = snapshot.data() as StoredProject;
    const storedByKey = new Map(stored.claims.map((claim) => [claim.id, claim]));
    if (storedByKey.size !== claims.length || claims.some((claim) => !storedByKey.has(claim.id))) {
      throw new Error("The submitted evidence set does not match the saved project.");
    }
    if ((status === "approved" || status === "campaign") && claims.some((claim) => !claim.approved)) {
      throw new Error("Every evidence claim must be approved before the campaign can advance.");
    }
    const normalizedClaims = claims.map((claim) => {
      const original = storedByKey.get(claim.id)!;
      return {
        ...claim,
        sourceUrl: original.sourceUrl,
        evidenceIds: original.evidenceIds,
        observedAt: original.observedAt,
        state: claim.text === original.text ? claim.state : "ASSUMED" as const,
      };
    });
    const campaignStatus = status === "campaign" ? "draft_ready" : status;
    const normalizedProfile = { ...profile, sourceUrl: stored.url, claims: normalizedClaims };
    const updatedAtIso = new Date().toISOString();
    transaction.update(projectRef, {
      name: normalizedProfile.company,
      profile: normalizedProfile,
      claims: normalizedClaims,
      campaignStatus,
      lifecycleStatus: campaignStatus,
      approvedAt: status === "approved" || status === "campaign" ? updatedAtIso : null,
      generatedAt: status === "campaign" ? updatedAtIso : null,
      updatedAtIso,
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(projectRef, "profiles", "current"), {
      ...normalizedProfile,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    for (const claim of normalizedClaims) {
      transaction.set(doc(projectRef, "claims", claim.id), claim, { merge: true });
    }
    transaction.set(doc(projectRef, "campaigns", "current"), {
      status: campaignStatus,
      approvedClaimIds: normalizedClaims.filter((claim) => claim.approved).map((claim) => claim.id),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

function assertCampaignAssets(assets: GeneratedCampaignAsset[], stored: StoredProject) {
  const approvedIds = new Set(stored.claims.filter((claim) => claim.approved).map((claim) => claim.id));
  if (!approvedIds.size || stored.claims.some((claim) => !claim.approved)) {
    throw new Error("Every evidence claim must be approved before the campaign can change.");
  }
  if (!assets.length || assets.some((asset) => !asset.claimIds.length || asset.claimIds.some((id) => !approvedIds.has(id)))) {
    throw new Error("Every campaign asset must reference only approved evidence.");
  }
}

export async function saveGeneratedCampaign(
  db: Firestore,
  user: User,
  projectId: string,
  assets: GeneratedCampaignAsset[],
  model: string,
): Promise<CampaignDraft> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
  const campaignRef = doc(projectRef, "campaigns", "current");
  return runTransaction(db, async (transaction) => {
    const [projectSnapshot, campaignSnapshot] = await Promise.all([transaction.get(projectRef), transaction.get(campaignRef)]);
    if (!projectSnapshot.exists()) throw new Error("The project was not found.");
    const stored = projectSnapshot.data() as StoredProject;
    assertCampaignAssets(assets, stored);
    const current = campaignSnapshot.data() as Partial<CampaignDraft> | undefined;
    const now = new Date().toISOString();
    const draft: CampaignDraft = {
      version: (current?.version ?? 0) + 1,
      status: "draft",
      model,
      assets,
      generatedAt: now,
      updatedAt: now,
    };
    transaction.set(campaignRef, { ...draft, updatedAtServer: serverTimestamp() });
    transaction.set(doc(campaignRef, "versions", String(draft.version).padStart(6, "0")), { ...draft, createdAt: serverTimestamp() });
    transaction.update(projectRef, { campaignStatus: "draft_ready", lifecycleStatus: "draft_ready", generatedAt: now, updatedAtIso: now, updatedAt: serverTimestamp() });
    return draft;
  });
}

export async function saveCampaignRevision(
  db: Firestore,
  user: User,
  projectId: string,
  assets: GeneratedCampaignAsset[],
  status: "draft" | "approved",
): Promise<CampaignDraft> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
  const campaignRef = doc(projectRef, "campaigns", "current");
  return runTransaction(db, async (transaction) => {
    const [projectSnapshot, campaignSnapshot] = await Promise.all([transaction.get(projectRef), transaction.get(campaignRef)]);
    if (!projectSnapshot.exists() || !campaignSnapshot.exists()) throw new Error("Generate the campaign before editing it.");
    const stored = projectSnapshot.data() as StoredProject;
    assertCampaignAssets(assets, stored);
    const current = campaignSnapshot.data() as CampaignDraft;
    const now = new Date().toISOString();
    const draft: CampaignDraft = {
      version: (current.version ?? 0) + 1,
      status,
      model: current.model,
      assets: assets.map((asset) => ({ ...asset, status })),
      generatedAt: current.generatedAt,
      updatedAt: now,
    };
    transaction.set(campaignRef, { ...draft, updatedAtServer: serverTimestamp() });
    transaction.set(doc(campaignRef, "versions", String(draft.version).padStart(6, "0")), { ...draft, createdAt: serverTimestamp() });
    transaction.update(projectRef, { campaignStatus: status === "approved" ? "campaign_approved" : "draft_ready", lifecycleStatus: status === "approved" ? "campaign_approved" : "draft_ready", updatedAtIso: now, updatedAt: serverTimestamp() });
    return draft;
  });
}

export function persistenceResponse(
  configured: boolean,
  result: PersistedAnalysisResult | null,
  projects: ProjectSummary[] = [],
) {
  return { configured, project: result, projects };
}
