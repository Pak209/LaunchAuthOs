# Launch Auth — Paid MVP Production Readiness

This document is the release gate for charging controlled beta customers. The application must remain unavailable for live payment until every required item below is complete.

## Implemented in the application

- Firebase Authentication, tenant-isolated Firestore workspaces, multi-project resume, and autosave.
- Bounded multi-page crawling with DNS validation, connection pinning, evidence snapshots, confidence, freshness, and customer corrections.
- Evidence-bounded AI campaign generation, editing, approval, versioning, and downloadable reports.
- Server-owned campaign approval attestations. Fulfillment and checkout reject any campaign whose approved content changed.
- A complete distribution-provider interface, an explicitly non-billable sandbox, and a guarded PRNow pilot adapter with account/credit/taxonomy preflight, status, evidence, package-refund, and pending-retraction support.
- Assisted directory tasks and an internal fulfillment queue. Administrators can record customer requirements, submissions, acceptance, rejection, publication and removal, with payment/approval gates for new work and a revision-fenced, replay-safe audit trail. This records human work; it does not submit to directories automatically.
- Campaign history browsing and plain-text previews, with confirmed restoration to a new draft version. Restore rejects conflicting edits, active jobs and fulfillment orders; earlier approvals cannot be reused or re-attested after a restore.
- Ordinary analysis, evidence/profile review, campaign saves and approval attestations also reject any existing fulfillment order transactionally, including canceled/refunded orders. Firestore rules independently lock the customer-writable project subtree; the UI pauses edits when order state is unavailable and preserves history/previews/downloads. New immutable campaign versions cannot overwrite saved snapshots.
- Evidence-derived dashboard/distribution counts and public URL ledgers. URLs are deduplicated, removed/failed states remain distinct, and unloaded records show unavailable rather than false zero outcomes. Directory evidence remains explicitly operator-recorded.
- Internal provider preflight, supplier cancellation, and customer refund controls. External mutations are journaled; Stripe refund requests are idempotent and finalized only from signed webhooks.
- Stripe-hosted Checkout, automatic tax calculation, signed webhooks, exact session/price/amount/currency reconciliation, idempotent payment transitions, and partial/full refund accounting.
- Durable background jobs with leases, crash recovery, retry backoff, and administrator retry/cancel actions.
- Durable analysis and campaign-generation jobs with reload-resumable status, deduplicated enqueue, tenant checks, bounded attempts, immutable snapshots/versions, and stale-result rejection.
- Authorized customer-site diagnostic jobs and a Brand Intelligence panel with saved reports, captured response evidence, explicit scope/unknown states and JSON export. The bounded inspector records crawlability/directives, not actual search-engine indexing.
- Cross-session editor conflict notices preserve unsaved changes as clearly labeled local drafts, require confirmation before discarding/reloading, and reject stale responses from earlier editor/project sessions.
- Audited supplier reconciliation in `/admin`: link a matched existing release, or authorize one retry after recording explicit supplier confirmation of non-acceptance. Request replay and concurrent operator decisions are fenced.
- Supplier dispatch fences persisted before external calls, conservative crash/uncertain-response handling, and transactional admin controls that reject blind retries or cancellation after dispatch.
- Frozen order provider/plan/credit/cost and submission payload; worker polling and supplier cancellation resolve the original order's provider, not the current environment default.
- Live Checkout enforces the readiness checklist. Signed payment mode is bound to each order; test payments authorize only non-billable sandbox fulfillment, never a live supplier submission.
- Bounded supplier responses with redirect rejection, fail-closed taxonomy validation, and monotonic cumulative refund accounting.
- Provider polling, placement URL verification, removed-placement detection, and evidence-backed customer reports.
- Transactional-email job support, audit records, rate limits, same-origin mutation checks, public liveness, and a secret-protected readiness endpoint.

## External launch blockers

These cannot be completed truthfully in code alone:

1. Create and fund only a minimal PRNow pilot account, add its API key locally, and run the controlled lifecycle test.
2. Obtain written confirmation of the exact package cost, rate limits, white-label rights, cancellation/refund rules, submit idempotency behavior, and the contractual distinction between “distributed” and “published.”
3. Keep `PRNOW_SUBMIT_ENABLED=false` until that pilot passes and the contract/cost approval flags are truthful.
4. Set final package prices after supplier costs, Stripe fees, expected refunds, taxes, and human fulfillment time are known.
5. Create Stripe products/prices, configure the production webhook, and complete test-mode then live-mode checkout/refund drills.
6. Have counsel approve the privacy policy, terms, refund policy, supplier disclosure, and marketing claims.
7. Select production hosting, connect the final domain and email domain, configure secrets, deploy Firestore rules, enable backups, and connect error monitoring.
8. Assign a fulfillment/support owner and identify the first 3–5 controlled beta customers.

## Remaining engineering and validation gates

