import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeCompany } from "@/lib/analyze";
import { persistAnalysis } from "@/lib/persistence";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2_048) });

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await analyzeCompany(body.url);
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ...result, persistence: "local" });
    }

    try {
      const client = await createClient();
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      return NextResponse.json(await persistAnalysis(client, user, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this analysis.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this URL.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
