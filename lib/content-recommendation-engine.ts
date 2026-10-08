import { createHash } from "node:crypto";
import { z } from "zod";
import { CONTENT_EVIDENCE_FRESHNESS_DAYS, type ContentEvidenceView, type ContentRecommendationContext, type ContentRecommendationPlan, type RecommendationFields } from "./content-recommendation-types";
import type { Claim, EvidenceSnapshot, FindingKind } from "./types";
import { parsePublicHttpUrl } from "./url-security";

const DAY_MS = 86_400_000;
const timestamp = z.iso.datetime({ offset: true });
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
const normalizedClaim = (claim: Claim) => ({ ...claim, evidenceIds: [...new Set(claim.evidenceIds ?? [])].sort() });

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

// Evidence list order is not a content edit. Text, review state, source hashes,
// capture dates, and same-version campaign edits all invalidate the binding.
export function contextDigest(context: ContentRecommendationContext): string {
  const value = {
    ...context,
    profile: {
      ...context.profile,
      claims: byId(context.profile.claims.map(normalizedClaim)),
      findings: Object.fromEntries(Object.entries(context.profile.findings).map(([kind, items]) => [kind, byId(items)])),
    },
    claims: byId(context.claims.map(normalizedClaim)),
    sources: byId(context.sources),
    campaign: context.campaign ? {
      ...context.campaign,
      assets: byId(context.campaign.assets.map((asset) => ({ ...asset, claimIds: [...new Set(asset.claimIds)].sort() }))),
    } : null,
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function publicUrl(value: string): string | null {
  try { return parsePublicHttpUrl(value).href; } catch { return null; }
}

function sourceIssues(source: EvidenceSnapshot, now: number): string[] {
  const issues: string[] = [];
  if (!publicUrl(source.url)) issues.push("the source URL is not a supported public HTTP(S) URL");
  if (!/^[a-f0-9]{64}$/i.test(source.contentHash)) issues.push("the source snapshot has no intact SHA-256 content hash");
  if (!source.excerpt.trim()) issues.push("the source snapshot has no readable evidence excerpt");
  if (!timestamp.safeParse(source.capturedAt).success || !Number.isFinite(Date.parse(source.capturedAt))) {
    issues.push("the source capture date is invalid");
  } else {
    const age = now - Date.parse(source.capturedAt);
    if (age < 0) issues.push("the source capture date is in the future");
    else if (age > CONTENT_EVIDENCE_FRESHNESS_DAYS * DAY_MS) issues.push(`the source is older than ${CONTENT_EVIDENCE_FRESHNESS_DAYS} days; refresh and review it`);
  }
  return issues;
}

export function evaluateContentEvidence(context: ContentRecommendationContext, now = Date.now()): ContentEvidenceView {
  if (!Number.isFinite(now)) throw new Error("A valid evidence evaluation time is required.");
  const sourceCounts = new Map<string, number>();
  const claimCounts = new Map<string, number>();
  for (const source of context.sources) sourceCounts.set(source.id, (sourceCounts.get(source.id) ?? 0) + 1);
  for (const claim of context.claims) claimCounts.set(claim.id, (claimCounts.get(claim.id) ?? 0) + 1);
  const sources = new Map(context.sources.map((source) => [source.id, source]));
  const eligibleClaims: Claim[] = [];
  const claimIssues = byId(context.claims).map((claim) => {
    const issues: string[] = [];
    if (claimCounts.get(claim.id) !== 1) issues.push("Duplicate claim identifier; repair the evidence record.");
    if (!claim.approved) issues.push("The customer has not approved this claim.");
    if (claim.state === "UNKNOWN") issues.push("The claim's evidence state is UNKNOWN; substantiate it before use.");
    if (!claim.text.trim()) issues.push("The claim has no factual text to review.");
    const sourceUrl = publicUrl(claim.sourceUrl);
    if (!sourceUrl) issues.push("The claim source URL is not a supported public HTTP(S) URL.");
    const evidenceIds = [...new Set(claim.evidenceIds ?? [])];
    if (!evidenceIds.length) issues.push("The claim has no source snapshot references.");
    const referenced: EvidenceSnapshot[] = [];
    for (const id of evidenceIds) {
      const source = sources.get(id);
      if (!source) { issues.push(`Source ${id} is missing.`); continue; }
      if (sourceCounts.get(id) !== 1) { issues.push(`Source ${id} has a duplicate identifier.`); continue; }
      referenced.push(source);
      for (const issue of sourceIssues(source, now)) issues.push(`Source ${id}: ${issue}.`);
    }
    if (sourceUrl && referenced.length && !referenced.some((source) => publicUrl(source.url) === sourceUrl)) {
      issues.push("No referenced source snapshot matches the claim's source URL.");
    }
    const eligible = issues.length === 0;
    if (eligible) {
      eligibleClaims.push(claim);
      if (claim.state === "INFERRED" || claim.state === "ASSUMED") {
        issues.push(`Recorded state is ${claim.state}, not independently verified. The owner must substantiate the exact wording during factual review.`);
      }
    }
    return { claimId: claim.id, eligible, issues };
  });
  const gaps = claimIssues.flatMap((entry) => entry.issues.map((issue) => `Claim ${entry.claimId}: ${issue}`));
  if (!eligibleClaims.length) gaps.unshift("No current customer-approved, source-linked claims are available. Refresh evidence and review factual claims before approving a brief.");
  return { eligibleClaims, gaps, sources: byId(context.sources), freshnessDays: CONTENT_EVIDENCE_FRESHNESS_DAYS, claimIssues };
}

function claimsFor(context: ContentRecommendationContext, eligible: Claim[], kinds: FindingKind[]): Claim[] {
  const preferredSources = new Set(kinds.flatMap((kind) => context.profile.findings[kind].map((finding) => finding.evidenceId)));
  const ordered = [...eligible].sort((left, right) => {
    const preferred = (claim: Claim) => Number(claim.evidenceIds?.some((id) => preferredSources.has(id)) ?? false);
    return preferred(right) - preferred(left) || left.id.localeCompare(right.id);
  });
  let remaining = 2_200;
  const selected: Claim[] = [];
  for (const claim of ordered) {
    const size = claim.text.length + claim.id.length + 100;
    if (size > remaining) continue; // Never cut a factual statement into a different claim.
    selected.push(claim);
    remaining -= size;
    if (selected.length === 3) break;
  }
  return selected;
}

function factualExcerpt(claims: Claim[]): string {
  return claims.length
    ? "Customer-approved statements to review for relevance (recorded states, not independent verification):\n\n" + claims.map((claim) => `[${claim.id}; ${claim.state}]\n${claim.text}`).join("\n\n")
    : "Evidence gap: no approved statement fits this bounded brief. Review or create a concise, source-linked claim before approval. Do not fill this gap with invented facts.";
}

export function buildContentRecommendations(context: ContentRecommendationContext, now = Date.now()): RecommendationFields[] {
  const { eligibleClaims } = evaluateContentEvidence(context, now);
  const audience = `Suggested audience from the editable profile; confirm before publishing: ${context.profile.audience.slice(0, 800)}`;
  const product = claimsFor(context, eligibleClaims, ["product", "audience", "positioning"]);
  const faq = claimsFor(context, eligibleClaims, ["product", "audience"]);
  const proof = claimsFor(context, eligibleClaims, ["founder", "milestone", "proof_point"]);
  return [
    {
      id: "product-explanation", title: "Explain the product and the next customer step", audience,
      question: "What does this product do, who is it for, and what should an interested customer do next?",
      destination: "/product — suggested destination; confirm the actual customer-owned page",
      publicationOwner: "", rationale: "A focused explanation can help a visitor understand the offer and decide whether to continue. This is an editorial recommendation, not a ranking or citation prediction.",
      body: `Owner-editable brief, not publication-ready copy.\n\nWrite a direct opening answer to the page's question. Organize only relevant approved facts into: what the product does, the intended customer, and how to take the next step. Do not invent features, pricing, compatibility or results.\n\n${factualExcerpt(product)}\n\nOwner to complete: confirm the audience and actual page; substantiate each quoted statement; supply approved evidence for missing details; specify a working next-step link.`,
      intendedAction: "Choose one verified next step, such as a product tour, sign-up or contact link; confirm its destination before publication.",
      claimIds: product.map((claim) => claim.id),
    },
    {
      id: "customer-faq", title: "Answer a prospective customer's concrete questions", audience,
      question: "What should a prospective customer know before deciding whether to use this product?",
      destination: "/faq — suggested destination; confirm whether a new page or an existing section is appropriate",
      publicationOwner: "", rationale: "Use short, factual answers to real customer questions. Questions are editorial suggestions until validated with customer input; an FAQ format does not guarantee search enhancements or AI citations.",
      body: `Owner-editable brief, not publication-ready copy.\n\nSelect real customer questions. Suggested prompts: What does the product do? Who is it intended for? How can someone get started? Answer only questions supported by the approved excerpts below. Leave unsupported pricing, privacy, integration and performance questions open for evidence review.\n\n${factualExcerpt(faq)}\n\nOwner to complete: validate the questions, map each answer to its claim IDs, add evidence for unanswered questions, and check the next-step link.`,
      intendedAction: "Help the reader make an informed decision or contact the team about an unanswered question; choose and verify the actual link.",
      claimIds: faq.map((claim) => claim.id),
    },
    {
      id: "proof-about", title: "Make the company's supporting evidence inspectable", audience: "Prospective customers evaluating the company's identity and the basis for its factual statements.",
      question: "Who is behind the product, and what documented evidence supports the statements made about it?",
      destination: "/about or /evidence — suggested alternatives; choose an actual customer-owned destination",
      publicationOwner: "", rationale: "A transparent explanation of the company and its supporting sources lets readers inspect the basis of a statement. Recorded claim approval is not external endorsement, editorial coverage or independent verification.",
      body: `Owner-editable brief, not publication-ready copy.\n\nIntroduce only source-backed identity, founder or milestone information that is relevant and authorized for publication. Connect each factual statement to a readable source and date. If those facts are unavailable, keep them as evidence requests rather than inventing an origin story, testimonial or endorsement.\n\n${factualExcerpt(proof)}\n\nOwner to complete: remove irrelevant excerpts, verify public source links and permission, add substantiation where needed, and name the person responsible for keeping the page current.`,
      intendedAction: "Let a reader inspect public supporting sources or contact the responsible team member; do not publish private workspace evidence without permission.",
      claimIds: proof.map((claim) => claim.id),
    },
  ];
}

function markdownText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1");
}
function literalBlock(value: string): string {
  // Fence length exceeds every backtick run in customer-controlled content.
  const longest = Math.max(2, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${value}\n${fence}`;
}

export function briefMarkdown(plan: ContentRecommendationPlan, context: ContentRecommendationContext): string {
  if (contextDigest(context) !== plan.sourceDigest) throw new Error("This brief must be exported with its matching saved evidence context.");
  const claims = new Map(context.claims.map((claim) => [claim.id, claim]));
  const sources = new Map(context.sources.map((source) => [source.id, source]));
  const lines = [
    "# Customer-site content briefs", "",
    `Revision: ${plan.revision} · Review status: ${plan.status}`, `Created: ${markdownText(plan.createdAt)}`, `Updated: ${markdownText(plan.updatedAt)}`,
    `Approved at: ${plan.approvedAt ? markdownText(plan.approvedAt) : "Not approved"}`,
    `Campaign version: ${plan.campaignVersion ?? "No campaign"}`, `Evidence context digest: ${plan.sourceDigest}`, "",
    "These are owner-reviewed implementation briefs, not published pages. Draft revisions are not approved for implementation. Approval does not independently verify the claims or authorize Launch Auth to publish. No rankings, indexing, traffic or AI citations are guaranteed.", "",
    "Evidence was captured at the dates below. Recheck freshness and permissions before implementation; a saved approval does not keep aging evidence current.", "",
  ];
  for (const item of plan.recommendations) {
    lines.push(`## ${markdownText(item.title)}`, "", `Brief ID: ${item.id}`, `Audience: ${markdownText(item.audience)}`, `Question: ${markdownText(item.question)}`, `Destination: ${markdownText(item.destination)}`, `Publication owner: ${item.publicationOwner ? markdownText(item.publicationOwner) : "Unassigned — required before approval"}`, `Rationale: ${markdownText(item.rationale)}`, `Intended customer action: ${markdownText(item.intendedAction)}`, "", "### Editable implementation brief", "", literalBlock(item.body), "", "### Factual references", "");
    if (!item.claimIds.length) lines.push("No factual references selected. Supply approved evidence before approval.", "");
    for (const claimId of item.claimIds) {
      const claim = claims.get(claimId);
      if (!claim) { lines.push(`Claim ${markdownText(claimId)}: missing from the saved evidence context.`, ""); continue; }
      lines.push(`Claim ${markdownText(claim.id)} — recorded state: ${claim.state}; customer-approved: ${claim.approved ? "yes" : "no"}.`, "", literalBlock(claim.text), "", `Recorded source URL: ${markdownText(claim.sourceUrl)}`, "");
      for (const sourceId of [...new Set(claim.evidenceIds ?? [])]) {
        const source = sources.get(sourceId);
        if (!source) { lines.push(`Source ${markdownText(sourceId)}: missing from the saved evidence context.`, ""); continue; }
        lines.push(`Source ID: ${markdownText(source.id)}`, `Source URL: ${markdownText(source.url)}`, `Captured at: ${markdownText(source.capturedAt)}`, `Snapshot content hash (SHA-256): ${markdownText(source.contentHash)}`, "");
      }
    }
  }
  return lines.join("\n");
}
