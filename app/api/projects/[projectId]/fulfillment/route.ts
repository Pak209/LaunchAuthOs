import { NextResponse } from "next/server";
import { z } from "zod";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { loadFulfillmentState, prepareFulfillment } from "@/lib/fulfillment";
import { loadProject } from "@/lib/persistence";
import { getDistributionProvider } from "@/lib/provider";
import { assertSameOrigin } from "@/lib/request-security";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { providerReleaseFromCampaign } from "@/lib/fulfillment";

export const runtime = "nodejs";

const distributionSchema = z.object({
  packageId: z.enum(["launch", "authority", "authority_plus"]),
  country: z.string().trim().min(2).max(120),
  city: z.string().trim().min(1).max(120),
  categories: z.array(z.string().trim().min(2).max(120)).min(1).max(5),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254),
});

async function contextFor(projectId: string) {
  if (!/^[a-f0-9]{24}$/.test(projectId)) throw new Error("Invalid project identifier.");
  const { db, user } = await getAuthenticatedFirebaseContext();
  const project = await loadProject(db, user, projectId);
  if (!project) throw new Error("Project not found.");
  if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Server-controlled fulfillment is not configured yet.");
  return { adminDb: getFirebaseAdminDb(), user, project };
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const { adminDb, user } = await contextFor(projectId);
    return NextResponse.json({ fulfillment: await loadFulfillmentState(adminDb, user.uid, projectId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load fulfillment.";
    const status = message.includes("Authentication") ? 401 : message.includes("not configured") ? 503 : message.includes("Invalid") ? 400 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { adminDb, user, project } = await contextFor(projectId);
    await enforceRateLimit(user.uid, "fulfillment-prepare", 5, 60);
    if (!project.campaign) throw new Error("Generate and approve the campaign before preparing fulfillment.");
    const { packageId, ...details } = distributionSchema.parse(await request.json());
    if (project.campaign.status !== "approved") throw new Error("Approve the campaign before preparing fulfillment.");
    providerReleaseFromCampaign(project.campaign);
    const existing = await loadFulfillmentState(adminDb, user.uid, projectId);
    if (existing.order) return NextResponse.json({ fulfillment: existing });
    const provider = getDistributionProvider();
    await provider.validate(details);
    const quote = await provider.quote(packageId);
    const fulfillment = await prepareFulfillment(adminDb, user.uid, projectId, project.campaign, quote, details, packageId);
    return NextResponse.json({ fulfillment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare fulfillment.";
    if (error instanceof RateLimitError) return NextResponse.json({ error: message }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    const status = error instanceof z.ZodError ? 400 : message.includes("Authentication") ? 401 : message.includes("not configured") || message.includes("disabled") ? 503 : message.includes("Approve") || message.includes("approve") || message.includes("Generate") ? 409 : message.includes("Invalid") || message.includes("Choose") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
