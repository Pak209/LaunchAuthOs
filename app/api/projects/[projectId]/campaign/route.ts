import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { attestCampaignApproval } from "@/lib/campaign-approval";
import { saveCampaignRevision } from "@/lib/persistence";
import { assertSameOrigin } from "@/lib/request-security";

const assetSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum(["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(30_000),
  claimIds: z.array(z.string().min(1).max(160)).min(1).max(100),
  status: z.enum(["draft", "approved"]),
});
const bodySchema = z.object({ assets: z.array(assetSchema).length(8), status: z.enum(["draft", "approved"]) });

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const body = bodySchema.parse(await request.json());
    if (body.status === "approved" && !isFirebaseAdminExplicitlyConfigured()) {
      throw new Error("Server-controlled campaign approval is not configured yet.");
    }
    const { db, user } = await getAuthenticatedFirebaseContext();
    const campaign = await saveCampaignRevision(db, user, projectId, body.assets, body.status);
    if (body.status === "approved") await attestCampaignApproval(getFirebaseAdminDb(), user.uid, projectId, campaign);
    return NextResponse.json({ campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the campaign.";
    const status = error instanceof z.ZodError ? 400 : message.includes("Authentication") ? 401 : message.includes("not configured") ? 503 : message.includes("approved") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
