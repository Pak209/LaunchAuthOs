import { NextResponse } from "next/server";
import { loadLatestProject, persistenceResponse } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isFirebaseConfigured()) return NextResponse.json(persistenceResponse(false, null));

  try {
    const { db, user } = await getAuthenticatedFirebaseContext();
    return NextResponse.json(persistenceResponse(true, await loadLatestProject(db, user)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load projects.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 500 });
  }
}
