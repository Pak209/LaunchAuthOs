import { randomUUID } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { runSiteDiagnostics } from "./site-diagnostics";
import type { SiteDiagnosticReport } from "./site-diagnostic-types";
import { parsePublicHttpUrl } from "./url-security";

export type SiteDiagnosticJob = {
  id: string;
  projectId: string;
  url: string;
  status: "queued" | "scheduled" | "running" | "completed" | "failed" | "superseded";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  message?: string;
};
type StoredJob = SiteDiagnosticJob & {
  userId: string;
  workspaceId: string;
  authorizedBy: string;
  authorizedAt: string;
  runToken?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
};
export type SiteDiagnosticState = { job: SiteDiagnosticJob | null; report: SiteDiagnosticReport | null };
type Dependencies = { run?: typeof runSiteDiagnostics; now?: () => number; limit?: number };
const activeStatuses = new Set(["queued", "scheduled", "running"]);
const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;
const uuid = /^[a-f0-9-]{36}$/;

export class SiteDiagnosticJobError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) { super(message); }
}

function references(db: Firestore, uid: string, projectId: string) {
  if (!/^[^/\u0000-\u001f]{1,128}$/.test(uid) || !/^[a-f0-9]{24}$/.test(projectId)) throw new SiteDiagnosticJobError("Invalid project identifier.", 400);
  const workspaceId = `personal_${uid}`;
  const workspace = db.doc(`workspaces/${workspaceId}`);
  return {
    workspaceId, workspace, project: workspace.collection("projects").doc(projectId),
    member: workspace.collection("members").doc(uid),
    request: workspace.collection("siteDiagnosticRequests").doc(projectId),
    latest: workspace.collection("siteDiagnosticLatest").doc(projectId),
  };
}

async function readAccess(transaction: Transaction, target: ReturnType<typeof references>, uid: string, writable: boolean) {
  const [memberSnapshot, projectSnapshot] = await Promise.all([transaction.get(target.member), transaction.get(target.project)]);
  const member = memberSnapshot.data();
  const roles = writable ? ["owner", "admin", "member"] : ["owner", "admin", "member", "viewer"];
  if (member?.userId !== uid || !roles.includes(String(member.role))) throw new SiteDiagnosticJobError("Workspace access denied.", 403);
  const project = projectSnapshot.data();
  if (!project || project.createdBy !== uid || project.workspaceId !== target.workspaceId) throw new SiteDiagnosticJobError("Project not found.", 404);
  return project;
}

function publicJob(job: StoredJob): SiteDiagnosticJob {
  const { id, projectId, url, status, attempts, createdAt, updatedAt, message } = job;
  return { id, projectId, url, status, attempts, createdAt, updatedAt, ...(message ? { message } : {}) };
}

function validateJob(job: StoredJob, target: ReturnType<typeof references>, uid: string, projectId: string, expectedId: string) {
  if (job.id !== expectedId || job.userId !== uid || job.workspaceId !== target.workspaceId || job.projectId !== projectId || job.authorizedBy !== uid) {
    throw new SiteDiagnosticJobError("Diagnostic job ownership could not be verified.", 409);
  }
}

export async function enqueueSiteDiagnosticJob(db: Firestore, uid: string, projectId: string, authorized: boolean, now = Date.now()): Promise<SiteDiagnosticJob> {
  if (authorized !== true) throw new SiteDiagnosticJobError("Confirm authorization to inspect this public customer site.", 400);
  const target = references(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    const project = await readAccess(transaction, target, uid, true);
    const url = parsePublicHttpUrl(String(project.url)).href;
    const request = await transaction.get(target.request);
    const previousId = request.data()?.jobId;
    if (previousId !== undefined) {
      if (typeof previousId !== "string" || !uuid.test(previousId)) throw new SiteDiagnosticJobError("Diagnostic request history needs review.", 409);
      const previous = (await transaction.get(target.workspace.collection("siteDiagnosticJobs").doc(previousId))).data() as StoredJob | undefined;
      if (!previous) throw new SiteDiagnosticJobError("Diagnostic request history needs review.", 409);
      validateJob(previous, target, uid, projectId, previousId);
      if (activeStatuses.has(previous.status)) return publicJob(previous);
    }
    const timestamp = new Date(now).toISOString();
    const job: StoredJob = {
      id: randomUUID(), projectId, workspaceId: target.workspaceId, userId: uid, url,
      authorizedBy: uid, authorizedAt: timestamp, status: "queued", attempts: 0,
      createdAt: timestamp, updatedAt: timestamp,
    };
    transaction.create(target.workspace.collection("siteDiagnosticJobs").doc(job.id), job);
    transaction.set(target.request, { jobId: job.id });
    // Observations are independent of an order: never edit the project's facts,
    // approved campaign, attestation, or frozen fulfillment records here.
    return publicJob(job);
  });
}

