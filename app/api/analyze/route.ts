import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeCompany } from "@/lib/analyze";
import { persistAnalysis } from "@/lib/persistence";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2_048) });

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await analyzeCompany(body.url);
    if (!isFirebaseConfigured()) {
      return NextResponse.json({ ...result, persistence: "local" });
    }

    try {
      const { db, user } = await getAuthenticatedFirebaseContext();
      return NextResponse.json(await persistAnalysis(db, user, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this analysis.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this URL.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
