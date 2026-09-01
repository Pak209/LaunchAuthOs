import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeCompany } from "@/lib/analyze";
import { persistAnalysis } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { clientRateLimitKey, enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

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
    await enforceRateLimit(user.uid, "analyze", 10, 60);
    const result = await analyzeCompany(body.url);
    try {
      return NextResponse.json(await persistAnalysis(db, user, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this analysis.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this URL.";
    if (error instanceof RateLimitError) return NextResponse.json({ error: message }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
