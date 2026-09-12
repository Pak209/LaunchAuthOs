import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignHistoryError, listCampaignVersions, readCampaignVersion, restoreCampaignVersion } from "@/lib/campaign-history";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
const version = z.number().int().min(1).max(999_999);
const restoreBody = z.object({ version, expectedVersion: z.number().int().min(0).max(999_999), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict();
type RouteContext = { params: Promise<{ projectId: string }> };

function errorResponse(error: unknown) {
  if (error instanceof CampaignHistoryError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof RateLimitError) return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) } });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid campaign history request." }, { status: 400, headers });
  if (error instanceof Error && error.message === "Authentication required.") return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (error instanceof Error && error.message === "Invalid request origin.") return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  return NextResponse.json({ error: "Campaign history is temporarily unavailable. Please try again." }, { status: 503, headers });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) throw new CampaignHistoryError("Invalid project identifier.", 400);
    const { user } = await getAuthenticatedFirebaseContext();
    if (!isFirebaseAdminExplicitlyConfigured()) return NextResponse.json({ error: "Campaign history is not configured yet." }, { status: 503, headers });
    await enforceRateLimit(user.uid, "campaign-history-read", 120, 60);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["version", "beforeVersion"].includes(key)) || query.getAll("version").length > 1 || query.getAll("beforeVersion").length > 1 || (query.has("version") && query.has("beforeVersion"))) throw new CampaignHistoryError("Invalid campaign history request.", 400);
    const selected = query.has("version") ? version.parse(Number(query.get("version"))) : undefined;
    const beforeVersion = query.has("beforeVersion") ? version.parse(Number(query.get("beforeVersion"))) : undefined;
    const db = getFirebaseAdminDb();
    const result = selected === undefined ? await listCampaignVersions(db, user.uid, projectId, beforeVersion) : await readCampaignVersion(db, user.uid, projectId, selected);
    return NextResponse.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) throw new CampaignHistoryError("Invalid project identifier.", 400);
    const { user } = await getAuthenticatedFirebaseContext();
    if (!isFirebaseAdminExplicitlyConfigured()) return NextResponse.json({ error: "Campaign history is not configured yet." }, { status: 503, headers });
    await enforceRateLimit(user.uid, "campaign-history-restore", 10, 3_600);
    const raw = await request.text();
    if (raw.length > 2_048) throw new CampaignHistoryError("Invalid campaign history request.", 400);
    const body = restoreBody.parse(JSON.parse(raw));
    const campaign = await restoreCampaignVersion(getFirebaseAdminDb(), user.uid, projectId, body);
    return NextResponse.json({ campaign }, { headers });
  } catch (error) { return errorResponse(error); }
}
