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
import type { Claim, PersistedAnalysisResult, ProjectStatus } from "./types";

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
};

function personalWorkspaceId(uid: string): string {
  return `personal_${uid}`;
}

function projectDocumentId(uid: string, url: string): string {
  return createHash("sha256").update(`${uid}:${url}`).digest("hex").slice(0, 24);
}

async function ensureWorkspace(db: Firestore, user: User): Promise<string> {
  const workspaceId = personalWorkspaceId(user.uid);
  const workspaceRef = doc(db, "workspaces", workspaceId);
  const memberRef = doc(db, "workspaces", workspaceId, "members", user.uid);
  if ((await getDoc(memberRef)).exists()) return workspaceId;

  const batch = writeBatch(db);
  batch.set(workspaceRef, {
    name: "My Launch Workspace",
    createdBy: user.uid,
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

export async function persistAnalysis(
  db: Firestore,
  user: User,
  result: PersistedAnalysisResult,
): Promise<PersistedAnalysisResult> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectId = projectDocumentId(user.uid, result.profile.sourceUrl);
  const projectRef = doc(db, "workspaces", workspaceId, "projects", projectId);
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
  };
  await setDoc(projectRef, {
    ...stored,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { ...result, projectId, persistence: "saved", campaignStatus: "evidence_review" };
}

export async function loadLatestProject(db: Firestore, user: User): Promise<PersistedAnalysisResult | null> {
  const workspaceId = await ensureWorkspace(db, user);
  const projectsQuery = query(
    collection(db, "workspaces", workspaceId, "projects"),
    orderBy("updatedAt", "desc"),
    limit(1),
  );
  const snapshot = await getDocs(projectsQuery);
  const project = snapshot.docs[0];
  if (!project) return null;
  const data = project.data() as StoredProject;
  return {
    projectId: project.id,
    persistence: "saved",
    campaignStatus: data.campaignStatus,
    profile: { ...data.profile, claims: data.claims },
    readiness: data.readiness,
    sources: data.sources,
    fetchedAt: data.fetchedAt,
  };
}

export async function updateProjectCampaign(
  db: Firestore,
  user: User,
  projectId: string,
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
        state: claim.text === original.text ? original.state : "ASSUMED" as const,
      };
    });
    const campaignStatus = status === "campaign" ? "draft_ready" : status;
    transaction.update(projectRef, {
      claims: normalizedClaims,
      "profile.claims": normalizedClaims,
      campaignStatus,
      lifecycleStatus: campaignStatus,
      approvedAt: status === "approved" || status === "campaign" ? new Date().toISOString() : null,
      generatedAt: status === "campaign" ? new Date().toISOString() : null,
      updatedAt: serverTimestamp(),
    });
  });
}

export function persistenceResponse(configured: boolean, result: PersistedAnalysisResult | null) {
  return { configured, project: result };
}
