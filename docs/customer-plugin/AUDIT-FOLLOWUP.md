# Bounded audit follow-up — 2026-10-11

Reviewed baseline: `f9cbbd241e410d55f56adff6cd2c5c90b8a79d44`.
This is a local implementation and test record, not deployment approval.

## Confirmed findings and changes

1. **Personal workspace ownership.** The old four-test audit was independently
   rerun and passed, including the real companion service accepting an orphan
   foreign membership in synthetic storage. The complete old client-rules chain
   was source-inspected, not replayed in the emulator; no complete exploit replay
   is claimed. New rules require the caller's personal namespace, parent owner
   and matching owner membership. Client workspace/member creation and deletion
   are denied. Website and companion bootstrap use a bounded Admin transaction
   that rejects orphan, foreign or extra members. Normal creation remains atomic.
   Companion authorization errors return 403. New emulator cases check denial
   at the client boundary, legacy/orphan fixtures and concurrent fresh bootstrap.
   Existing nonpersonal/team or contaminated workspaces now fail closed; any
   migration/cleanup requires separate owner review, never automatic deletion.

2. **Delayed Checkout settlement.** Signed `checkout.session.async_payment_succeeded`
   now uses the same verified settlement transaction as paid completion. Pending
   completion is acknowledged without work; failure does not fulfill or reverse
   a payment. Distinct events for the same settled session revalidate the original
   binding and stored settlement and only record receipt. They cannot requeue
   an active/completed job, resend confirmation, or undo refunds/terminal states.
   Tests use actual Stripe HMAC verification, synthetic storage and demo Firestore
   concurrency. Checkout does not restrict payment methods, but live delayed-method
   availability was not inspected. This finding remains conditional on that setup.

   **Remaining failure recovery:** a delayed failure leaves the order awaiting
   payment and the completed session bound. The current checkout route rejects
   completed sessions, so automatic retry is not supported. Before enabling delayed
   methods, design and test a verified failed-session recovery transition (including
   late success/races). Do not manually clear bindings or claim complete delayed
   payment acceptance from these tests. No live webhook subscriptions were changed;
   future approved setup must subscribe to asynchronous success as well as completion.

3. **Custom Firebase UID compatibility.** A shared safe document-segment validator
   now guards customer, payment, operator and mapping paths. Dot/Unicode UIDs remain
   verbatim; empty, over-128-character, slash/control, dot/dot-dot and Firestore
   reserved IDs fail before payment/storage. Workspace schemas and support paths
   accept the corresponding personal namespace. Existing restricted-pilot allowlist
   constraints still apply. Independent review also identified Unicode in Stripe's
   idempotency HTTP header; non-ASCII keys now use a deterministic hash while existing
   printable ASCII keys are unchanged. Local Node header validation covers this.
   The original mismatch matters for imported/custom UIDs; no live inventory read.

## Boundaries

No additional supplier/retention defect was asserted by the audit. Existing
regressions run with this patch; no paid generation, live supplier calls, Stripe
calls, credential/grant changes, cleanup, cloud upload or deployment was performed.
Live Auth0 linking, staging hosting, ChatGPT connection, legal/support owner details
and public approval remain separate gates. Staging IAM approval remains pending.

Independent review reported no remaining must-fix within this patch scope after
its Unicode-header finding was fixed; it explicitly did not run the emulator or
replay the full original chain. Exact final local checks are in VALIDATION.md.
