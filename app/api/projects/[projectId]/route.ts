import { NextResponse } from "next/server";
import { z } from "zod";
import { loadProject, updateProjectCampaign } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { assertSameOrigin } from "@/lib/request-security";

const claimSchema = z.object({
  id: z.string().min(1).max(160),
  text: z.string().min(1).max(10_000),
  sourceUrl: z.string().url().max(2_048),
  state: z.enum(["VERIFIED", "INFERRED", "ASSUMED", "UNKNOWN"]),
  approved: z.boolean(),
  evidenceIds: z.array(z.string().min(1).max(160)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
  observedAt: z.string().datetime().optional(),
});
const findingSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(["product", "audience", "positioning", "founder", "milestone", "proof_point", "competitor"]),
  value: z.string().min(1).max(10_000),
  sourceUrl: z.string().url().max(2_048),
  evidenceId: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
  observedAt: z.string().datetime(),
});
const profileSchema = z.object({
  company: z.string().min(1).max(300),
  product: z.string().min(1).max(1_000),
  audience: z.string().min(1).max(10_000),
  positioning: z.string().min(1).max(10_000),
  sourceUrl: z.string().url().max(2_048),
  claims: z.array(claimSchema).max(100),
  findings: z.object({
    product: z.array(findingSchema).max(30),
    audience: z.array(findingSchema).max(30),
    positioning: z.array(findingSchema).max(30),
    founder: z.array(findingSchema).max(30),
    milestone: z.array(findingSchema).max(30),
    proof_point: z.array(findingSchema).max(30),
    competitor: z.array(findingSchema).max(30),
  }),
});
const bodySchema = z.object({
  profile: profileSchema,
  claims: z.array(claimSchema).min(1).max(100),
  status: z.enum(["evidence_review", "approved", "campaign"]),
});

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  if (!isFirebaseConfigured()) return NextResponse.json({ persistence: "local", project: null });
  try {
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const { db, user } = await getAuthenticatedFirebaseContext();
    const project = await loadProject(db, user, projectId);
    return project ? NextResponse.json({ project }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the project.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (!isFirebaseConfigured()) return NextResponse.json({ persistence: "local" });

  try {
    assertSameOrigin(request);
    const { projectId: rawProjectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(rawProjectId)) {
      return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    }
    const body = bodySchema.parse(await request.json());
    const { db, user } = await getAuthenticatedFirebaseContext();
    await updateProjectCampaign(db, user, rawProjectId, body.profile, body.claims, body.status);
    return NextResponse.json({ persistence: "saved", status: body.status === "campaign" ? "draft_ready" : body.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the project.";
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
