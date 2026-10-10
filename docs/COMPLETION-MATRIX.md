# Local completion matrix — 2026-10-10

Review branch: `codex/private-customer-mcp`. This is local implementation and synthetic acceptance, not authorization to deploy, charge, invite customers or publish a plugin.

| Workstream | Implemented and locally verified | Remaining gate |
| --- | --- | --- |
| Private customer MCP | Verified external JWT resource server, discovery, issuer/subject-to-Firebase mapping, tenant-safe project/status/report/brief/campaign tools; scoped draft-save extension | Real OAuth provider/client/PKCE grant and stable account-link flow, approved HTTPS hosting, private ChatGPT acceptance |
| Guided companion | No-URL brief, source/fact approval, context export, versioned draft import and exact campaign approval; visible 1,200-character source excerpt limits | Authenticated customer acceptance; plugin remains optional |
| Retention/deletion | Source minimization and guarded dry-run-default cleanup; confirmed atomic draft-project deletion with permanent recreation fence | Approved retention/account-erasure policies, scheduler, backup/restore treatment; no live purge ran |
| Supplier lifecycle | Distributed is processing, package live URL evidence, numeric refund accounting, independent status persistence, refund dispatch fences and bounded verification retries | Authorized supplier pilot and written commercial/idempotency limits |
| Package entitlements | Versioned owner-configured contracts frozen into orders; checkout catalog drift rejected; customer-safe contract presentation | Actual package definitions, prices, directory list and margin approval |
| Support | Read-only admin triage queue and truthful customer help/privacy/disconnect guidance | Named support owner/contact, response process and monitoring |
| SEO-01 | Bounded diagnostic jobs and review UI; real local database contention/recovery coverage | Deployed indexes/scheduler and authorized site acceptance; engine indexing remains not checked |
| SEO-02 | Deterministic fact-backed recommendations, saved review/approval, stale snapshot fences and export | Authorized customer acceptance; no automatic publication or verification of destination/freshness |
| SEO-03 | Scope and acceptance requirements documented | Choose authorized Google/Bing source, exact schema and reconciliation policy before implementation |
| SEO-04 | Scope and acceptance requirements documented | Choose property, events, consent, attribution and retention before implementation |
| Auth/security | Request token/cache identity checks, optional configured Admin revocation verification, bounded same-origin session input; independent review and regression tests | Deployed identity/revocation behavior and full operational security acceptance |
| Staging/package | Offline package preflight, private acceptance checklist, portable plugin skeleton, inactive App Hosting example | Owner-approved billing/backend/region, credentials and deployment; public submission is separate |

See [validation](customer-plugin/VALIDATION.md) for exact final commands/counts and [owner actions](OWNER-ACTIONS.md) for the dependency order. No live supplier, paid generation, checkout, customer-site crawl, OAuth grant or deployment was performed in this pass.
