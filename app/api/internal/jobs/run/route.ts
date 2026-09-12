import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { runQueuedFulfillmentJobs } from "@/lib/fulfillment";
import { getDistributionProvider } from "@/lib/provider";
import { getTransactionalEmailProvider } from "@/lib/email";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.JOB_RUNNER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const result = await runQueuedFulfillmentJobs(getFirebaseAdminDb(), getDistributionProvider, getTransactionalEmailProvider());
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
