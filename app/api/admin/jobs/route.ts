import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { assertSameOrigin } from "@/lib/request-security";

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
    const snapshot = await job.get();
    if (!snapshot.exists) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const data = snapshot.data()!;
    if (body.action === "retry" && data.status !== "failed") throw new Error("Only failed jobs can be retried.");
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(job, body.action === "retry"
      ? { status: "queued", lastError: FieldValue.delete(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }
      : { status: "failed", lastError: "Canceled by an internal administrator.", updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
    batch.create(project.collection("auditLogs").doc(), { actorId: user.uid, action: `job.${body.action}`, targetId: body.jobId, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return NextResponse.json({ job: { ...data, status: body.action === "retry" ? "queued" : "failed", updatedAt: now } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the job.";
    const status = error instanceof z.ZodError ? 400 : message === "Not found." ? 404 : message.includes("Authentication") ? 401 : message.includes("Only") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
