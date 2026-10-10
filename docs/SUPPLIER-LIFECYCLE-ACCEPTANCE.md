# Supplier lifecycle local acceptance

## Implemented interpretation

Checked against [PRNow API documentation](https://prnow.io/api-docs) on 2026-10-10. `distributed` maps to internal processing, not publication. Aggregate status cannot establish each outlet's result. Individual `packages` entries retain state, reason, numeric credit amounts and live URLs; missing entries do not establish completion. Early `live` package URLs pass through the existing public-URL verifier even when the full links report is unavailable. Held or rejected packages need operator review; no automatic customer-refund formula is assumed.

A successful status observation is persisted in a lease-fenced transaction before retrieving evidence. Report failure retains the observed status and package results, processes available early evidence, and schedules another poll. URL/report failures stop after three unsuccessful attempts for explicit operator review and retry; terminal supplier status does not silently close incomplete verification. Concurrent cancellation/refund is not overwritten by stale processing/publication observations.

Retraction is only confirmed when the adapter observes the documented `refunded` response. An unconfirmed response requires reconciliation. Any partial or full customer refund blocks new supplier dispatch, including a refund observed at the transactional dispatch fence. Supplier credits never update customer billing: that remains an independently validated signed Stripe webhook path.

## Reproducible synthetic checks

- Unit suites: `tests/provider.test.ts`, `tests/fulfillment-dispatch.test.ts`, `tests/provider-reconciliation.test.ts`.
- Real local database suite: `tests/firestore-fulfillment.integration.test.ts` through the isolated emulator launcher. It refuses non-demo project IDs and any emulator address other than the fixed local harness.
- Scenarios: concurrent single dispatch and publication; early live outlet plus partial rejection with report failure; total rejection and report recovery; duplicate partial/full refund observations; expired pre-dispatch recovery and uncertain-dispatch fencing; cancellation racing with status polling.

Supplier, public-URL and payment transport are synthetic. These tests do not publish anything, spend credits, establish contractual rights, prove live OAuth or validate live supplier/Stripe behavior. The ordinary sandbox provider remains non-billable and does not manufacture publication evidence.

## Remaining acceptance

Owner approval, credentials and a supervised minimal supplier pilot remain required. Record actual package identifiers, numeric credit response shapes, early live evidence, held/rejected cases, pending-release retraction, response-loss reconciliation and duplicate prevention. Confirm the supplier contract and customer refund policy separately. `/test` checks account/key readiness; it is not a non-billable publication environment. No scheduler, supplier call or live mutation is enabled by this document.
