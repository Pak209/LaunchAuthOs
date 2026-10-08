# SEO and AI-search visibility: evidence-first product brief

Research date: 2026-09-11. All external sources below were retrieved on that date. This is a bounded product research brief, not a customer-site audit, implemented feature, legal opinion, or forecast of results.

## Executive findings

1. **Prioritize customer-site readiness and trustworthy measurement.** Launch Auth already has source snapshots, approved claims, campaign versions, fulfillment jobs, and placement evidence. The adjacent product opportunity is to connect those objects to customer-site recommendations and observed outcomes—not to sell a universal “AI authority” score.
2. **Ordinary SEO remains foundational.** Google explicitly rejects special AI formatting requirements and says it ignores `llms.txt` for Google Search visibility/ranking. Original useful material is a better content direction than generic AI-generated volume. This does not establish what every other AI provider does. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
3. **Native AI visibility reporting has improved in 2026.** Google announced dedicated generative-AI impression reports on June 3 and added an August 31 worldwide-rollout note. Bing documents native AI citation reporting. Do not repeat the outdated blanket claim that Google AI visibility is only available inside undifferentiated Web reporting. Do not equate dashboard availability with an available public API. [Google announcement](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports), [Bing AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)
4. **Visibility and engagement are different outcomes.** A live placement, indexed page, brand mention, citation, impression, referral session, and qualified lead require different evidence. Launch Auth should make this separation a product advantage.
5. **Start assisted, not with a new monitoring subscription.** A customer-approved readiness report, owner-provided search exports, verified attribution events, and a small reproducible observation panel can test demand before broader integrations. Preserve the existing paid-launch gates and no-guarantee boundaries.

## Product baseline and scope

Repository evidence reviewed: `README.md`, `ROADMAP.md`, `PRODUCTION_READINESS.md`, `VISION.md`, `PRODUCT_SPEC.md`, `lib/analyze.ts`, `lib/types.ts`, `app/layout.tsx`, and relevant existing dashboard/report wording.

- Implemented foundation: bounded intelligence, evidence-bounded campaign generation, customer approval, recorded distribution/directory states, HTTP placement checks, and downloadable evidence reports. These are not independent search measurements.
- The current intelligence crawler has `MAX_PAGES = 4`; its output is not a comprehensive technical SEO audit. A page omitted by this bounded crawl is not evidence that the page or content does not exist.
- Placement `indexed` can be supplier-reported (`providerState` includes `indexed`). The UI/report already warns that indexing is not independently checked. Future search observations must not silently upgrade supplier statements into verified search-engine facts.
- No independent backlink/search/AI measurement connectors are claimed as implemented by production readiness. The footprint is an explicitly labeled ledger summary.
- `VISION.md` forbids ranking, backlink, traffic, or AI-visibility promises and CAPTCHA bypass. This brief does not expand distribution permissions or remove launch blockers.

There are two distinct workstreams:

| Workstream | Priority and boundary |
| --- | --- |
| Helping customer sites | Core product priority. Inspect only authorized public pages, recommend edits, preserve customer choices, and collect owner-authorized measurements. Launch Auth does not currently have permission to publish to arbitrary customer CMSs. |
| Launch Auth's own acquisition site | Separate internal marketing workstream. The inspected root layout has title/description metadata; that is not an SEO program. Plan a deliberately public marketing surface and measure its own acquisition separately. Never expose private workspaces, campaign drafts, reports, admin screens, or API data to improve indexing. |

## What providers actually document

### Google Search, AI Overviews, and AI Mode

