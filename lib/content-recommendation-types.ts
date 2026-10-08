import { z } from "zod";
import type { BrandProfile, CampaignDraft, Claim, EvidenceSnapshot } from "./types";

export const CONTENT_RECOMMENDATION_IDS = ["product-explanation", "customer-faq", "proof-about"] as const;
export const CONTENT_EVIDENCE_FRESHNESS_DAYS = 30 as const;

export type ContentRecommendationContext = {
  projectUrl: string;
  profile: BrandProfile;
  claims: Claim[];
  sources: EvidenceSnapshot[];
  campaign: CampaignDraft | null;
};

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = text(160);
export const recommendationFieldsSchema = z.object({
  id: z.enum(CONTENT_RECOMMENDATION_IDS),
  title: text(200),
  audience: text(1_000),
  question: text(1_000),
  destination: text(2_048),
  publicationOwner: z.string().trim().max(300),
  rationale: text(2_000),
  body: text(4_000),
  intendedAction: text(1_000),
  claimIds: z.array(identifier).max(100).refine((ids) => new Set(ids).size === ids.length, "Claim references must be unique."),
}).strict();
export type RecommendationFields = z.infer<typeof recommendationFieldsSchema>;

export const contentRecommendationEditSchema = z.object({
  revision: z.number().int().min(1).max(999_999),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  recommendations: z.array(recommendationFieldsSchema).min(1).max(6)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Recommendation identifiers must be unique."),
}).strict();

export type ContentRecommendationPlan = {
  schemaVersion: 1;
  revision: number;
  status: "draft" | "approved";
  createdAt: string;
  updatedAt: string;
  sourceDigest: string;
  campaignVersion: number | null;
  recommendations: RecommendationFields[];
  approvedAt: string | null;
};
export type ContentClaimIssue = { claimId: string; eligible: boolean; issues: string[] };
export type ContentEvidenceView = {
  eligibleClaims: Claim[];
  gaps: string[];
  sources: EvidenceSnapshot[];
  freshnessDays: 30;
  claimIssues: ContentClaimIssue[];
};
export type EvidenceView = ContentEvidenceView;
export type ContentRecommendationState = {
  plan: ContentRecommendationPlan | null;
  currentDigest: string;
  evidence: ContentEvidenceView;
  currentCampaignVersion: number | null;
  stale: boolean;
  canEdit: boolean;
  history: Array<{ revision: number; status: "draft" | "approved"; updatedAt: string }>;
};

// The context comes from tenant-checked records, never from the mutation body.
// Keep malformed dates/hashes readable here so evaluation can explain which
// evidence is unusable instead of silently dropping the affected claim.
const claimSchema = z.object({
  id: identifier, text: text(10_000), sourceUrl: text(2_048),
  state: z.enum(["VERIFIED", "INFERRED", "ASSUMED", "UNKNOWN"]), approved: z.boolean(),
  evidenceIds: z.array(identifier).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(), observedAt: z.string().max(100).optional(),
});
const sourceSchema = z.object({
  id: identifier, url: text(2_048), title: z.string().max(10_000),
  description: z.string().max(30_000), excerpt: z.string().max(30_000),
  contentHash: z.string().max(128), capturedAt: z.string().max(100),
});
const findingSchema = z.object({
  id: identifier, kind: z.enum(["product", "audience", "positioning", "founder", "milestone", "proof_point", "competitor"]),
  value: text(10_000), sourceUrl: text(2_048), evidenceId: identifier,
  confidence: z.number().min(0).max(1), observedAt: z.string().max(100),
});
const findings = z.array(findingSchema).max(30);
export const contentRecommendationContextSchema = z.object({
  projectUrl: text(2_048),
  profile: z.object({
    company: text(300), product: text(1_000), audience: text(10_000), positioning: text(10_000), sourceUrl: text(2_048),
    claims: z.array(claimSchema).max(100),
    findings: z.object({ product: findings, audience: findings, positioning: findings, founder: findings, milestone: findings, proof_point: findings, competitor: findings }),
  }),
  claims: z.array(claimSchema).max(100),
  sources: z.array(sourceSchema).max(100),
  campaign: z.object({
    version: z.number().int().min(1).max(999_999), status: z.enum(["draft", "approved"]),
    model: text(200), generatedAt: z.string().datetime(), updatedAt: z.string().datetime(),
    assets: z.array(z.object({
      id: identifier, type: z.enum(["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"]),
      title: text(200), content: text(30_000), claimIds: z.array(identifier).max(100), status: z.enum(["draft", "approved"]),
    })).max(8),
  }).nullable(),
});
