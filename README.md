# Launch Auth

Launch Auth is the working codename for an AI Launch & Authority Engine.

This repository contains the working paid-MVP foundation. The project is intentionally evidence-first: verified, inferred, assumed, and unknown claims are kept distinct, generated copy is bounded to approved evidence, and dashboard outcomes come from stored fulfillment evidence rather than seeded demo data.

Start with:

- [VISION.md](VISION.md)
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
- [MVP.md](MVP.md)
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)

## Production foundation setup

The app keeps working in explicit local mode when Firebase is not configured. To enable authenticated, persistent workspaces:

1. Create the Firebase project and register a Web app.
2. Copy `.env.example` to `.env.local` and add the public Firebase Web configuration.
3. Enable Email/Password in Firebase Authentication.
4. Create the default Cloud Firestore database in production mode.
5. Deploy `firestore.rules` and `firestore.indexes.json` with the Firebase CLI.

Firebase Web configuration is public application metadata, not an administrator credential. Never add service-account JSON or private keys to browser-visible environment variables. Workspace data is protected with Firestore Security Rules and authenticated user context.

Server-controlled campaign approvals, payment, order, job, directory, and placement records require `FIREBASE_SERVICE_ACCOUNT_JSON` (or Application Default Credentials on Google Cloud). OpenAI and Stripe secrets are server-only. Checkout uses Stripe-hosted Checkout Sessions, automatic tax, server-side Price IDs, signed webhooks, exact order reconciliation, and idempotent fulfillment transitions. Live checkout refuses non-billable sandbox fulfillment.

The background worker is invoked through `POST /api/internal/jobs/run` with the job-runner bearer secret. Jobs use leases, crash recovery, and retry backoff. PRNow is implemented as a guarded pilot adapter, but its public API does not promise submit idempotency: an uncertain submit response stops for human reconciliation instead of retrying. Submitted provider orders automatically create recurring placement-verification work; public placement URLs are revalidated through a DNS-pinned request before the customer report treats them as live.

The internal `/admin` workspace includes a non-publishing provider preflight plus journaled supplier-cancellation and Stripe-refund controls. Supplier credit recovery and customer card refunds are separate operations. Stripe’s signed webhook remains the source of truth for final customer billing state.

The public `/api/health` endpoint is liveness-only. The secret-protected `/api/internal/readiness` endpoint evaluates every paid-launch gate without returning secret values. It must report `readyForPaidUsers: true` before inviting paid customers.

## Verification

Install dependencies with `npm ci` to use the reviewed lockfile, and run `npm audit` when updating dependencies. The scoped `@firebase/firestore` override keeps `@grpc/grpc-js` on patched version 1.14.5 because Firestore 4.17.1 still requests the vulnerable 1.9.x line. Remove the override only after the upstream dependency resolves to a patched version, and rerun the isolated Firestore suites after changing it.

Run `npm run lint`, `npm test`, and `npm run build` before release. After changing Firestore rules, deploy them and run `npm run test:integration:firebase`; the live test creates two temporary accounts, proves cross-tenant access is denied and evidence is immutable, then deletes its test records and accounts.

Use the [isolated Firestore order-lock suite](scripts/FIRESTORE_ORDER_LOCK_TESTS.md) to test direct client writes and edit/order races locally without credentials or live data. Its passing result does not verify deployment; keep `FIRESTORE_RULES_VERIFIED=false` until the current rules pass target-environment acceptance.

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ROADMAP.md](ROADMAP.md)
- [research/SUPPLIER_MATRIX.md](research/SUPPLIER_MATRIX.md)

## SEO and AI-search research

- [SEO and AI-search research brief](research/SEO_AI_SEARCH.md): primary-source findings and measurement limitations. Customer-site diagnostics, evidence-backed recommendations, Google/Bing report imports, and AI referral/conversion tracking are [committed scope](PRODUCT_SPEC.md#committed-remaining-scope-customer-seo-and-ai-search-engagement); the expanded scope is not complete and contains no ranking guarantees.
- The first diagnostic slice is implemented under **Brand Intelligence → Customer-site diagnostics** for saved projects. Explicit authorization queues a bounded public-site inspection; reports and evidence downloads retain their limitations and always label engine index inclusion **not checked**. Firebase Admin, deployed `siteDiagnosticJobs.status` collection-group indexing, and the scheduler are required. See [OPERATIONS.md](OPERATIONS.md#customer-site-diagnostics). Owner-authorized acceptance, real engine indexing evidence, content recommendations, report imports and referral/conversion tracking remain outstanding.
