# Launch Auth — Paid MVP Production Readiness

This document is the release gate for charging controlled beta customers. The application must remain unavailable for live payment until every required item below is complete.

## Implemented in the application

- Firebase Authentication, tenant-isolated Firestore workspaces, multi-project resume, and autosave.
- Bounded multi-page crawling with DNS validation, connection pinning, evidence snapshots, confidence, freshness, and customer corrections.
- Evidence-bounded AI campaign generation, editing, approval, versioning, and downloadable reports.
- Server-owned campaign approval attestations. Fulfillment and checkout reject any campaign whose approved content changed.
- A complete distribution-provider interface plus an explicitly non-billable sandbox implementation.
- Assisted directory tasks and an internal fulfillment queue.
- Stripe-hosted Checkout, automatic tax calculation, signed webhooks, exact session/price/amount/currency reconciliation, idempotent payment transitions, and partial/full refund accounting.
- Durable background jobs with leases, crash recovery, retry backoff, and administrator retry/cancel actions.
- Provider polling, placement URL verification, removed-placement detection, and evidence-backed customer reports.
- Transactional-email job support, audit records, rate limits, same-origin mutation checks, public liveness, and a secret-protected readiness endpoint.

## External launch blockers

These cannot be completed truthfully in code alone:

1. Select and contract with a real press-release/distribution provider.
2. Obtain its sandbox and production API credentials, verified price sheet, service-level terms, cancellation/refund rules, and contractual definitions of “published” and “guaranteed.”
3. Implement and test that named provider adapter against its sandbox. The current provider remains intentionally non-billable.
4. Set final package prices after supplier costs, Stripe fees, expected refunds, taxes, and human fulfillment time are known.
5. Create Stripe products/prices, configure the production webhook, and complete test-mode then live-mode checkout/refund drills.
6. Have counsel approve the privacy policy, terms, refund policy, supplier disclosure, and marketing claims.
7. Select production hosting, connect the final domain and email domain, configure secrets, deploy Firestore rules, enable backups, and connect error monitoring.
8. Assign a fulfillment/support owner and identify the first 3–5 controlled beta customers.

## Runtime launch gate

`GET /api/health` is a public liveness check and exposes no configuration details.

`GET /api/internal/readiness` returns the complete launch checklist only when called with `Authorization: Bearer <JOB_RUNNER_SECRET>`. It reports `readyForPaidUsers: true` only when all required configuration and explicit operational approvals are present.

The following values must be configured for production. Boolean confirmations must remain `false` until the underlying work has actually been completed:

- Firebase Web configuration and Firebase Admin credentials.
- `FIRESTORE_RULES_VERIFIED=true` after deployed-rule integration tests pass.
- OpenAI server credentials and the selected production model.
- A non-sandbox `FULFILLMENT_PROVIDER` plus `FULFILLMENT_PROVIDER_CONTRACT_APPROVED=true` and `FULFILLMENT_PROVIDER_COSTS_VERIFIED=true`.
- Stripe secret, webhook secret, and all three one-time Price IDs.
- A production HTTPS `NEXT_PUBLIC_APP_URL`.
- A random `JOB_RUNNER_SECRET` of at least 32 characters and scheduled calls to `POST /api/internal/jobs/run`.
- Internal admin Firebase UIDs and transactional email credentials.
- Error monitoring, Firestore backup confirmation, legal approval, and controlled-beta confirmation.

## Release procedure

1. Deploy the exact Firestore rules in this repository.
2. Run `npm run test:integration:firebase` against the target Firebase project and record the result.
3. Run `npm run lint`, `npm test`, and `npm run build` from a clean production configuration.
4. Run the provider sandbox lifecycle: quote, submit, status, evidence, cancel, refund, editorial rejection, retry, and duplicate submission.
5. Run Stripe test mode: successful checkout, expired checkout retry, duplicate webhook, mismatched webhook rejection, partial refund, full refund, and failed payment.
6. Verify the job scheduler, expired-lease recovery, customer email, admin retry/cancel, placement polling, 404/410 removal detection, and downloaded evidence report.
7. Confirm `/api/internal/readiness` is fully green.
8. Invite only controlled beta customers, monitor every order manually, and keep provider volume capped until the complete lifecycle has been observed.

## Rollback and incident posture

- Disable checkout first by removing or rotating the Stripe server key or package Price IDs.
- Stop new fulfillment by pausing the job scheduler; queued records remain durable.
- Use the internal queue to inspect failures. Provider submissions are idempotent and expired worker leases recover automatically.
- Do not delete payment, order, placement, or audit records during an incident. Preserve them for reconciliation.
- Refunds must be initiated through the approved Stripe/provider process and confirmed by signed webhook events.
