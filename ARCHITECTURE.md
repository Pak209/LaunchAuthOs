# Launch Auth — Architecture (draft)

## Recommended starting shape

Use a modular TypeScript web application with a relational database and a durable background-job boundary. Keep crawling, LLM extraction, fulfillment, directory submissions, and verification as separate workers behind application interfaces.

Implemented foundation: Next.js/TypeScript with Node runtime server boundaries. Firebase Authentication and Cloud Firestore are the production identity/persistence boundary. The server continues client-created Firebase identity tokens through short-lived HTTP-only cookies and `FirebaseServerApp`, so customer Firestore operations execute in user context and remain subject to workspace security rules. Firebase Admin owns campaign attestations, billing, fulfillment, jobs, placements, and audit records. Projects have normalized profile, immutable evidence, claim, campaign, order, job, placement, and resumable project records. The crawler and placement verifier resolve and validate public addresses, then pin the outbound socket to the validated address while preserving TLS hostname verification.

OpenAI campaign generation, Stripe Checkout/webhooks, durable job leasing, transactional email, evidence reports, and the admin queue are implemented behind server-only boundaries. The distribution adapter interface is complete, but the only current implementation is an explicitly non-billable sandbox. A named production supplier remains an external release gate.

## Boundaries

- Brand Intelligence: crawl, extract, normalize, preserve evidence.
- Campaign: claim approval, canonical object, asset generation.
- Fulfillment: provider and directory adapters; idempotency keys.
- Evidence: placement state machine and verification snapshots.
- Reporting: customer-safe projections of observed facts.

Provider adapters must expose a stable contract for quote, submit, status, cancel/refund request, and evidence retrieval. No customer-facing code should depend on a named supplier.

Background work is stored in project job documents. Workers claim jobs transactionally with a time-bounded lease and unique run token. Expired leases are recovered, transient failures use bounded exponential backoff, and provider submission is protected by a stable idempotency key. A successful submission schedules recurring provider/evidence polling. Placement state changes are derived from provider observations plus an independent, DNS-pinned public URL check.

## URL intake controls

The crawler accepts only public HTTP/HTTPS pages, rejects credential-bearing and local/private targets, resolves DNS before fetching, refuses redirects, pins the connection to a validated public address, limits declared and retained HTML size, requires HTML content, and times out. The placement verifier applies the same public-address and connection-pinning boundary and treats unvalidated redirects as retryable rather than following them.
