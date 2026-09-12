import { NextResponse } from "next/server";
import { z } from "zod";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { directoryOperationSchema, DirectoryOperationConflict, recordDirectoryOperation } from "@/lib/directory-fulfillment";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await requireInternalAdmin();
    if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Admin operations are not configured.");
    await enforceRateLimit(user.uid, "directory-operations", 40, 3_600);
    const input = directoryOperationSchema.parse(await request.json());
    const result = await recordDirectoryOperation(getFirebaseAdminDb(), user.uid, input);
    return NextResponse.json({ result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record the directory outcome.";
    const status = error instanceof RateLimitError ? 429 : error instanceof z.ZodError ? 400 : error instanceof DirectoryOperationConflict ? 409 : message.includes("Authentication") ? 401 : message === "Not found." ? 404 : message.includes("configured") ? 503 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store", ...(error instanceof RateLimitError ? { "retry-after": String(error.retryAfterSeconds) } : {}) } });
  }
}