- Validate the implemented administrator reconciliation workflow against the supplier pilot. Follow `OPERATIONS.md`; do not clear database dispatch markers manually.
- Deploy `firestore.indexes.json`, including `siteDiagnosticJobs.status`, verify collection-group queries, and configure scheduled POST calls to `/api/internal/jobs/run`. The endpoint runs fulfillment, intelligence and diagnostics workers independently and awaits all three groups; a partial failure returns 500 without abandoning the other workers.
- Connect actual error-reporting instrumentation and analytics; a configured DSN alone is not proof of operational monitoring.
- Run transactional dispatch/recovery tests against Firestore Emulator or the deployment database and run the full signed-webhook/provider lifecycle. Those fulfillment/recovery regression tests still use a storage-only Firestore double and mocked supplier responses. The separate order-lock suite uses the real local emulator but does not cover the supplier/payment lifecycle or establish live deployment.
- Run the complete directory workflow with an authorized operator and a real listing, and validate history restore plus approval/checkout concurrency against Firestore. Browser fixtures verify rendering/interaction only, not real directory publication or backend deployment.
- Extend customer notifications beyond the implemented payment email, or establish an explicit manual support process for failures, publication and refund updates during the controlled beta.
- Deploy and validate the updated order-lock rules against the target Firebase project before restoring `FIRESTORE_RULES_VERIFIED=true`. The old deployed-rule verification does not cover this revision. Exercise ordinary edits versus order preparation/approval with authenticated users; local storage-double and HTTP-handler tests alone do not establish deployment behavior.
- Validate the implemented cross-session conflict/local-draft/reload workflow against real authenticated concurrent sessions; isolated UI fixtures and pure state tests do not establish live Firebase behavior.
- Synchronize the loaded campaign approval badge after evidence-only saves: the server invalidates approval, but the previously loaded campaign object's displayed status can remain stale until reload. Server checkout/fulfillment gates remain authoritative; do not use a browser badge as approval evidence.
- The Authority Graph network visualization and independent backlink/search/AI measurements remain unimplemented. The current footprint panel is a labeled ledger summary. The four customer SEO/engagement deliverables below are now committed remaining scope; imported or attributed observations must not be marketed as independently verified whole-market measurements.
- Legacy paid orders lacking frozen submission data or a verified Stripe mode fail closed and require reconciliation; do not fill these fields from assumptions.
- The earlier broad security review could not be finalized because its temporary artifact directory is missing. Targeted regression tests are not a replacement for completion of that review.

## Remaining customer SEO and engagement deliverables

