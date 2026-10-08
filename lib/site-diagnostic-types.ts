/** Versioned, serializable observations. These records never establish search-index inclusion. */
export type SiteDiagnosticResult = "pass" | "issue" | "not_checked" | "not_applicable";
export type SiteDiagnosticAgent = "LaunchAuthBot" | "Googlebot" | "Bingbot";
export type SiteDiagnosticCheck = "accessibility" | "redirects" | "robots_rules" | "meta_robots" | "header_robots" | "indexability" | "canonical" | "sitemap_discovery" | "sitemap_membership" | "rendering" | "index_status";

export interface SiteDiagnosticFinding {
  id: string;
  check: SiteDiagnosticCheck;
  url: string;
  capturedAt: string;
  result: SiteDiagnosticResult;
  reason: string;
  evidenceIds: string[];
  checkedScope: string;
  agent?: SiteDiagnosticAgent;
}

export interface SiteDiagnosticSnapshot {
  id: string;
  url: string;
  capturedAt: string;
  kind: "html" | "robots" | "sitemap" | "response";
  httpStatus: number;
  headers: Record<string, string[]>;
  contentHash: string;
  bytes: number;
  bodyComplete: boolean;
  /** Bounded excerpts, not a complete retained copy. The hash covers all bytes read. */
  rawExcerpt: string;
  relevantTags: string[];
  /** Raw excerpts/headers may be omitted by the aggregate report-retention limit; hashes remain. */
  rawEvidenceTruncated?: boolean;
}

export interface SiteDiagnosticRedirect {
  url: string;
  status: number;
  location: string | null;
  targetUrl: string | null;
  followed: boolean;
  reason: string;
  evidenceId: string;
}

export interface SiteRobotDecision {
  result: SiteDiagnosticResult;
  allowed: boolean | null;
  reason: string;
  matchedRule: string | null;
}

export interface SiteMetaRobots {
  agent: string;
  value: string;
  raw: string;
}

export interface SiteCanonical {
  source: "html" | "http_header";
  raw: string;
  url: string | null;
  sameOrigin: boolean | null;
}

export interface SiteDiagnosticPage {
  id: string;
  url: string;
  finalUrl: string | null;
  capturedAt: string;
  httpStatus: number | null;
  retrieved: boolean;
  isHtml: boolean | null;
  redirects: SiteDiagnosticRedirect[];
  robots: Record<SiteDiagnosticAgent, SiteRobotDecision>;
  metaRobots: SiteMetaRobots[];
  headerRobots: string[];
  canonicals: SiteCanonical[];
  indexStatus: "not_checked";
  snapshotId: string | null;
  error: string | null;
}

export interface SiteRobotsReport {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  state: "available" | "missing" | "unavailable";
  reason: string;
  snapshotId: string | null;
  redirects: SiteDiagnosticRedirect[];
  sitemapUrls: string[];
}

export interface SiteSitemapReport {
  url: string;
  finalUrl: string | null;
  discoveredBy: "robots" | "default" | "sitemap_index";
  result: SiteDiagnosticResult;
  reason: string;
  httpStatus: number | null;
  snapshotId: string | null;
  redirects: SiteDiagnosticRedirect[];
  kind: "urlset" | "sitemapindex" | null;
  /** Bounded, same-origin entries only. Entries are not fetched as pages. */
  entries: string[];
  entriesTruncated: boolean;
}

export interface SiteDiagnosticError {
  url: string;
  stage: "robots" | "page" | "sitemap";
  message: string;
  capturedAt: string;
}

export interface SiteDiagnosticScope {
  origin: string;
  maxPages: number;
  attemptedPageCount: number;
  checkedPageCount: number;
  retrievedPageCount: number;
  requestCount: number;
  maxRequests: number;
  bytesRead: number;
  maxTotalBytes: number;
  deadlineMs: number;
  sameOriginOnly: true;
  javascriptExecuted: false;
  searchEngineIndexChecked: false;
  skippedUrls: Array<{ url: string; reason: string }>;
  limitations: string[];
}

export interface SiteDiagnosticReport {
  version: 1;
  id: string;
  targetUrl: string;
  createdAt: string;
  completedAt: string;
  pages: SiteDiagnosticPage[];
  findings: SiteDiagnosticFinding[];
  snapshots: SiteDiagnosticSnapshot[];
  robots: SiteRobotsReport;
  sitemaps: SiteSitemapReport[];
  scope: SiteDiagnosticScope;
  errors: SiteDiagnosticError[];
}