export async function getSiteDiagnosticState(db: Firestore, uid: string, projectId: string): Promise<SiteDiagnosticState> {
  const target = references(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    await readAccess(transaction, target, uid, false);
    const [request, latest] = await Promise.all([transaction.get(target.request), transaction.get(target.latest)]);
    const jobId = request.data()?.jobId;
    let job: SiteDiagnosticJob | null = null;
    if (jobId !== undefined) {
      if (typeof jobId !== "string" || !uuid.test(jobId)) throw new SiteDiagnosticJobError("Diagnostic request history needs review.", 409);
      const stored = (await transaction.get(target.workspace.collection("siteDiagnosticJobs").doc(jobId))).data() as StoredJob | undefined;
      if (!stored) throw new SiteDiagnosticJobError("Diagnostic request history needs review.", 409);
      validateJob(stored, target, uid, projectId, jobId);
      job = publicJob(stored);
    }
    const reportId = latest.data()?.reportId;
    let report: SiteDiagnosticReport | null = null;
    if (reportId !== undefined) {
      if (typeof reportId !== "string" || !uuid.test(reportId)) throw new SiteDiagnosticJobError("Diagnostic report history needs review.", 409);
      const stored = (await transaction.get(target.project.collection("siteDiagnosticReports").doc(reportId))).data();
      if (!stored || stored.userId !== uid || stored.workspaceId !== target.workspaceId || stored.projectId !== projectId || stored.jobId !== reportId || !stored.report) {
        throw new SiteDiagnosticJobError("Diagnostic report ownership could not be verified.", 409);
      }
      report = stored.report as SiteDiagnosticReport;
    }
    return { job, report };
  });
}

async function currentContext(db: Firestore, transaction: Transaction, job: StoredJob, ref: DocumentReference) {
  const target = references(db, job.userId, job.projectId);
  if (!uuid.test(job.id) || ref.path !== target.workspace.collection("siteDiagnosticJobs").doc(job.id).path) throw new SiteDiagnosticJobError("Diagnostic job ownership could not be verified.", 409);
  validateJob(job, target, job.userId, job.projectId, job.id);
  const project = await readAccess(transaction, target, job.userId, true);
  const request = await transaction.get(target.request);
  return { target, unchanged: parsePublicHttpUrl(String(project.url)).href === job.url && request.data()?.jobId === job.id };
}

async function claim(db: Firestore, ref: DocumentReference, now: number) {
  return db.runTransaction(async (transaction) => {
    const job = (await transaction.get(ref)).data() as StoredJob | undefined;
    if (!job || job.status !== "queued") return null;
    const current = await currentContext(db, transaction, job, ref);
    if (!current.unchanged) {
      transaction.update(ref, { status: "superseded", updatedAt: new Date(now).toISOString(), message: "The saved site URL or request changed. Start a new diagnostic after reviewing the project." });
      return null;
    }
    const claimed: StoredJob = { ...job, status: "running", attempts: job.attempts + 1, runToken: randomUUID(), leaseExpiresAt: new Date(now + LEASE_MS).toISOString(), updatedAt: new Date(now).toISOString() };
    transaction.update(ref, claimed);
    return claimed;
  });
}

