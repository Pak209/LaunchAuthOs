# Launch Auth — Roadmap

## Now

- Firebase authentication, normalized persistence, multi-project resume, autosave, immutable evidence, server-owned approvals, and tenant rules are implemented.
- Bounded multi-page intelligence and editable products, audiences, positioning, founders, milestones, proof points, competitors, confidence, and freshness are implemented.
- Real, versioned, evidence-bounded AI campaign generation and downloadable evidence reports are implemented; production model credentials remain a deployment gate.
- Stripe Checkout/webhooks, exact paid-order reconciliation, partial/full refund accounting, and non-billable sandbox protection are implemented.
- Durable fulfillment/email/verification jobs, internal queue, retry controls, placement monitoring, and removed-link detection are implemented.
- Directory operator status/evidence recording, customer-visible directory URLs, saved campaign version browsing/restoration, and actual dashboard/placement-ledger wiring are implemented. Integration acceptance remains required.
- Ordered-project mutation fences cover normal edits, reanalysis, campaign versions, and approvals. Current rule deployment and target-environment acceptance remain required; cancellation/refund does not unlock the campaign.
- A guarded PRNow adapter, package/cost/credit preflight, package-bound checkout, uncertain-submit reconciliation, and journaled provider cancellation/customer refund controls are implemented.
- Finish supplier contracting, actual cost verification, the controlled provider pilot, legal approval, production infrastructure, and controlled-beta operations.

## Next

- Administrator-led supplier reconciliation and durable crawling/generation jobs are implemented with local regression coverage. Validate these flows against Firestore and the controlled supplier pilot, including crashes and ambiguous responses.
- Deploy worker/billing indexes, configure the production scheduler, and add actual error-reporting instrumentation.
- Create and minimally fund the supplier account, run a supervised low-volume lifecycle pilot, and keep live submissions locked until the observed results and written terms pass review.
- Complete hands-on assisted-directory fulfillment tests and document the operator playbook.
- Configure production hosting, domain, email, error monitoring, backups, scheduler, Stripe, Firebase Admin, and OpenAI secrets.
- Run the full release procedure in `PRODUCTION_READINESS.md` and invite 3–5 controlled beta customers.

### Committed remaining customer SEO and engagement work

The expanded scope is not complete. The first bounded diagnostic slice is implemented locally; production acceptance and the remaining workflows are outstanding. Delivery criteria and dependencies are in [PRODUCT_SPEC.md](PRODUCT_SPEC.md#committed-remaining-scope-customer-seo-and-ai-search-engagement), backed by the [SEO and AI-search research](research/SEO_AI_SEARCH.md).

- [ ] **SEO-01: Customer-site crawlability and indexing diagnostics.** Implemented: authorized four-page inspection, pinned transport, robots/directive/canonical/sitemap observations, durable reports, customer review and JSON evidence export. Still required: deployment/owner-authorized acceptance, retention/deletion operations and dated independent engine-index evidence; current reports explicitly leave index inclusion unmeasured.
- [ ] **SEO-02: Evidence-backed content recommendations.** Reviewable customer-site improvements and exportable briefs tied to approved evidence and campaign versions.
- [ ] **SEO-03: Google/Bing visibility report imports.** Owner-authorized imports with raw evidence, provider-specific metrics, reconciliation, deduplication, and explicit unavailable/ambiguous data states.
- [ ] **SEO-04: AI referral and conversion tracking—separate from citations.** Authorized source/event measurement with bot filtering, deduplication, attribution limits, and separate visibility, referral, and conversion measures.

Build shared observation/provenance definitions first; proceed through diagnostics/content, report imports, and engagement tracking. These items are part of the remaining scope, not optional future research. They do not bypass existing paid-launch gates or authorize customer-site publication or data-vendor purchases.

## Later

- More providers and directories.
- Authority Graph and recurring opportunity engine.
- Monitoring subscriptions and broader recurring multi-assistant observation panels, beyond the committed report imports and engagement tracking above.

## Gate

Do not enable live checkout until `/api/internal/readiness` is fully green, the selected provider lifecycle passes sandbox testing, supplier costs and margins are verified, and the legal/operations release gates are explicitly approved.
