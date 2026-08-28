import { NextResponse } from "next/server";
import { z } from "zod";
import { updateProjectCampaign } from "@/lib/persistence";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const claimSchema = z.object({
  id: z.string().min(1).max(160),
  text: z.string().min(1).max(10_000),
  sourceUrl: z.string().url().max(2_048),
  state: z.enum(["VERIFIED", "INFERRED", "ASSUMED", "UNKNOWN"]),
  approved: z.boolean(),
});
const bodySchema = z.object({
  claims: z.array(claimSchema).min(1).max(100),
  status: z.enum(["evidence_review", "approved", "campaign"]),
});

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ persistence: "local" });

  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = Number(rawProjectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    }
    const body = bodySchema.parse(await request.json());
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    await updateProjectCampaign(client, user, projectId, body.claims, body.status);
    return NextResponse.json({ persistence: "saved", status: body.status === "campaign" ? "draft_ready" : body.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the project.";
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