async function commitReport(db: Firestore, ref: DocumentReference, job: StoredJob, report: SiteDiagnosticReport, now: number) {
  if (report.version !== 1 || report.targetUrl !== job.url || !report.id || !Number.isFinite(Date.parse(report.createdAt)) || !Number.isFinite(Date.parse(report.completedAt))) throw new Error("Diagnostic output did not match the authorized request.");
  const encoded = JSON.stringify(report);
  if (Buffer.byteLength(encoded) > 800_000) throw new Error("Diagnostic output exceeds the bounded storage limit.");
  const safeReport = JSON.parse(encoded) as SiteDiagnosticReport;
  await db.runTransaction(async (transaction) => {
    const stored = (await transaction.get(ref)).data() as StoredJob | undefined;
    if (!stored || stored.status !== "running" || stored.runToken !== job.runToken) return;
    const current = await currentContext(db, transaction, job, ref);
    if (!current.unchanged) {
      transaction.update(ref, { status: "superseded", updatedAt: new Date(now).toISOString(), message: "The saved site URL or request changed during this diagnostic. The old result was not applied." });
      return;
    }
    const reportRef = current.target.project.collection("siteDiagnosticReports").doc(job.id);
    if ((await transaction.get(reportRef)).exists) throw new Error("An immutable diagnostic report already exists.");
    transaction.create(reportRef, { userId: job.userId, workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.id, report: safeReport, createdAt: FieldValue.serverTimestamp() });
    transaction.set(current.target.latest, { reportId: job.id });
    transaction.update(ref, { status: "completed", updatedAt: new Date(now).toISOString(), message: "The diagnostic report is saved. Index inclusion was not independently checked." });
  });
}

export async function runQueuedSiteDiagnosticJobs(db: Firestore, dependencies: Dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const [running, scheduled] = await Promise.all([
    db.collectionGroup("siteDiagnosticJobs").where("status", "==", "running").limit(100).get(),
    db.collectionGroup("siteDiagnosticJobs").where("status", "==", "scheduled").limit(100).get(),
  ]);
  let diagnosticsRecovered = 0;
  for (const snapshot of [...running.docs, ...scheduled.docs]) {
    const recovered = await db.runTransaction(async (transaction) => {
      const job = (await transaction.get(snapshot.ref)).data() as StoredJob | undefined;
      if (!job) return false;
      const time = now();
      const due = job.status === "running" ? !job.leaseExpiresAt || !(Date.parse(job.leaseExpiresAt) > time)
        : job.status === "scheduled" && (!job.nextAttemptAt || !(Date.parse(job.nextAttemptAt) > time));
      if (!due) return false;
      const failed = job.attempts >= MAX_ATTEMPTS;
      transaction.update(snapshot.ref, { status: failed ? "failed" : "queued", updatedAt: new Date(time).toISOString(), message: failed ? "Diagnostic attempts exhausted. Previous reports are preserved; start a new check or contact support." : "Resuming saved site diagnostics." });
      return true;
    });
    if (recovered) diagnosticsRecovered++;
  }
  const queued = await db.collectionGroup("siteDiagnosticJobs").where("status", "==", "queued").limit(Math.min(Math.max(dependencies.limit ?? 1, 1), 2)).get();
  let diagnosticsProcessed = 0;
  await Promise.all(queued.docs.map(async (snapshot) => {
    let job: StoredJob | null = null;
    try {
      job = await claim(db, snapshot.ref, now());
      if (!job) return;
      diagnosticsProcessed++;
      const report = await (dependencies.run ?? runSiteDiagnostics)(job.url);
      await commitReport(db, snapshot.ref, job, report, now());
    } catch {
      await db.runTransaction(async (transaction) => {
        const stored = (await transaction.get(snapshot.ref)).data() as StoredJob | undefined;
        if (!stored || (job ? stored.status !== "running" || stored.runToken !== job.runToken : stored.status !== "queued")) return;
        const failed = !job || stored.attempts >= MAX_ATTEMPTS;
        transaction.update(snapshot.ref, {
          status: failed ? "failed" : "scheduled", updatedAt: new Date(now()).toISOString(),
          nextAttemptAt: new Date(now() + 30_000 * stored.attempts).toISOString(),
          message: failed ? "This diagnostic could not finish. Check workspace access and the saved public URL before retrying. Previous reports are preserved."
            : "A diagnostic attempt was interrupted. A bounded retry is scheduled; previous reports are preserved.",
        });
      });
    }
  }));
  return { diagnosticsProcessed, diagnosticsRecovered };
}
