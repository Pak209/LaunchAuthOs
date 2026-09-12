import { NextResponse } from "next/server";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { loadFulfillmentState } from "@/lib/fulfillment";
import { loadProject } from "@/lib/persistence";

export const runtime = "nodejs";

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "launch-auth";
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const { db, user } = await getAuthenticatedFirebaseContext();
    const project = await loadProject(db, user, projectId);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const fulfillment = isFirebaseAdminExplicitlyConfigured() ? await loadFulfillmentState(getFirebaseAdminDb(), user.uid, projectId) : { order: null, directories: [], jobs: [], placements: [] };
    const report = {
      generatedAt: new Date().toISOString(),
      company: project.profile.company,
      sourceUrl: project.profile.sourceUrl,
      readiness: project.readiness,
      evidenceSnapshots: project.sources ?? [],
      approvedClaims: project.profile.claims.filter((claim) => claim.approved),
      campaign: project.campaign,
      fulfillment,
    };
    if (new URL(request.url).searchParams.get("format") !== "markdown") return NextResponse.json({ report });
    const lines = [
      `# ${report.company} — Authority Evidence Report`, "", `Generated: ${report.generatedAt}`, `Primary source: ${report.sourceUrl}`, "",
      `## Readiness`, "", `${report.readiness.score}/100 — ${report.readiness.label}`, "",
      "## Approved claims", "", ...report.approvedClaims.flatMap((claim) => [`- ${claim.text}`, `  - Source: ${claim.sourceUrl}`, `  - Evidence: ${(claim.evidenceIds ?? []).join(", ") || "legacy source"}`]), "",
      "## Evidence snapshots", "", ...report.evidenceSnapshots.map((source) => `- ${source.title || source.url} — ${source.url} — captured ${source.capturedAt} — SHA-256 ${source.contentHash}`), "",
      "## Campaign assets", "", ...(report.campaign?.assets.map((asset) => `- ${asset.title} — ${asset.status} — evidence ${asset.claimIds.join(", ")}`) ?? ["- No generated campaign assets"]), "",
      "## Fulfillment", "", `Provider order: ${report.fulfillment.order?.status ?? "not prepared"}`, ...report.fulfillment.directories.map((item) => `- ${item.directory}: ${item.status} — ${item.listingUrl ?? item.submissionUrl ?? "No URL recorded"} — ${item.evidenceSource === "operator_recorded" ? "operator-recorded, not independently verified" : "awaiting operator evidence"} — updated ${item.updatedAt}`), "",
      "## Placements", "", ...(report.fulfillment.placements?.map((placement) => `- ${placement.outlet}: ${placement.state} — ${placement.url}`) ?? []),
      "", "## Measurement limitations", "", "HTTP checks establish URL availability, not content accuracy or earned editorial coverage. Indexed states are supplier-reported, not independently checked. Directory outcomes are recorded by a human operator. No independent backlink, search ranking, or AI visibility measurements are included.",
    ];
    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${safeFilename(report.company)}-authority-report.md"`, "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the report.";
    return NextResponse.json({ error: message }, { status: message.includes("Authentication") ? 401 : 500 });
  }
}
