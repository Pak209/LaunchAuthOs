import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getDistributionProvider } from "@/lib/provider";

const packageSchema = z.enum(["launch", "authority", "authority_plus"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireInternalAdmin();
    const packageId = packageSchema.parse(new URL(request.url).searchParams.get("packageId") ?? "launch");
    const result = await getDistributionProvider().preflight(packageId);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to test the distribution provider.";
    const status = error instanceof z.ZodError ? 400 : message === "Not found." ? 404 : message.includes("Authentication") ? 401 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
