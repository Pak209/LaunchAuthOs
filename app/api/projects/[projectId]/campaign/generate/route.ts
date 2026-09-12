import { NextResponse } from "next/server";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { enqueueIntelligenceJob } from "@/lib/intelligence-jobs";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const { user } = await getAuthenticatedFirebaseContext();
    if (!isFirebaseAdminExplicitlyConfigured() || !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Background campaign generation is not configured yet. Configure Firebase Admin, OpenAI, and the job runner." }, { status: 503 });
    await enforceRateLimit(user.uid, "campaign-generate", 3, 3_600);
    const job = await enqueueIntelligenceJob(getFirebaseAdminDb(), user.uid, { type: "campaign_generation", projectId });
    return NextResponse.json({ job }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the campaign.";
    const status = error instanceof RateLimitError ? 429 : message.includes("Authentication") ? 401 : message.includes("access denied") ? 403 : message === "Project not found." ? 404 : message.includes("not configured") ? 503 : message.includes("approved") || message.includes("fulfillment order") || message.includes("current project job") ? 409 : 502;
    return NextResponse.json({ error: message }, { status, headers: error instanceof RateLimitError ? { "retry-after": String(error.retryAfterSeconds) } : undefined });
  }
}
