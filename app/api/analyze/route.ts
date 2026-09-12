import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeCompany } from "@/lib/analyze";
import { ensureWorkspace } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { clientRateLimitKey, enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { enqueueIntelligenceJob } from "@/lib/intelligence-jobs";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2_048) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = requestSchema.parse(await request.json());
    if (!isFirebaseConfigured()) {
      await enforceRateLimit(clientRateLimitKey(request), "analyze-local", 5, 60);
      const result = await analyzeCompany(body.url);
      return NextResponse.json({ ...result, persistence: "local" });
    }

    const { db, user } = await getAuthenticatedFirebaseContext();
    if (!isFirebaseAdminExplicitlyConfigured()) return NextResponse.json({ error: "Background intelligence is not configured yet. Configure Firebase Admin and the job runner before starting analysis." }, { status: 503 });
    await enforceRateLimit(user.uid, "analyze", 10, 60);
    await ensureWorkspace(db, user);
    const job = await enqueueIntelligenceJob(getFirebaseAdminDb(), user.uid, { type: "analysis", url: body.url });
    return NextResponse.json({ job }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this URL.";
    if (error instanceof RateLimitError) return NextResponse.json({ error: message }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
