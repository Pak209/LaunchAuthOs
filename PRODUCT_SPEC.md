# Launch Auth — Product Specification (draft)

## V0.1 journey

1. Customer enters a company URL.
2. System crawls approved public information and creates a Brand Profile.
3. Launch Readiness Engine scores readiness and recommends story angles.
4. Customer reviews and approves factual claims.
5. Campaign Engine creates a canonical Campaign Object and downstream assets.
6. Customer selects a package and checks out.
7. Distribution and directory adapters fulfill idempotent jobs.
8. Placement & Evidence Engine records states and proof.
9. Authority Report shows observed outcomes.

## Core objects

Brand Profile, Evidence Item, Readiness Assessment, Campaign, Campaign Asset, Distribution Order, Directory Submission, Placement, Authority Report, Provider, and Adapter Job.

## Committed remaining scope: customer SEO and AI-search engagement

The following four deliverables are in the remaining project scope. All are **pending implementation and acceptance**, not capabilities already shipped. The [research brief](research/SEO_AI_SEARCH.md) supplies supporting findings and measurement limitations; this section defines the delivery requirements.

These extend Brand Intelligence and the customer report. The existing campaign-readiness estimate is not a technical SEO diagnostic, and current placement-ledger outcomes are not search-visibility or customer-engagement measurements.

### SEO-01 — Customer-site crawlability and indexing diagnostics

Inspect a bounded, customer-authorized set of public URLs for accessibility, redirects, robots directives, indexability directives, canonical consistency, sitemap discovery, and rendering limitations. Each finding must retain its URL, timestamp, supporting evidence, checked scope, and a pass/issue/not-checked/not-applicable result. Distinguish a retrievable page from an apparently indexable page and dated, engine-reported indexing evidence; neither a successful fetch nor supplier-reported indexing proves independent index inclusion.

Acceptance: exercise robots/noindex, redirect/canonical, sitemap, rendering-dependent and failed-fetch cases; show the checked-page count and unknown states; preserve crawler IP-pinning/private-network protections and private workspace access controls. Customer-site changes require separate publication authorization.

### SEO-02 — Evidence-backed content recommendations

Recommend improvements to customer-owned pages and content briefs tied to approved claims, source snapshots, and the relevant campaign version. Show the intended audience/question, destination, publication owner, rationale, factual references, evidence gaps/freshness, intended customer action, and review status. Customers can review, edit and approve the recommendation; generating a recommendation does not publish it or alter an ordered campaign.

Acceptance: factual recommendations reference current approved evidence, unsupported or stale claims are flagged rather than invented, version/approval history is preserved, and one owner-reviewed brief can be exported for implementation. No ranking or AI-citation guarantees.

### SEO-03 — Google/Bing visibility report imports

Import owner-authorized Google and Bing report exports into tenant-isolated project records, initially through an assisted/manual import workflow. Retain the raw artifact, property/provider/surface, measured period/timezone, filters, metric definitions, aggregation, and import provenance. Display supported search and AI-visibility measures separately; do not assume API availability or invent fields absent from an export.

Acceptance: reconcile at least one authorized export from each provider against its source report; test schema validation, repeat imports, overlapping periods, access isolation, and missing/suppressed/preliminary/ambiguous-zero values. Missing data must not become fabricated zeros, and overlapping metrics must not be summed as independent outcomes. Automated connectors follow only after their actual access and API contracts are verified.

### SEO-04 — AI referral and conversion tracking, separate from citations

Provide customer-authorized engagement measurement for observable AI-source referrals and customer-defined meaningful events or conversions on the customer's site. Record the source-classification version, event definition, attribution window/model, numerator/denominator, and collection provenance. Keep impressions, mentions, citations, referral sessions, and conversions as separate measures. Unknown/direct traffic stays unknown; a bot visit is not a human referral and a citation is not a visit or conversion.

Acceptance: validate test referrals and a chosen conversion end to end; test event/session deduplication, bot/test exclusion, missing referrers, consent choices, and tenant isolation. Show attribution limitations, retention/deletion controls, and actual counts rather than claims of causal lift. Instrumentation or analytics access requires the customer's authorization.

### Sequencing and boundaries

Establish shared observation/provenance definitions first, then deliver diagnostics and content recommendations, visibility imports, and engagement tracking. The first usable reporting path may be assisted, but all four deliverables require implemented workflows and acceptance evidence before this expanded scope is complete. Launch Auth's own marketing-site SEO, automated CMS publishing, paid data vendors, recurring monitoring subscriptions, and a complete Authority Graph are separate workstreams; they are not substitutes for these customer-facing deliverables. Existing payment, supplier, privacy, and operational launch gates remain in force.

## V0.1 non-goals

No autonomous paid distribution before approval, no CAPTCHA bypass, no guaranteed editorial pickup, no complete Authority Graph, and no always-on monitoring subscription until the fulfillment and evidence loop is reliable.
