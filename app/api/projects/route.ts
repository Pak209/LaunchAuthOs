import { NextResponse } from "next/server";
import { loadLatestProject, persistenceResponse } from "@/lib/persistence";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json(persistenceResponse(false, null));

  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(persistenceResponse(true, await loadLatestProject(client)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load projects.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

