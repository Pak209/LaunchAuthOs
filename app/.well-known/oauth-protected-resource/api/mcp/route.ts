import { configFromEnv, metadata } from "@/lib/customer-mcp/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(metadata(configFromEnv()), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "Customer integration unavailable." }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
