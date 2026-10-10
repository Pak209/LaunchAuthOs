# Customer SEO workflow status

## SEO-02: evidence-backed content recommendation review

Implemented in Brand Intelligence for saved guided-brief projects. Load recommendation, review current approved facts and source hashes, edit audience/question/destination/publication owner/change/action, explicitly acknowledge freshness gaps, save/approve, and export JSON. No model calls, crawling, CMS writes, supplier calls, campaign mutations or publication are performed. These are deterministic content-brief suggestions, not a claim to have inspected the destination page or measured a content gap on that page.

The authenticated owner API `/api/content-recommendations/[projectId]` derives the owner from the website session. POST requires same-origin JSON and limits streamed input to 32 KB. Review approval requires referenced approved factual claims; references are customer assertions, not independent verification. Destination and publication owner must be supplied. Structured suggested text contains no invented factual assertions. User edits remain customer-authored and require editorial review.

Each review binds the current brief revision, campaign version/digest and full evidence snapshot hash. Conflicting saves fail with 409. Changed evidence/campaign makes prior approval stale; export refetches and checks the saved review version and snapshot before downloading. Export is an observation at that time, not a continuing promise that future evidence is unchanged. Versions are immutable during their retention window. No review operation changes a frozen campaign or order.

Evidence output includes current approved factual references and bounded source names/content hashes, never raw source text. Capture dates and independently verified freshness are explicitly unknown. Missing references prevent approval; missing snapshots and unknown freshness remain visible review gaps. Existing source removal changes the snapshot and invalidates the review. Removing source text does not remove separately written derived review text or previously downloaded exports.

Storage: `contentRecommendations/current` persists as derived draft content until eligible project deletion; `contentRecommendationVersions` expires after 30 days through the existing explicit maintenance function. Paid/approval/report guards preserve history pending the outstanding policy decision. No live scheduler is enabled. The bounded atomic project-deletion workflow removes both collections for eligible projects, or fails without partial deletion for protected/oversized data. Recommendation approval is an editorial review, distinct from campaign approval/payment records.

Limitations: guided saved briefs are required; legacy projects must create/save a guided brief first. The destination is owner-selected rather than verified customer ownership. No outbound page fetch or edit occurs. Browser acceptance and real staging sign-in still require execution; local tests do not establish live readiness.

Validation supplied: unit/service tests, authenticated route tests, and guarded real Firestore emulator tests for concurrent saves, stale approval, tenant isolation, ordered-project nonmutation, retention and deletion. Parent validation report records which suites actually ran.

## SEO-03: decisions and evidence needed before import implementation

Provide one owner-authorized, preferably redacted real export each from Google and Bing, with its exact report surface and schema. Do not invent API fields or assume one export covers both search and generative-AI visibility. Confirm:

- Supported initial file formats and concrete headers, locale/date/number encoding, property identifiers and timezone.
- Property ownership/access proof and whether an operator may import on the owner's behalf.
- Metric definitions, aggregation, filters, measured period and source report totals; suppressed, preliminary, missing, ambiguous-zero and unavailable values.
- Raw-artifact storage/size limits and retention policy (current source-text policy covers only bounded `.txt`/`.md` intake, not arbitrary analytical exports).
- Replacement versus comparison rules for overlapping exports and a provenance key for repeat imports.

Acceptance needs authorized source-report reconciliation for both providers. Mock fixtures alone cannot supply that evidence. No importer or account access is claimed implemented.

## SEO-04: decisions and authorization needed before tracking

Choose the first customer-authorized property and either an existing analytics export/integration or an explicitly approved instrumented site. Define one meaningful conversion (for example a customer-chosen submitted form), event schema and qualifying conditions, attribution model/window, session identity/deduplication rule, bot/test exclusions, timezone and reporting denominator. Confirm consent behavior, collection provenance, access roles, retention/deletion and destination for event data before installing code or accessing analytics.

Unknown/direct referrers remain unknown. Referral sessions, conversion events, engine impressions, mentions and citations must be distinct measures. Tests need consent denied, absent referrer, bot/test traffic, duplicate events/sessions and tenant isolation. No tracking script, external connection, event collection or causal/ranking claims are enabled by this change.
