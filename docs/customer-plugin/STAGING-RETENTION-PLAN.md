# Staging and retention decision — 2026-10-10

## Verified inventory (read-only)

- Repository Firebase project: `launch-auth-54e1a`; default Hosting site exists at `https://launch-auth-54e1a.web.app`. Site existence does not prove a deployed application or safe staging isolation.
- Existing Firebase CLI login successfully listed that site. No reauthentication is currently required for that read. Initial sandbox calls misleadingly reported invalid credentials; the approved network-enabled read succeeded.
- App Hosting inventory command was blocked: project must be on Blaze and App Hosting API cannot be enabled before upgrade. No upgrade/API enablement succeeded. Do not repeat commands that can automatically enable APIs without approval.
- No hosting/App Hosting configuration in this branch. Original checkout `.env.local` has only app URL/fulfillment sandbox settings; this isolated branch has no `.env.local`. No configured OAuth tenant/client or live Admin credential was established by this inspection. This does not prove the owner has no provider account elsewhere.
- Existing site must not be overwritten. No customer record read, deployment, DNS change, OAuth client, credential, grant, link, account or subscription was created.

## Proposed target, pending owner decision

Use a separate staging Firebase project (proposed ID `launchauth-companion-staging`, availability unverified), Firebase App Hosting backend `companion-pilot`, owner-approved region, and its provider-generated HTTPS hostname. Exact generated URL is assigned by the provider; it cannot honestly be supplied before backend creation. Do not use the current default Hosting site's live channel. A new domain is unnecessary.

App Hosting requires Blaze billing; included free quotas are not a spending cap or guarantee of zero charges. Need owner billing-account choice and spend authorization before provisioning. Budget alerts alone do not cap costs. Vercel Hobby is restricted to personal noncommercial use, so it is not an assumed free business alternative. Auth0 advertises a free plan (25,000 MAU); verify this tenant's required OAuth features before setup, without purchasing a plan.

Smallest immediate decision: approve the staging provider/project/region and a spending ceiling, and identify an existing Auth0 development tenant or authorize owner-led signup. Then present the actual backend URL and exact config/permissions before deployment or OAuth provisioning. Source upload is a deployment, even without a Git push; only an inspected staging build should be uploaded.

Subsequent action-time approval bundle: dedicated staging resources/runtime identity permissions; exact allowed Firebase Auth hostname; exact MCP resource URL; Auth0 API/public PKCE client and callback; one owner-controlled synthetic test user in each identity system; explicit verified issuer/subject-to-Firebase-UID link; configuration/secret entry by owner; one private ChatGPT connection/grant. No production data copy, payment/supplier secrets, paid model calls, public signup/invites, or automated worker schedule. Deploy only after preventing access to legacy payment/generation/supplier routes in the staging surface; withholding credentials alone is not the complete isolation plan.

User may need Auth0 and ChatGPT browser login and billing-console confirmation. Existing Firebase CLI read login currently works. Do not ask the user to paste credentials into chat. Prefer runtime identity on Google hosting over a downloaded service-account key. Current code recognizes Cloud Run `K_SERVICE`, but actual runtime IAM and SDK compatibility remain to be tested.

## Integration acceptance before enabling customer data

1. Credential-free local tests: JWT negative cases, scope/tenant checks, companion route CSRF/auth/body bounds, state/version races and generation context; isolated demo Firestore rules/transaction suites.
2. Companion-specific emulator coverage now exercises real Admin transactions for approval/edit concurrency, draft idempotency/concurrency, frozen orders, and ownership/membership denial. Deterministically scheduled final-approval/order races and complete source-deletion traversal remain future coverage; deletion is not designed or approved yet.
3. Approved staging: website Firebase login/logout/expired cookie; OAuth discovery and PKCE S256 authorize/token exchange with exact resource and callback; stable verified dual-identity mapping; every tool success/denial; token expiration/key rotation/revocation behavior; no payment/supplier/generation side effects.
4. Private ChatGPT tool discovery, read calls, separately consented draft-save scope, reconnect/revoke. User-facing login and permission prompts require actual browser acceptance; local unit tests cannot prove them.

Do not run `test:integration:firebase` against the existing project: it creates live users and records and requires explicit target/test-account approval.

## Approved retention defaults, local implementation only

See [RETENTION.md](RETENTION.md) for the approved source-active-plus-30-days-after-archive, current-brief/draft-until-deletion, and 30-day-history/log defaults, implemented code, protective exceptions, and live execution boundary. No live scheduler, purge or backup policy was enabled. Paid/approval/report and backup expiry remain undecided. Provider logs and complete project/account deletion remain deployment blockers for real customer data.

## Official sources

- https://firebase.google.com/docs/app-hosting/costs
- https://firebase.google.com/docs/app-hosting/get-started
- https://auth0.com/pricing
- https://vercel.com/docs/limits/fair-use-guidelines
- https://firebase.google.com/docs/firestore/manage-data/delete-data
- https://firebase.google.com/docs/firestore/backups
