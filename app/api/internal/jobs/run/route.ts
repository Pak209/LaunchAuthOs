import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { runQueuedFulfillmentJobs } from "@/lib/fulfillment";
import { getDistributionProvider } from "@/lib/provider";
import { getTransactionalEmailProvider } from "@/lib/email";
import { runQueuedIntelligenceJobs } from "@/lib/intelligence-jobs";
import { runQueuedSiteDiagnosticJobs } from "@/lib/site-diagnostic-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.JOB_RUNNER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const db = getFirebaseAdminDb();
    const [fulfillment, intelligence, diagnostics] = await Promise.allSettled([
      Promise.resolve().then(() => runQueuedFulfillmentJobs(db, getDistributionProvider, getTransactionalEmailProvider())),
      runQueuedIntelligenceJobs(db),
      runQueuedSiteDiagnosticJobs(db),
    ]);
    // Await every group even on a partial failure: returning early can terminate
    // unrelated in-flight work on request-scoped production runtimes.
    const errors = [fulfillment, intelligence, diagnostics].flatMap((result, index) => result.status === "rejected" ? [{ worker: ["fulfillment", "intelligence", "diagnostics"][index], message: result.reason instanceof Error ? result.reason.message : "Worker failed." }] : []);
    return NextResponse.json({
      ...(fulfillment.status === "fulfilled" ? fulfillment.value : {}),
      ...(intelligence.status === "fulfilled" ? intelligence.value : {}),
      ...(diagnostics.status === "fulfilled" ? diagnostics.value : {}),
      ...(errors.length ? { errors } : {}),
    }, { status: errors.length ? 500 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
