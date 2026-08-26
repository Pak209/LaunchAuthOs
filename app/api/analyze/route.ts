import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeCompany } from "@/lib/analyze";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2_048) });

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    return NextResponse.json(await analyzeCompany(body.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this URL.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
