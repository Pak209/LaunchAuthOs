export type EvidenceState = "VERIFIED" | "INFERRED" | "ASSUMED" | "UNKNOWN";

export type Claim = {
  id: string;
  text: string;
  sourceUrl: string;
  state: EvidenceState;
  approved: boolean;
};

export type BrandProfile = {
  company: string;
  product: string;
  audience: string;
  positioning: string;
  sourceUrl: string;
  claims: Claim[];
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
  sources?: Array<{ url: string; title: string; description: string }>;
  fetchedAt: string;
};

export type ProjectStatus = "evidence_review" | "approved" | "campaign" | "draft_ready";

export type PersistedAnalysisResult = AnalysisResult & {
  projectId?: string;
  persistence?: "local" | "saved";
  campaignStatus?: ProjectStatus;
};
