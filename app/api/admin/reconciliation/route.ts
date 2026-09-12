import { NextResponse } from "next/server";
import { z } from "zod";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getDistributionProvider } from "@/lib/provider";
import { reconciliationSchema, reconcileProviderSubmission, ReconciliationConflict } from "@/lib/provider-reconciliation";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await requireInternalAdmin();
    if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Admin operations are not configured.");
    await enforceRateLimit(user.uid, "provider-reconciliation", 20, 3_600);
    const input = reconciliationSchema.parse(await request.json());
    const result = await reconcileProviderSubmission(getFirebaseAdminDb(), user.uid, input, getDistributionProvider);
    return NextResponse.json({ result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reconciliation failed.";
    const status = error instanceof RateLimitError ? 429 : error instanceof z.ZodError ? 400 : error instanceof ReconciliationConflict ? 409 : message.includes("Authentication") ? 401 : message === "Not found." ? 404 : message.includes("configured") ? 503 : 400;
    return NextResponse.json({ error: message }, { status, headers: error instanceof RateLimitError ? { "retry-after": String(error.retryAfterSeconds) } : undefined });
  }
}
