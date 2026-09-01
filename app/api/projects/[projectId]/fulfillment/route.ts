import { NextResponse } from "next/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { loadFulfillmentState, prepareFulfillment } from "@/lib/fulfillment";
import { loadProject } from "@/lib/persistence";
import { getDistributionProvider } from "@/lib/provider";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

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
    if (!project.campaign) throw new Error("Generate and approve the campaign before preparing fulfillment.");
    const quote = await getDistributionProvider().quote();
    const fulfillment = await prepareFulfillment(adminDb, user.uid, projectId, project.campaign, quote);
    return NextResponse.json({ fulfillment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare fulfillment.";
    const status = message.includes("Authentication") ? 401 : message.includes("not configured") ? 503 : message.includes("Approve") || message.includes("approve") || message.includes("Generate") ? 409 : message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
