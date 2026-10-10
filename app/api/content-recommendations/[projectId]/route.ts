import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { ContentRecommendationService } from "@/lib/content-recommendations";
import { AccessError } from "@/lib/customer-mcp/auth";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
async function service() { const { user } = await getAuthenticatedFirebaseContext(); if (!isFirebaseAdminExplicitlyConfigured()) throw new AccessError(503, "Storage unavailable."); return { uid: user.uid, store: new ContentRecommendationService(getFirebaseAdminDb()) }; }
function failure(e: unknown) { const status = e instanceof AccessError ? e.status : e instanceof z.ZodError ? 400 : e instanceof Error && e.message === "Authentication required." ? 401 : 503; return Response.json({ error: e instanceof AccessError ? e.message : status === 401 ? "Sign in to review recommendations." : "Unable to load or save recommendations." }, { status, headers }); }
export async function GET(_r: Request, context: { params: Promise<{ projectId: string }> }) { try { const { uid, store } = await service(); return Response.json(await store.read(uid, (await context.params).projectId), { headers }); } catch (e) { return failure(e); } }
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
    if (request.headers.get("origin") !== expected || !request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError(403, "Invalid request origin or content type.");
    const { uid, store } = await service(); const reader = request.body?.getReader(); if (!reader) throw new AccessError(400, "Missing body.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 32000) { await reader.cancel(); throw new AccessError(413, "Request too large."); } chunks.push(value); }
    const raw = new Uint8Array(size); let offset = 0; for (const c of chunks) { raw.set(c, offset); offset += c.length; }
    let body: unknown; try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { throw new AccessError(400, "Invalid JSON."); }
    return Response.json(await store.save(uid, (await context.params).projectId, body), { headers });
  } catch (e) { return failure(e); }
}