These remain incomplete. SEO-01 has an implemented bounded diagnostic slice; it still needs deployment and acceptance, and the other three workflows remain pending. Track them alongside the existing paid-MVP work; do not mark the expanded project scope complete or advertise them as available without the acceptance evidence defined in [PRODUCT_SPEC.md](PRODUCT_SPEC.md#committed-remaining-scope-customer-seo-and-ai-search-engagement).

- [ ] **SEO-01 — Customer-site crawlability and indexing diagnostics:** bounded evidence-backed checks, jobs and review UI implemented locally; diagnostic persistence, contention and recovery now have real local Firestore Emulator coverage. Deployed indexes, production scheduler/recovery, owner-authorized sites and snapshot retention/deletion still require acceptance. Add dated engine-specific index evidence through an authorized source; current reports correctly retain `not_checked`. Crawler transport is injected in tests; local database verification is not live acceptance.
- [ ] **SEO-02 — Evidence-backed content recommendations:** approved-claim/source references, evidence freshness/gaps, customer review and export; no unauthorized publishing or mutation of ordered campaigns.
- [ ] **SEO-03 — Google/Bing visibility report imports:** owner-authorized source reconciliation, tenant isolation, repeat/overlap handling, and preserved missing/ambiguous values; verify actual provider schemas before integration.
- [ ] **SEO-04 — AI referral and conversion tracking—separate from citations:** authorized collection, verified event definitions, deduplication, bot/test exclusion, consent/retention controls, and separate referral/conversion denominators.

Required dependencies: shared observation provenance, customer property/data access, approved conversion definitions and attribution windows, and real owner-authorized acceptance samples. An unavailable provider report or missing analytics access is a dependency—not a zero result or proof of completion. The existing supplier, billing, infrastructure and legal gates remain unchanged.

## Local order-lock verification

The [isolated emulator suite](scripts/FIRESTORE_ORDER_LOCK_TESTS.md) passed 25 cases on 2026-09-11 using Firestore Emulator 1.22.0. It covers direct client create/update/delete attempts, canceled/refunded and malformed orders, orphan project recreation, tenant roles, legacy status locks, normalized batch access limits, and real Web SDK/Admin transaction races. The production `saveCampaignRevision` race returned HTTP-conflict data (`ProjectMutationConflictError` with status 409), preserved original assets and did not create a version. This is local verification only; it neither changes the live project nor sets an operational approval flag.

## Local diagnostic job verification

On 2026-10-02, the isolated harness passed 14 diagnostic-job cases and reran all 25 order-lock cases against Firestore Emulator 1.22.0. Diagnostic tests use the real Admin/Web SDKs and emulator for persistence, concurrent enqueue/claim transactions, lease recovery, late-worker fencing, report retention, access checks and client rules. A fresh SDK connection can resume the saved report. Crawler responses and test time are controlled inputs; no customer site or live Firebase project is contacted. This evidence does not set `FIRESTORE_RULES_VERIFIED`, `FIRESTORE_INDEXES_VERIFIED` or `JOB_SCHEDULER_VERIFIED`.

## Runtime launch gate

`GET /api/health` is a public liveness check and exposes no configuration details.

`GET /api/internal/readiness` returns the complete launch checklist only when called with `Authorization: Bearer <JOB_RUNNER_SECRET>`. It reports `readyForPaidUsers: true` only when all required configuration and explicit operational approvals are present.

The same readiness result now gates live Checkout, including attempts to resume a previously open session through the application. Already-issued Stripe URLs must be expired separately during a shutdown. Test Checkout requires a sandbox order; test-mode payments cannot fund the PRNow pilot.

The following values must be configured for production. Boolean confirmations must remain `false` until the underlying work has actually been completed:

- Firebase Web configuration and Firebase Admin credentials.
- `FIRESTORE_RULES_VERIFIED=true` after deployed-rule integration tests pass.
- `FIRESTORE_INDEXES_VERIFIED=true` after the configured worker/refund indexes are ready and their actual queries pass against the deployment database.
- OpenAI server credentials and the selected production model.
- `FULFILLMENT_PROVIDER=prnow`, its server-only API key, plan, exact cost/credit requirement, and `PRNOW_SUBMIT_ENABLED=true` only after the controlled pilot passes.
- `FULFILLMENT_PROVIDER_CONTRACT_APPROVED=true` and `FULFILLMENT_PROVIDER_COSTS_VERIFIED=true` only after written terms and actual pilot cost are recorded.
- Stripe secret, webhook secret, and all three one-time Price IDs.
- A production HTTPS `NEXT_PUBLIC_APP_URL`.
- A random `JOB_RUNNER_SECRET` of at least 32 characters, scheduled calls to `POST /api/internal/jobs/run`, and `JOB_SCHEDULER_VERIFIED=true` only after observing automatic processing and lease recovery. The host must support the worker request duration (`maxDuration=300`); a route hint alone does not provision that runtime capacity.
- Internal admin Firebase UIDs and transactional email credentials.
- Error monitoring, Firestore backup confirmation, legal approval, and controlled-beta confirmation.

## Release procedure

1. Deploy the exact Firestore rules and index definitions in this repository; wait for indexes to be ready. The collection-group status/payment-intent queries need explicit group-scoped indexes, per the [Firebase index documentation](https://firebase.google.com/docs/firestore/query-data/index-overview).
2. Run `npm run test:integration:firebase` against the target Firebase project and record the result.
3. Run `npm run lint`, `npm test`, and `npm run build` from a clean production configuration.
4. Run the non-publishing provider preflight, then a supervised minimum-cost pilot lifecycle: quote, submit, status, evidence, pending retraction, editorial rejection, package-credit refund, uncertain-response reconciliation, and duplicate prevention. Do not assume a sandbox or submit idempotency unless the provider confirms them in writing.
5. Run Stripe test mode: successful checkout, expired checkout retry, duplicate webhook, mismatched webhook rejection, partial refund, full refund, and failed payment.
6. Verify the job scheduler, expired-lease recovery, customer email, admin retry/cancel, provider preflight, separate supplier cancellation/customer refund controls, placement polling, 404/410 removal detection, and downloaded evidence report.
7. Confirm `/api/internal/readiness` is fully green.
8. Invite only controlled beta customers, monitor every order manually, and keep provider volume capped until the complete lifecycle has been observed.

## Rollback and incident posture

- Disable checkout first by removing or rotating the Stripe server key or package Price IDs.
- Stop new fulfillment by pausing the job scheduler; queued records remain durable.
- Use the internal queue to inspect failures. Expired worker leases recover automatically, but PRNow does not publicly promise submit idempotency: any ambiguous submit response is marked for human dashboard reconciliation and is never automatically retried.
- Only pre-dispatch jobs using the new dispatch protocol recover automatically. Expired dispatched jobs and legacy running submission jobs require human review. A failed acknowledgement of the dispatch-fence commit is also treated as uncertain.
- Do not delete payment, order, placement, or audit records during an incident. Preserve them for reconciliation.
- Refunds must be initiated through the approved Stripe/provider process and confirmed by signed webhook events.
