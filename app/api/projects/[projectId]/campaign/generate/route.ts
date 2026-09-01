import { NextResponse } from "next/server";
import { generateCampaignAssets } from "@/lib/campaign";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { loadProject, saveGeneratedCampaign } from "@/lib/persistence";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const { db, user } = await getAuthenticatedFirebaseContext();
    await enforceRateLimit(user.uid, "campaign-generate", 3, 3_600);
    const project = await loadProject(db, user, projectId);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const generated = await generateCampaignAssets(project.profile, project.profile.claims, user.uid);
    const campaign = await saveGeneratedCampaign(db, user, projectId, generated.assets, generated.model);
    return NextResponse.json({ campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the campaign.";
    const status = error instanceof RateLimitError ? 429 : message.includes("Authentication") ? 401 : message.includes("not configured") ? 503 : message.includes("approved") ? 409 : 502;
    return NextResponse.json({ error: message }, { status, headers: error instanceof RateLimitError ? { "retry-after": String(error.retryAfterSeconds) } : undefined });
  }
}
