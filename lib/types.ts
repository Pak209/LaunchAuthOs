export type EvidenceState = "VERIFIED" | "INFERRED" | "ASSUMED" | "UNKNOWN";

export type FindingKind = "product" | "audience" | "positioning" | "founder" | "milestone" | "proof_point" | "competitor";

export type EvidenceSnapshot = {
  id: string;
  url: string;
  title: string;
  description: string;
  excerpt: string;
  contentHash: string;
  capturedAt: string;
};

export type StructuredFinding = {
  id: string;
  kind: FindingKind;
  value: string;
  sourceUrl: string;
  evidenceId: string;
  confidence: number;
  observedAt: string;
};

export type Claim = {
  id: string;
  text: string;
  sourceUrl: string;
  state: EvidenceState;
  approved: boolean;
  evidenceIds?: string[];
  confidence?: number;
  observedAt?: string;
};

export type BrandProfile = {
  company: string;
  product: string;
  audience: string;
  positioning: string;
  sourceUrl: string;
  claims: Claim[];
  findings: Record<FindingKind, StructuredFinding[]>;
};

export type AnalysisResult = {
  profile: BrandProfile;
  readiness: {
    score: number;
    label: string;
    rationale: string[];
    missingInformation: string[];
    strongestStoryAngle: string;
  };
  sources?: EvidenceSnapshot[];
  fetchedAt: string;
};

export type ProjectStatus = "evidence_review" | "approved" | "campaign" | "draft_ready" | "campaign_approved" | "awaiting_payment" | "fulfillment";

export type PersistedAnalysisResult = AnalysisResult & {
  projectId?: string;
  persistence?: "local" | "saved";
  campaignStatus?: ProjectStatus;
  campaign?: CampaignDraft | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  url: string;
  campaignStatus: ProjectStatus;
  updatedAt: string;
};

export type CampaignAssetType = "press_release" | "headlines" | "founder_quotes" | "boilerplate" | "social_posts" | "directory_copy" | "faq" | "structured_data";

export type GeneratedCampaignAsset = {
  id: string;
  type: CampaignAssetType;
  title: string;
  content: string;
  claimIds: string[];
  status: "draft" | "approved";
};

export type CampaignDraft = {
  version: number;
  status: "draft" | "approved";
  model: string;
  assets: GeneratedCampaignAsset[];
  generatedAt: string;
  updatedAt: string;
};

export type ProviderOrderStatus = "quote_ready" | "awaiting_payment" | "paid" | "submitted" | "processing" | "published" | "failed" | "canceled" | "refunded";
export type DirectorySubmissionStatus = "needs_customer" | "ready_for_human" | "submitted" | "accepted" | "published" | "failed";

export type ProviderOrder = {
  id: string;
  provider: string;
  sandbox: boolean;
  nonBillable: boolean;
  providerCostCents: number;
  currency: string;
  selectedPackageId?: "launch" | "authority" | "authority_plus";
  distributionDetails?: { country: string; city: string; categories: string[]; contactName: string; contactEmail: string };
  providerPlan?: string;
  requiredCredits?: number;
  submissionInput?: import("./provider").ProviderSubmissionInput;
  providerSubmissionStartedAt?: string;
  campaignVersion: number;
  campaignDigest: string;
  status: ProviderOrderStatus;
  externalId?: string;
  checkoutAttempt?: number;
  stripeCheckoutSessionId?: string;
  expectedStripeLivemode?: boolean;
  stripeLivemode?: boolean;
  stripePaymentIntentId?: string;
  expectedPackageId?: "launch" | "authority" | "authority_plus";
  expectedPriceId?: string;
  expectedAmountSubtotal?: number;
  expectedCurrency?: string;
  billingStatus?: "awaiting_payment" | "paid" | "partially_refunded" | "refunded";
  amountSubtotal?: number;
  amountTotal?: number;
  refundedAmountCents?: number;
  refundedAt?: string;
  providerStatusReason?: string;
  providerPackageOutcomes?: Array<{ package: string; state: string; creditsRefunded?: number; reason?: string }>;
  providerSubmissionUncertain?: boolean;
  packageId?: "launch" | "authority" | "authority_plus";
  createdAt: string;
  updatedAt: string;
};

export type DirectorySubmission = {
  id: string;
  directory: string;
  mode: "assisted" | "manual" | "editorial";
  status: DirectorySubmissionStatus;
  requiredActions: string[];
  createdAt: string;
  updatedAt: string;
};

export type JobRun = {
  id: string;
  type: "provider_submission" | "directory_submission" | "placement_verification" | "customer_email";
  status: "blocked" | "scheduled" | "queued" | "running" | "complete" | "failed";
  attempts: number;
  failureCount?: number;
  idempotencyKey: string;
  blockedReason?: string;
  lastError?: string;
  needsHumanReview?: boolean;
  dispatchStartedAt?: string;
  dispatchProtocolVersion?: 1;
  runToken?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentState = {
  order: ProviderOrder | null;
  directories: DirectorySubmission[];
  jobs: JobRun[];
  placements?: Placement[];
};

export type Placement = {
  id: string;
  outlet: string;
  url: string;
  state: "submitted" | "accepted" | "published" | "indexed" | "failed" | "removed";
  submittedAt?: string;
  publishedAt?: string;
  firstVerifiedAt?: string;
  lastVerifiedAt?: string;
  lastObservedAt?: string;
  providerState?: "published" | "indexed";
  lastHttpStatus?: number;
  lastVerificationError?: string;
  removedAt?: string;
};
