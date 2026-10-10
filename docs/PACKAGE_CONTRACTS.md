# Package entitlement contract

Live offers and checkout fail closed until the owner approves concrete package definitions. Existing package identifiers are `launch`, `authority`, and `authority_plus`; their names do not establish quantities, publication guarantees or paid-directory fees.

`PACKAGE_CONTRACTS_JSON` is a server-owned JSON array. Each entry has `schemaVersion: 1`, a unique packageId, an owner-managed revision, `environment: "live"`, `providerSubmission: true`, a configured Stripe `priceId`, and `directoryIds` selected from `betalist`, `uneed`, `sourceforge`. Empty directoryIds is valid. Unknown fields, duplicate packages/directories, missing prices and unapproved configuration are rejected. Set `PACKAGE_CONTRACTS_APPROVED=true` only after commercial and operational review. No live definitions or prices are supplied by the code.

This schema describes the existing supplier-submission workflow and assisted directory tasks only. Directory inclusion is not publication/acceptance, and additional services require an explicit schema/workflow change. Existing independent supplier cost/plan, legal and live-payment readiness gates still apply.

Preparation freezes a canonical digest and revision on the order. Checkout rejects changed definitions or Stripe price bindings. Paid execution must use the frozen contract, not reinterpret an earlier sale using current environment configuration. Legacy orders without a contract require reconciliation; do not infer historical promises or backfill guessed entitlements. Reports expose the frozen contract or explicitly mark it unavailable.

Non-billable sandbox preparation retains the three existing demonstration tasks for each package under `sandbox-demo-v1`. These are test fixtures, not three commercial offers. Sandbox contracts cannot authorize live checkout. This implementation does not establish supplier acceptance or live Stripe verification.

Owner decisions before selling: exact per-package assisted task inclusion, reviewed Stripe price mapping, supplier terms/cost, final customer-facing agreement and review revision. No environment values have been changed live.
