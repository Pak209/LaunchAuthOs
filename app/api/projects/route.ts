import { NextResponse } from "next/server";
import { listProjects, loadProject, persistenceResponse } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isFirebaseConfigured()) return NextResponse.json(persistenceResponse(false, null));

  try {
    const { db, user } = await getAuthenticatedFirebaseContext();
    const projects = await listProjects(db, user);
    const latest = projects[0] ? await loadProject(db, user, projects[0].id) : null;
    return NextResponse.json(persistenceResponse(true, latest, projects));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load projects.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 500 });
  }
}
