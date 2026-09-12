import { NextResponse } from "next/server";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { listIntelligenceJobs } from "@/lib/intelligence-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isFirebaseConfigured()) return NextResponse.json({ jobs: [] });
    const { user } = await getAuthenticatedFirebaseContext();
    if (!isFirebaseAdminExplicitlyConfigured()) return NextResponse.json({ jobs: [], configured: false });
    const id = new URL(request.url).searchParams.get("id") ?? undefined;
    if (id && !/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid job identifier." }, { status: 400 });
    const jobs = await listIntelligenceJobs(getFirebaseAdminDb(), user.uid, id);
    return NextResponse.json({ jobs }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load background work.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : message.includes("access denied") ? 403 : 500 });
  }
}
