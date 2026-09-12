import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { assertSameOrigin } from "@/lib/request-security";
import { assertJobCanRetry } from "@/lib/fulfillment";
import type { JobRun } from "@/lib/types";

const bodySchema = z.object({
  workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  projectId: z.string().regex(/^[a-f0-9]{24}$/),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  action: z.enum(["retry", "cancel"]),
});

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await requireInternalAdmin();
    if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Admin operations are not configured.");
    const body = bodySchema.parse(await request.json());
    const db = getFirebaseAdminDb();
    const project = db.doc(`workspaces/${body.workspaceId}/projects/${body.projectId}`);
    const job = project.collection("jobs").doc(body.jobId);
    const now = new Date().toISOString();
    const data = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(job);
      if (!snapshot.exists) throw new Error("Job not found.");
      const current = snapshot.data() as JobRun;
      if (body.action === "retry") assertJobCanRetry(current);
      if (body.action === "cancel" && current.type === "provider_submission" && (current.dispatchStartedAt || current.needsHumanReview || (current.status === "running" && current.dispatchProtocolVersion !== 1))) {
        throw new Error("This job requires supplier reconciliation. Use supplier cancellation for an already submitted release.");
      }
      transaction.update(job, body.action === "retry"
        ? { status: "queued", failureCount: 0, lastError: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }
        : { status: "failed", lastError: "Canceled by an internal administrator.", updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      transaction.create(project.collection("auditLogs").doc(), { actorId: user.uid, action: `job.${body.action}`, targetId: body.jobId, createdAt: FieldValue.serverTimestamp() });
      return current;
    });
    return NextResponse.json({ job: { ...data, status: body.action === "retry" ? "queued" : "failed", updatedAt: now } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the job.";
    const status = error instanceof z.ZodError ? 400 : message === "Not found." || message === "Job not found." ? 404 : message.includes("Authentication") ? 401 : message.includes("Only") || message.includes("reconciliation") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
