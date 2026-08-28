import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (isSupabaseConfigured()) {
    const client = await createClient();
    await client.auth.signOut();
  }
  return NextResponse.redirect(new URL(isSupabaseConfigured() ? "/login" : "/", request.url), { status: 303 });
}

