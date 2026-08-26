# Launch Auth — Architecture (draft)

## Recommended starting shape

Use a modular TypeScript web application with a relational database and a durable background-job boundary. Keep crawling, LLM extraction, fulfillment, directory submissions, and verification as separate workers behind application interfaces.

Likely implementation: Next.js/TypeScript, Postgres-compatible storage, Stripe checkout, an LLM provider, and a queue/job runner. Final choices remain **ASSUMED** until repository and supplier research validate them.

## Boundaries

- Brand Intelligence: crawl, extract, normalize, preserve evidence.
- Campaign: claim approval, canonical object, asset generation.
- Fulfillment: provider and directory adapters; idempotency keys.
- Evidence: placement state machine and verification snapshots.
- Reporting: customer-safe projections of observed facts.

Provider adapters must expose a stable contract for quote, submit, status, cancel/refund request, and evidence retrieval. No customer-facing code should depend on a named supplier.
