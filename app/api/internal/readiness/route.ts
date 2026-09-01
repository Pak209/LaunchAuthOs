import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { paidReadiness } from "@/lib/readiness";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.JOB_RUNNER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(paidReadiness(), { headers: { "cache-control": "no-store" } });
}
