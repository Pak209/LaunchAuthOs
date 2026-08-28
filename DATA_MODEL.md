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

## Firebase V0.1 layout

The current thin slice uses `workspaces/{workspaceId}` with `members/{uid}` and `projects/{projectId}` subcollections. Brand profile, readiness, bounded sources, evidence claims, and campaign state are stored together in each project document so analysis updates and approval transitions remain atomic within Firestore's document boundary. Higher-volume placements, reports, jobs, and monitoring snapshots will move into project subcollections as those phases are implemented.