- **Eligibility:** Google says supporting links in AI Overviews/AI Mode must be indexed and eligible for a snippet; satisfying requirements does not guarantee crawling, indexing, or serving. A successful HTTP fetch cannot prove this. [AI features and websites](https://developers.google.com/search/docs/appearance/ai-features)
- **Current inclusion control:** Search Console now documents a separate Search generative AI setting, with a worldwide-rollout note dated August 31, 2026. It can include/exclude content from specified AI surfaces and inherit a parent property's setting. The control does not govern AI training or ordinary Search ranking/inclusion. Capture the owner's effective setting; do not change it automatically. [Search generative AI control](https://support.google.com/webmasters/answer/16908024?hl=en)
- **Current measurement:** The dedicated Search report covers AI Overviews and AI Mode impressions, with pages, countries, dates, and devices. It excludes Search Labs experiments. The reviewed documentation does not establish separate AI clicks, CTR, query reporting, or an AI-Overview-versus-AI-Mode breakdown. Data also remains in overall Web performance, so adding the two totals would double-count. [Generative AI performance report](https://support.google.com/webmasters/answer/16984139)
- **Availability and import caveats:** Despite the worldwide note, help text still mentions property rollout and insufficient impressions. Check the actual customer property. Property-level chart totals and page-level tables have different aggregation. Critically, exported `~`/`-` values become zeros: a CSV alone cannot recover which zero meant unavailable. [Report semantics and exports](https://support.google.com/webmasters/answer/16984139)

Google's July 10, 2026 optimization guide emphasizes distinctive, useful content and foundational SEO. It says no special schema is needed for generative AI, no prescribed chunk size/page length is required, and `llms.txt` neither helps nor harms Google Search visibility because it is ignored. Structured data still has ordinary search uses. **Product implication:** do not make a missing `llms.txt`, a special “GEO schema,” or arbitrary answer length a readiness failure. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

### Bing and Microsoft Copilot

Bing's AI Performance report covers Microsoft Copilot, Bing AI summaries, and selected partner integrations—not an established census of every assistant. It documents visible citations, daily cited-page activity, grouped grounding phrases, page-level data, and CSV/Excel exports. Grounding phrases are not exact user prompts. Data is sampled/aggregated, may omit sparse activity, can differ across views, and refreshes daily with processing delay. Citations are not clicks, traffic, rankings, or authority. Preview additions include Intents, Topics, Citation Share, and Compare; Citation Share is query-specific and does not identify competitor domains. Account-level access and public API support require separate verification. [Bing AI Performance documentation](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)

**Product implication:** begin with authorized exports carrying filters and scope. Label the provider's Citation Share distinctly from any Launch Auth sampled-prompt rate. Do not infer ChatGPT-wide measurement merely because the report includes selected partners.

IndexNow notifies participating engines about changed URLs; submission is not an indexing guarantee. It is potentially useful after an authorized customer publication workflow exists, not evidence that publication has been indexed or cited. [IndexNow FAQ](https://www.indexnow.org/faq)

### ChatGPT search and OpenAI

OpenAI documents independent purposes: `OAI-SearchBot` supports ChatGPT search discovery; `GPTBot` concerns potential training use; `ChatGPT-User` handles some user-initiated visits and is not an automatic web crawler. Allowing search while disallowing training is supported. Opting out of `OAI-SearchBot` prevents appearance in search answers, though navigational links can still appear. OpenAI recommends allowing its published searchbot IP ranges; robots changes can take approximately 24 hours to propagate. User-initiated visits may not follow robots rules. **A bot request is not a human referral or a citation.** [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

The OpenAI web-search API returns citation annotations and separately can expose consulted sources. These are not identical: retrieved URLs need not be cited. Displayed web-result citations must be visible and clickable. An API run is a controlled observation under its recorded configuration, not a measurement of all ChatGPT users. No general publisher-wide ChatGPT organic impression/citation reporting API was established by the reviewed documentation. [OpenAI web-search documentation](https://developers.openai.com/api/docs/guides/tools-web-search)

**Referral proposal:** record observable assistant referrers and campaign parameters on the customer's site, validate classification with test visits, and retain a separate unknown/direct bucket. Do not assume every assistant click carries an identifiable referrer or a particular parameter. A citation without a click creates no on-site session to measure.

## Customer-site readiness checklist

These are proposed diagnostics with evidence, not a guaranteed-ranking score. Findings should say `pass`, `issue`, `not checked`, or `not applicable`, with scope and confidence.

| Diagnostic | Evidence to retain | Recommended handling |
| --- | --- | --- |
| Public accessibility and indexability | Requested/final URL, timestamp, HTTP status, redirect chain, relevant robots/meta/header directives; owner-provided index inspection where available | Distinguish “retrievable,” “apparently eligible,” and “engine reports indexed.” Mark rendering-dependent pages for review. |
| Robots and privacy boundaries | Actual robots response, effective agent rule, authentication requirement | Explain conflicts; never recommend publishing private content. Robots is not access control and alone does not ensure a URL stays out of Google. [Robots guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro) |
| Canonical consistency | Declared canonical, redirect target, sitemap membership, internal-link destination; engine-selected canonical only when provided | Preserve declared versus observed canonical separately. Redirects and canonical annotations are strong preferences, while sitemap inclusion is weaker; the engine chooses. [Canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| Discovery and rendering | Internal links, sitemap existence/parse results, meaningful rendered text where inspected | Recommend discoverable customer pages and useful navigation. Sitemap presence is a discovery aid, not proof of indexing. Don't call a JavaScript-dependent page empty from an HTML-only excerpt. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) |
| Page purpose and content | Title/description, visible headings, target audience/question, first-party proof, named owner and review date | Create one useful resource for a real customer question; flag stale or unsupported claims before generating more assets. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) |
| Structured data | Detected type, parsed fields, validator findings, corresponding visible facts | Recommend only applicable, currently supported types; reject invented reviews, awards, certifications, or properties. Schema is not an AI-citation prerequisite. [Google AI guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |
| Provider policy/access | Customer-approved Google AI inclusion setting, relevant crawler directives, observed CDN/WAF denials | Distinguish a deliberate opt-out from an accidental block. Do not weaken security controls broadly or bypass challenges. |

Candidate content assets, as hypotheses to test: an evidence-backed product/use-case page, specific implementation documentation, a dated first-party benchmark with method and limitations, a consented customer case study, or an accurate comparison explaining tradeoffs. Each needs a publication owner, canonical destination, approved facts, and an appropriate next action. A release syndicated to many sites is not a substitute for a useful customer-owned destination.

## Sustainable distribution, not manufactured authority

Google's spam policy identifies ranking-driven paid links, low-quality directory links, optimized anchors in distributed press releases, and scaled low-value content as risks. Advertising/sponsorship links can comply when qualified with `sponsored` or `nofollow`. Wire services are not inherently prohibited. Automated rank-query scraping without permission is also called out. [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)

Proposed directory/provider acceptance rules:

- Require a relevant audience, truthful business eligibility, legitimate ownership, and a useful listing beyond its link.
- Store payment/sponsorship and editorial/syndication classification separately from observed link attributes. Don't promise a “dofollow” link or ask a publisher to remove appropriate qualification.
- Record the actual destination, anchor, rel attributes, availability, and removal/change history only when inspected. “URL is live” does not establish a backlink to the customer.
- Use genuine community participation and permission-based outreach. No fabricated reviews, identities, endorsements, astroturfing, bulk irrelevant listings, or CAPTCHA bypass.
- Keep PRNow contracting/pilot gates unchanged. This research does not validate supplier costs, publication claims, or SEO efficacy.

## Measurement contract

Proposed metric definitions below belong to Launch Auth's product design; they are not universal provider standards. Never combine unlike denominators into one “authority score.”

| Metric | Definition / required evidence | Must not imply |
| --- | --- | --- |
| Verified live placement URLs | Deduplicated authorized placement URLs whose latest successful availability check meets the recorded policy; retain prior failures/removals | Indexing, correct article content, earned editorial coverage, backlink, audience reach |
| Observed referring domains | Distinct normalized domains with a captured page containing a qualifying customer link; preserve target and link attributes | A complete backlink index or transferred ranking value |
| Observed indexed URLs | Unique URLs with dated, engine-specific index evidence; keep supplier assertions in another field | Permanent indexing or presence in every search engine |
| Search impressions / clicks / CTR | Provider-reported values for a named property, search type, filters, dates, and aggregation; CTR = comparable clicks ÷ impressions | Exact total query demand or AI-only clicks when only overall Web clicks exist |
| Google generative-AI impressions | Imported native AI-report value with its exact dimension/aggregation and quality flag | AI clicks, unique people, or a denominator interchangeable with Bing citations |
| Bing AI citations / Citation Share | Preserve provider metric names, sample scope, filters, and period exactly | Whole-market AI share, exact prompts, traffic, or causation |
| Sampled brand-mention rate | Valid successful panel responses with an unambiguous company mention ÷ all valid successful panel responses | Organic reach, population share of voice, or a link/citation |
| Sampled citation rate | Valid successful panel responses citing the defined customer domain ÷ all valid successful panel responses; one hit maximum per response | Citation frequency among actual users; third-party brand citations should be a separate field |
| AI-attributed referral sessions | Customer-site sessions carrying a validated assistant source signal under a versioned classification rule | All AI-influenced visits, visibility without a click, or crawler traffic |
| Meaningful-action rate | Attributed sessions with at least one approved event ÷ attributed sessions; deduplicate per session and show numerator/denominator | Revenue or a qualified lead unless that event genuinely establishes it |
| Qualified leads / customers | Explicit customer-defined qualification or reconciled purchase event, with chosen attribution window/model | Incremental lift caused by Launch Auth; last-touch attribution is not causality |

Measurement guardrails:

- Separate `provider_reported`, `operator_recorded`, `independently_observed`, and `experiment_observed`. An immutable hash establishes snapshot integrity, not truth or causation.
- Every observation needs workspace/property ownership, URL scope, provider/surface, collected time, measured period/timezone, method/schema version, filters, units, raw evidence reference/hash, and quality state. Prompt panels also need exact prompt, locale, model/surface, search mode, run time, success/failure, and citation parsing rules.
- Preserve raw imports. Use nullable normalized values with `observed_zero`, `missing`, `suppressed`, `preliminary`, `partial`, `failed`, or `ambiguous_export_zero`. For Google's zero-collapsing export, obtain corroborating UI/provenance when possible; otherwise keep the ambiguity. Do not invent a missingness flag from the CSV alone.
- Never backfill absent data with zero. Keep engine aggregates separate from page totals, avoid overlapping date imports, and don't add API observations to native publisher-report totals.
- Do not import personal search queries, client leads, or analytics identifiers unnecessarily. Use customer authorization, least-privilege access, tenant isolation, retention/deletion rules, and auditable revocation before connectors.
- Missing referrers, blocked analytics, consent choices, cross-device journeys, and copy/pasted URLs limit attribution. Report observed attribution, plus optional self-reported discovery as separate evidence; do not redistribute “direct” traffic into AI based on guesswork.

### Empirical evidence: why clicks must be measured separately

Pew's July 22, 2025 analysis used browsing activity from 900 U.S. adults in March 2025. It reported traditional-result clicks on 8% of visits with an AI summary versus 15% without, and summary-link clicks on 1% of visits with a summary. Results were reconstructed in April and only up to three summary-source URLs were collected. This is observational, time- and population-specific evidence—not a randomized causal estimate or a forecast for a small SaaS company in September 2026. It supports measuring actual engagement rather than pricing citations as clicks. [Pew study and methodology](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)

## Prioritized implementation backlog

Recommendations only; nothing below was implemented by this research.

Scope update: the customer has now added crawlability/indexing diagnostics, evidence-backed content recommendations, Google/Bing report imports, and AI referral/conversion tracking to the remaining project scope. Their committed delivery criteria are **SEO-01–SEO-04** in [PRODUCT_SPEC.md](../PRODUCT_SPEC.md#committed-remaining-scope-customer-seo-and-ai-search-engagement), with pending checkboxes in [ROADMAP.md](../ROADMAP.md#committed-remaining-customer-seo-and-engagement-work). The other proposals below remain recommendations; no feature is implemented merely by this scope decision.

| Priority / phase | Product addition | Acceptance evidence |
| --- | --- | --- |
| P0 — before claiming measurement | Formal observation vocabulary and report provenance | Supplier-indexed cannot become independently indexed; every metric shows source, date, scope, and unavailable state; existing ledgers remain intact. |
| P0 — assisted pilot | Customer-owned URL inventory and bounded readiness report | Scope and checked-page count are visible; robots/canonical/rendering cases tested; raw-fetch failures become unknown; no secrets/private endpoints fetched; no automatic customer changes. |
| P0 — assisted pilot | Approved on-site content brief attached to campaign version | One customer problem, one destination, evidence IDs for factual claims, gaps/expiry, owner approval, publication status, and intended next action. |
| P0 — assisted pilot | Manual Google/Bing/analytics import with evidence envelope | Two real owner-authorized exports reconciled to their source UI; synthetic missing/ambiguous-zero/overlap fixtures tested; tenant restrictions verified. No API claim based only on a dashboard screenshot. |
| P1 — after measurement pilot | First-party engagement setup checklist | Customer chooses a meaningful conversion; test visits distinguish bots/test traffic; event counts and attribution rules verified end to end. |
| P1 — after fulfillment reliability | Versioned, consented observation panel | Stable prompt set, separate branded/non-branded questions, successful-run denominators, failures shown, captured answers/citations, and no universal rank claim. |
| P1 — after access validation | Search Console read-only connector | Verified property authorization, minimal scopes, revoked-access behavior, quotas, backfill/deduplication, null handling, and successful source reconciliation. AI fields remain manual unless their API contract is verified. |
| P2 — later | CMS integrations, IndexNow, broader backlink/AI data vendors | Explicit publish permission, safe rollback, API/terms/cost review, quality benchmark, approved recurring budget, and an actual need not met by native exports. |
| Separate own-site phase | Public Launch Auth marketing pages and acquisition instrumentation | Public-route allowlist, accurate product claims, canonical/sitemap/metadata review, protected private routes, and distinct internal acquisition dashboard. |

An attractive initial deliverable is a **customer evidence-to-engagement report**: “what is currently discoverable, what content we recommend and why, where approved assets were actually published, what visibility was observed, and what meaningful actions followed.” Whether customers will pay for this is a hypothesis, not a finding established by documentation.

## Data access, cost, and terms feasibility

- **Search Console:** API use is free, subject to limits. Search Analytics requires authorization, supports ordinary performance dimensions, returns top rows rather than a guaranteed exhaustive dataset, and allows up to 25,000 rows per request. The reviewed contract does not establish the new dedicated AI-report fields. Start with exports; verify actual schemas before promising automation. [API reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [pricing](https://developers.google.com/webmaster-tools/pricing)
- **Index inspection:** Current documented site quota is 2,000 requests/day and 600/minute, with separate project quotas. This favors selected owned URLs; do not assume access to inspect every third-party placement through a customer's property. [Search Console limits](https://developers.google.com/webmaster-tools/limits)
- **Bing:** Native CSV/Excel export is documented. A production public API for the reviewed AI fields, account eligibility, and any redistribution rights were not established here. Record them as unknown until verified; do not build against private dashboard endpoints. [Bing documentation](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)
- **Controlled OpenAI API experiments:** Current standard web-search pricing lists $10 per 1,000 calls plus search-content tokens at model rates; model input/output charges also apply. Budget by actual calls, not merely prompt count. This buys experimental API responses, not publisher measurement coverage. Recheck pricing/model availability before an authorized pilot; no purchases or API calls were made here. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- **Other vendors:** No backlink/SEO/AI-observation vendor was selected. Later evaluation must cover supported surfaces, collection permissions, geography/device configuration, refresh cadence, missingness, sample reproducibility, retention, resale rights, and true per-customer cost. A provider's marketing claims do not establish these.

## Feasible experiments and decision gates

1. **Readiness usefulness, 3–5 consenting beta customers.** Produce an assisted report, have the owner verify material findings, record false positives and time per site, and identify one actionable owned-site change. Proceed only if reports are accurate enough and operational time fits the eventual price. This tests service usefulness, not SEO lift.
2. **One evidence-rich asset per customer.** Before any approved publication, record its intent, content/campaign hash, destination, baseline period, and conversion. Compare comparable periods and unchanged reference pages where feasible, recording concurrent launch/promotion changes. Start with a 4–8 week observation window as a planning assumption; low volume or delayed indexing may require longer. Treat any before/after change as observational.
3. **Small repeatability panel.** Start with 12 customer-approved questions covering real buyer needs, and run three repetitions on each selected surface at baseline and follow-up. Use manual, normal authorized product interaction or supported APIs; do not scrape Google results automatically. Predefine domain matching, citation/mention distinction, locale and prompts. Report variability and failures before interpreting change; prompts chosen by Launch Auth are not a random sample of real user demand.
4. **Engagement validation.** Use authorized test referrals and a customer-approved meaningful event to verify source preservation, session deduplication, bot/test exclusion, and conversion reconciliation. Then report real counts and denominators. Do not assert that a campaign “caused revenue” from last-touch data.
5. **Distribution quality pilot.** Within existing supplier/directory approvals, inspect a small number of real placements for content correctness, disclosure, link target/attributes, and sustained availability. Assess observed referrals separately. A technical content/indexability defect can be actionable even when traffic is too sparse to evaluate.

## Uncertainties and user decisions

- Which first customer segment and buying journey should the content/prompt panel represent: SaaS/apps, local services, or another vertical? A universal question bank will be less decision-useful.
- Which customer outcome counts: a qualified demo, signup activation, purchase, or another verified action? Choose the event and attribution window before looking at results.
- Customer-site recommendations, visibility imports, and engagement tracking are now in the remaining scope. Their package placement, rollout timing, assisted-service boundaries, and operator time allowance still need definition.
- Which Google/Bing properties and analytics data can beta owners authorize? Actual access, data sufficiency, and AI-report availability remain untested.
- What search/training participation policy does each customer want? Respect deliberate opt-outs; do not label them defects or change them without approval.
- What recurring observation budget, storage retention, and acceptable variance justify a later subscription? Establish them after the assisted pilot, not from a promised citation outcome.
- API parity with consumer search, complete citation coverage, the effect of a specific content tactic, and causal campaign ROI remain unknown. No guaranteed AI citations, `llms.txt` lift outside documented provider behavior, or ranking shortcut is established here.

## Source freshness ledger

Twelve anchor topics below organize the research; narrower official supporting references are linked beside the relevant claims above. “Undated” means no reliable publication/update date was established from the retrieved page, not that it is current indefinitely. Recheck before implementation or customer promises.

| Anchor | Publication/update evidence |
| --- | --- |
| [Google AI optimization](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Page last updated 2026-07-10 |
| [Google generative-AI reporting](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) | Published 2026-06-03; rollout note 2026-08-31; current help also checked |
| [Google AI inclusion control](https://support.google.com/webmasters/answer/16908024?hl=en) | Worldwide-rollout note 2026-08-31 |
| [Bing AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c) | Undated evolving help; preview status explicit; official [launch announcement](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview) dated 2026-02-10 |
| [OpenAI crawlers](https://developers.openai.com/api/docs/bots) | Undated living documentation; independently configured agents verified |
| [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | Page last updated 2025-12-10 |
| [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) | Live page retrieved; no date relied on |
| [Google robots guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro) | Page last updated 2025-12-10 |
| [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies) | Live policy retrieved; no date relied on |
| [Search Console API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) | Current schema retrieved; separate pricing/limits verified; limits page updated 2025-08-28 |
| [OpenAI web-search API](https://developers.openai.com/api/docs/guides/tools-web-search) / [IndexNow](https://www.indexnow.org/faq) | Living interface documentation; pricing separately verified 2026-09-11 |
| [Pew original research](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/) | Published 2025-07-22; browsing period March 2025; reconstruction April 2025 |

Official documentation establishes provider statements/interfaces, not independently proven optimization effects. Pew is explicitly empirical observational research. All proposed backlog, experiments, product packaging, and success gates are recommendations or hypotheses; this brief contains no measured Launch Auth customer outcomes.
