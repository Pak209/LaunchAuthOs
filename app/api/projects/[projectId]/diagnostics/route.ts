import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { enqueueSiteDiagnosticJob, getSiteDiagnosticState, SiteDiagnosticJobError } from "@/lib/site-diagnostic-jobs";
import { assertSameOrigin } from "@/lib/request-security";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ authorized: z.literal(true) }).strict();

function failure(error: unknown) {
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
  const message = error instanceof Error ? error.message : "Unable to process site diagnostics.";
  const status = error instanceof SiteDiagnosticJobError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400
    : message === "Authentication required." ? 401 : message.includes("not configured") ? 503 : message === "Invalid request origin." ? 403 : 500;
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function contextFor(projectId: string) {
  if (!/^[a-f0-9]{24}$/.test(projectId)) throw new SiteDiagnosticJobError("Invalid project identifier.", 400);
  const { user } = await getAuthenticatedFirebaseContext();
  if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Background site diagnostics are not configured yet. Configure Firebase Admin and the job scheduler.");
  return { db: getFirebaseAdminDb(), uid: user.uid };
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const { db, uid } = await contextFor(projectId);
    return NextResponse.json(await getSiteDiagnosticState(db, uid, projectId), { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { db, uid } = await contextFor(projectId);
    const body = bodySchema.parse(await request.json());
    await enforceRateLimit(uid, "site-diagnostics", 5, 60);
    const job = await enqueueSiteDiagnosticJob(db, uid, projectId, body.authorized);
    return NextResponse.json({ job }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
