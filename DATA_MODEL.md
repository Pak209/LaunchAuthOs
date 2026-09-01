# Launch Auth — Data Model (draft)

## Primary entities

- `workspace`: tenant, settings, billing state.
- `project`: company/product URL and lifecycle.
- `brand_profile`: normalized facts, confidence, version.
- `evidence_item`: source URL, excerpt/hash, captured time, fact references.
- `campaign`: approved canonical claims and status.
- `campaign_asset`: generated artifact, type, version, approval state.
- `provider` / `provider_order`: adapter identity, quote, external ID, state.
- `directory` / `directory_submission`: capability, required fields, human action, outcome.
- `placement`: outlet, URL, state, first/last verified, evidence.
- `job_run`: idempotency key, attempts, logs, error classification.

All externally observed claims should link to one or more evidence items.

## Firebase V0.2 layout

The production foundation now uses these tenant-isolated records:

- `users/{uid}`: account profile and last-seen metadata.
- `workspaces/{workspaceId}` and `members/{uid}`: tenant and role boundary.
- `projects/{projectId}`: resumable project summary, readiness, and lifecycle state.
- `projects/{projectId}/profiles/current`: editable structured brand profile.
- `projects/{projectId}/evidence/{snapshotId}`: immutable source excerpt, content hash, and capture time.
- `projects/{projectId}/claims/{claimId}`: editable claim, evidence links, confidence, and approval.
- `projects/{projectId}/campaigns/current`: evidence-gated campaign state and approved claim IDs.
- `projects/{projectId}/campaignApprovals/current`: server-owned digest and version attesting to the exact customer-approved campaign.
- `projects/{projectId}/orders/current`: provider quote, campaign digest/version, expected Stripe checkout binding, billing state, refund totals, and fulfillment state.
- `projects/{projectId}/jobs/{jobId}`: durable state, attempts, consecutive failures, idempotency key, lease token/expiry, retry time, and last error.
- `projects/{projectId}/directorySubmissions/{directoryId}`: assisted/manual customer actions and observed outcome.
- `projects/{projectId}/placements/{placementId}`: submitted/accepted/published/indexed/failed/removed state, provider observation, public URL, HTTP result, and first/last verification.
- `projects/{projectId}/auditLogs/{eventId}`: server-owned approval, billing, fulfillment, verification, and administrator actions.
- `stripeEvents/{eventId}`: signed Stripe webhook idempotency ledger.

The project document retains a denormalized current view for fast resume and backward compatibility. Customer-readable data stays tenant-scoped; campaign approvals, orders, jobs, placements, audit logs, and Stripe events are written only by server-controlled code.
