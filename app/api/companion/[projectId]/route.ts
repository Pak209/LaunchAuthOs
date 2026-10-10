import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { CompanionService } from "@/lib/companion/service";
import { AccessError } from "@/lib/customer-mcp/auth";
import { deleteCompanionProject } from "@/lib/companion/deletion";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
async function service() {
  const { user } = await getAuthenticatedFirebaseContext();
  if (!isFirebaseAdminExplicitlyConfigured()) throw new AccessError(503, "Saved briefs are unavailable until server storage is configured. Use the local practice flow or export your work.");
  return { uid: user.uid, store: new CompanionService(getFirebaseAdminDb()) };
}
function failure(error: unknown) {
  const status = error instanceof AccessError ? error.status : error instanceof z.ZodError ? 400 : error instanceof Error && error.message === "Authentication required." ? 401 : 503;
  return Response.json({ error: error instanceof AccessError ? error.message : status === 400 ? "Invalid content. Check limits and remove credentials." : status === 401 ? "Sign in to save or resume your brief." : "Unable to save or load. Your edits remain in this page." }, { status, headers });
}
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try { const { uid, store } = await service(); return Response.json(await store.read(uid, (await context.params).projectId), { headers }); } catch (e) { return failure(e); }
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new AccessError(400, "Missing request.");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 160000) { await reader.cancel(); throw new AccessError(413, "Request exceeds 160 KB."); } chunks.push(value); }
  const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); } catch { throw new AccessError(400, "Invalid JSON."); }
}
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const origin = request.headers.get("origin"), expected = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : new URL(request.url).origin;
    if (origin !== expected || !request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError(403, "Invalid request origin or content type.");
    const { uid, store } = await service(), id = (await context.params).projectId;
    const { action, payload } = z.object({ action: z.enum(["create", "brief", "facts", "draft", "approve", "archive", "delete", "delete_account"]), payload: z.unknown() }).strict().parse(await boundedBody(request));
    if (action === "delete_account") throw new AccessError(409, "Account deletion is unavailable until paid-order, approval/report retention and identity/provider handling are decided. No account deletion was queued or performed; project deletion does not erase account or backup data.");
    const result = action === "delete" ? await deleteCompanionProject(getFirebaseAdminDb(), uid, id, payload) : action === "archive" ? await store.archive(uid, id, payload) : action === "create" || action === "brief" ? await store.saveBrief(uid, id, payload, action === "create") : action === "facts" ? await store.approveFacts(uid, id, payload) : action === "draft" ? await store.saveDraft(uid, id, payload) : await store.approveCampaign(uid, id, payload);
    return Response.json(result, { headers });
  } catch (e) { return failure(e); }
}
