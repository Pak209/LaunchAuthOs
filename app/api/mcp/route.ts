import { getAuth } from "firebase-admin/auth";
import { getApp } from "firebase-admin/app";
import { configFromEnv, remoteKeys } from "@/lib/customer-mcp/auth";
import { handleMcp } from "@/lib/customer-mcp/http";
import { CustomerStore } from "@/lib/customer-mcp/store";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const config = configFromEnv();
    return await handleMcp(request, config, remoteKeys(config), new CustomerStore(getFirebaseAdminDb(), async uid => !(await getAuth(getApp("launch-auth-admin")).getUser(uid)).disabled));
  } catch { return Response.json({ error: "Customer integration unavailable." }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
export const GET = POST;
export const DELETE = POST;
