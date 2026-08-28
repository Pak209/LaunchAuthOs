# Launch Auth — Architecture (draft)

## Recommended starting shape

Use a modular TypeScript web application with a relational database and a durable background-job boundary. Keep crawling, LLM extraction, fulfillment, directory submissions, and verification as separate workers behind application interfaces.

Implemented thin slice: Next.js/TypeScript with a Node runtime analysis endpoint. Firebase Authentication and Cloud Firestore are now the selected production identity/persistence boundary. The server continues client-created Firebase identity tokens through short-lived HTTP-only cookies and `FirebaseServerApp`, so Firestore operations execute in user context and remain subject to workspace security rules. An explicit no-credentials local fallback remains available. Stripe checkout, an LLM provider, and a queue/job runner remain **ASSUMED** until their production boundaries are selected.

## Boundaries

- Brand Intelligence: crawl, extract, normalize, preserve evidence.
- Campaign: claim approval, canonical object, asset generation.
- Fulfillment: provider and directory adapters; idempotency keys.
- Evidence: placement state machine and verification snapshots.
- Reporting: customer-safe projections of observed facts.

Provider adapters must expose a stable contract for quote, submit, status, cancel/refund request, and evidence retrieval. No customer-facing code should depend on a named supplier.

## URL intake controls

The crawler accepts only public HTTP/HTTPS pages, rejects credential-bearing and local/private targets, resolves DNS before fetching, refuses redirects, limits declared and retained HTML size, requires HTML content, and times out. Production hardening must also pin and revalidate the connected IP to close DNS rebinding and redirect edge cases at the transport layer.
