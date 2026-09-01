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

The background worker is invoked through `POST /api/internal/jobs/run` with the job-runner bearer secret. Jobs use leases, crash recovery, retry backoff, and provider idempotency keys. Submitted provider orders automatically create recurring placement-verification work; public placement URLs are revalidated through a DNS-pinned request before the customer report treats them as live.

The public `/api/health` endpoint is liveness-only. The secret-protected `/api/internal/readiness` endpoint evaluates every paid-launch gate without returning secret values. It must report `readyForPaidUsers: true` before inviting paid customers.

## Verification

Run `npm run lint`, `npm test`, and `npm run build` before release. After changing Firestore rules, deploy them and run `npm run test:integration:firebase`; the live test creates two temporary accounts, proves cross-tenant access is denied and evidence is immutable, then deletes its test records and accounts.
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ROADMAP.md](ROADMAP.md)
- [research/SUPPLIER_MATRIX.md](research/SUPPLIER_MATRIX.md)
