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
