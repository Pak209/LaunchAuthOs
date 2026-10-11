# Payment recovery completion record

This is the narrowed, payment-only continuation of review branch
`codex/private-customer-mcp`, based on `bc92f19ddacd406894538c002581c5a54ce3b33e`.
It supersedes the failed-payment recovery limitation recorded at that commit.
Unrelated working-tree documentation and blocked namespace/historical artifacts
are deliberately outside this commit and its source archive.

| Item | Implemented behavior | Acceptance boundary |
| --- | --- | --- |
| Delayed failure | Signed unpaid failure is matched to the current session, attempt, identity, mode, price and amount; the failed intent ID is retained. Failure cannot reverse settled/refunded orders. | Synthetic signed webhook sequences passed; no live webhook registration or delivery check. |
| Retry | Fresh server retrieval expands the PaymentIntent. Replacement requires an expired unpaid session without an intent, or a canceled zero-received intent. Completed canceled sessions also need the matching recorded failure. | Database transaction verifies current binding and advances the attempt once; nonterminal, unknown or mismatched state returns 409. |
| Duplicate/racing events | Exact event receipt deduplication and settled-session revalidation preserve refunds and active/terminal work. Original retired bindings are retained. | Concurrent retry/settlement and duplicate-event fixtures passed. |
| Contradictory late payment | A paid observation for a retired attempt creates a durable reconciliation hold; checkout binding and both dispatch checks honor it. | No automatic second fulfillment, refund or policy decision. Already dispatched external work cannot be recalled; its receipt remains available for reconciliation. |
| Customer/operator feedback | Safe failure/hold flags and support triage indicate reconciliation; payment-intent IDs remain excluded from the customer projection. | Local projection tests passed; no customer contact or live support action. |
| Full application validation | Previous full-suite result at base: 638 unit tests and 109 emulator tests. | **Not rerun for this payment commit.** Do not treat those historical counts as final-patch full validation. |
| Release | Scoped review-branch commit and exact Git-source archive only. | Live Stripe/supplier calls, cloud changes, upload/deployment, OAuth setup and public review remain outside this work. |

No commercial policy is needed for these guards. A completed PaymentIntent in
`requires_payment_method`, `processing`, authentication-required or unknown state
is not permanently closed: it requires reconciliation, not a second payable
session. No automatic cancellation or refund is attempted. Dynamic payment-method
configuration is unchanged and live account settings were not inspected.

Stripe documents [Checkout's payment intent relationship](https://docs.stripe.com/api/checkout/sessions/object),
[when a session can expire](https://docs.stripe.com/api/checkout/sessions/expire),
and [cancellation restrictions](https://docs.stripe.com/api/payment_intents/cancel).
The implementation uses those terminal-state constraints rather than assuming
that a failure notification permanently prevents future payment.

## Final scoped checks

- **120 unit tests passed / 9 explicitly selected payment-related files**:
  `checkout-recovery`, `checkout-recovery-route`, `stripe-webhook-sequence`,
  `stripe`, `customer-fulfillment`, `fulfillment-dispatch`, `fulfillment-summary`,
  `package-contract`, and `support-triage`.
- **6 payment emulator tests passed; 6 unrelated tests skipped** in the one
  fulfillment integration file. The dedicated payment config selects refund
  deduplication, concurrent settlement, late settlement after refund, competing
  terminal retries, settlement-versus-retry, and payment-hold dispatch denial.
- **Typecheck and production build passed** against an isolated snapshot assembled from
  committed runtime sources plus an explicit billing-file allowlist. Blocked
  namespace/historical test scripts and unrelated working-tree edits are absent.
- Independent review reported no must-fix. It passed 80 focused tests in the
  earlier snapshot and 67 focused tests for the final functional delta; one
  redundant guard was then removed without changing behavior.
- No aggregate tests, blocked security tests, live payment/supplier calls or
  cloud mutations were executed in this narrowed continuation.

Reproduce the unit selection with `node node_modules/vitest/vitest.mjs run` and
the nine filenames above (each under `tests/` with `.test.ts`). The emulator entry
point is `node scripts/test-payment-recovery.mjs`; it requires the same local CLI,
Java and emulator-cache paths as the existing guarded test tooling. Its config
includes one payment file and an explicit title filter; it never invokes the
aggregate namespace/historical test configuration.
