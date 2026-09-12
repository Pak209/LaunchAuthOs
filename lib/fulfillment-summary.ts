import type { FulfillmentState, Placement } from "./types";

/** Normalize a link for rendering/deduplication, without claiming it was verified. */
export function publicEvidenceLink(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

function observedTime(placement: Placement): number {
  const values = [placement.lastVerifiedAt, placement.lastObservedAt, placement.removedAt, placement.publishedAt, placement.submittedAt];
  return Math.max(0, ...values.map((value) => Date.parse(value ?? "")).filter(Number.isFinite));
}

export function summarizeFulfillment(state: FulfillmentState | null) {
  const byUrl = new Map<string, Placement>();
  // A duplicate observation must never inflate publication totals. Prefer the
  // latest observation; adverse states win ties rather than hiding a removal.
  const priority = { submitted: 0, accepted: 1, published: 2, indexed: 3, failed: 4, removed: 5 };
  for (const placement of state?.placements ?? []) {
    const url = publicEvidenceLink(placement.url);
    if (!url) continue;
    const prior = byUrl.get(url);
    if (!prior || observedTime(placement) > observedTime(prior)
      || (observedTime(placement) === observedTime(prior) && priority[placement.state] > priority[prior.state])) {
      byUrl.set(url, { ...placement, url });
    }
  }
  const placements = [...byUrl.values()].sort((a, b) => observedTime(b) - observedTime(a) || a.url.localeCompare(b.url));
  const counts = { published: 0, indexed: 0, accepted: 0, submitted: 0, failed: 0, removed: 0 };
  for (const item of placements) counts[item.state]++;
  const verification = state?.jobs.find((job) => job.type === "placement_verification");
  const monitoring = !verification ? "Not started" : verification.status === "failed" ? "Needs attention"
    : verification.status === "complete" ? "Stopped" : verification.status === "blocked" ? "Blocked"
      : verification.status === "running" ? "Checking URLs" : "Scheduled";
  return {
    placements, counts,
    publicationCount: counts.published + counts.indexed,
    directoryCount: new Set((state?.directories ?? []).filter((item) => item.status === "published").map((item) => publicEvidenceLink(item.listingUrl)).filter(Boolean)).size,
    monitoring,
    sandbox: state?.order?.sandbox === true || state?.order?.nonBillable === true,
    verificationProblems: placements.filter((item) => Boolean(item.lastVerificationError)).length,
  };
}
