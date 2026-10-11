# Customer plugin validation record

Current review branch: `codex/private-customer-mcp`, pushed through
`22d96c5f241e6b66e1dfd587720dc82f55bf98f6` before the readiness-completion pass.
Companion, guarded retention and confirmed draft-project deletion are implemented
and locally tested. Live OAuth, hosting, ChatGPT and supplier/payment acceptance
remain unverified. Entries below are dated historical snapshots; later entries
supersede earlier counts and implementation statements.

## Initial local validation — 2026-10-09

Base: fetched `origin/main` at `aba42c28fd221b98da8f0f211f4aa0640a84403e`.
Branch: `codex/private-customer-mcp`.
Worktree: `/tmp/launchauth-customer-mcp` (macOS resolves to `/private/tmp/...`).
No commits, push, deployment, live grants, credentials or links were created.

| Check | Result |
| --- | --- |
| `npm test` | PASS: 31 files, 497 tests (25 new MCP/route tests; 472 existing tests) |
| `npm run lint` | PASS: TypeScript `tsc --noEmit` |
| `npm run build` | PASS: Next.js 16.3.8 production compilation, type check, static generation; MCP and discovery routes included |
| `git diff --check` | PASS |
| Dependency install audit | 0 reported vulnerabilities; official SDK 1.32.1 and JOSE 6.2.12 resolved in lockfile |
| Original checkout | Preserved at `5c770498a373bc9443e14272fd7564b0a2c8bfcc`, only existing dirty `next-env.d.ts` |

New tests cover anonymous requests, wrong issuer/audience/signature, expiry,
missing scopes, missing expiry, not-before, ID/unsigned tokens, exact subject
mapping, no email linking, disabled/unmapped identities, browser origin denial,
per-tool scopes, revoked membership, own data, cross-customer/nonexistent projects,
strict input schemas, paging/limits, request-size limit, stateless initialization,
three tool annotations, sanitized failures/outputs and no data mutation.

The final full suite, TypeScript check and production build passed after the independent review fixes and additional route/auth tests.
The repository's existing Vite CommonJS/ESM future-compatibility warning remains;
it does not fail the run. The first sandboxed dependency fetch failed with DNS
ENOTFOUND; the approved retry succeeded. An initial typecheck found use of a
nonexistent Firestore `app` property; this was corrected by injecting the Firebase
user lookup, then all checks passed.

Not run: Firebase emulator/live integration suites, actual provider authorization
code/PKCE exchange, remote JWKS rotation/network behavior, staging query/index
checks, ChatGPT connection/tool-selection tests, public package schema portal
validation, public review. No local tests make paid generation or live supplier
calls. The storage double is not a substitute for staging Firestore validation.

Smallest next approval: approve the Auth0 private-pilot configuration in
`PROVIDER-DECISION.md`, with an owner-specified tenant/region, staging hostname,
Firebase environment and verified test identity/linking operator. Provisioning provider/client
credentials, creating test links/grants, deployment and connecting ChatGPT each
remain subject to the owner's approval. Public packaging/review is later.


## Independent review follow-up

An independent local reviewer inspected the exact uncommitted patch without
editing it or calling live services. No blocking auth, tenant-isolation, leakage,
hidden-mutation or transport-lifecycle defect was found. The follow-up fixed tool
discovery to publish top-level OAuth `securitySchemes` (the SDK version emits only
standard fields), retained the `_meta` mirror, and added `error_description` to
reauthorization challenges. The resulting TypeScript schema mismatch was fixed
by validating generated input JSON Schema with the SDK schema and typing the
OpenAI extension explicitly. Tests assert the wire metadata and retained strict
input validation. Added tests cover signed HS256, future issued-at, explicitly
disabled/mismatched mapping records, and actual disabled/incomplete routes
returning 503 before Firebase initialization.

No deployment command, hosting write API, OAuth setup, remote data mutation,
grant creation or live Firebase/supplier call was executed. Build scripts are
local Next.js compilation only. No deployment configuration was changed. This
verifies this task's actions and local patch; it is not a remote infrastructure
audit of unrelated actors.

Independent re-review after fixes: TypeScript PASS; focused MCP/route tests
25/25 across 2 files PASS; whitespace check PASS. No remaining blocking review
findings. Live provider/Firestore/ChatGPT integration remains unverified.

## Guided companion extension — 2026-10-10 (historical snapshot)

- Full local suite: **515/515 tests passed across 33 files**.
- TypeScript `npm run lint`: PASS.
- Production `npm run build`: PASS after final implementation changes.
- `git diff --check`: PASS; original checkout still has only its pre-existing
  dirty `next-env.d.ts`; isolated worktree's generated declaration is unchanged.
- Independent reviewer found autosave-target and legacy-approval consistency
  blockers, both fixed and regression checked. Final re-review: no must-fix
  security/data-integrity finding. Refresh recovery and project URL sync were
  additionally corrected and independently inspected.

New coverage includes create/resume without network, add/edit/remove facts,
approval/source invalidation, assumptions, revision history, stale/concurrent
saves, idempotent retries/key reuse, exact-version campaign approval, tenant
bypass, canceled-order freeze, upload MIME/UTF-8/size/HTML/credential rejection,
bounded export, explicit generator input propagation with no raw source upload,
MCP write scope/verified identity, CSRF, body size, missing authentication/storage,
and rejection of legacy edits/reanalysis for guided projects.

### Rendered UI QA

Flow: `/companion` → Holobots practice → brief/fact input → save → autosave →
fact approval → context export → draft JSON import → explicit campaign review/
approval → invalid-file rejection → reload/resume.

Browser skill/plugin was absent; used temporary Playwright outside the repo with
installed Chrome at `http://127.0.0.1:3199`, 1440×1000 desktop and 390×844 mobile.
All API calls were intercepted with in-memory sample responses. Page identity,
nonblank content, absence of framework/runtime errors, interaction state checks,
correct autosave target after editing the resume ID, reload and mobile horizontal
overflow checks passed. Screenshots were inspected; header contrast was fixed.
The cached test-browser binary was incomplete, so installed Chrome was used.
Software rendering avoided a Chrome full-page/mobile screenshot tiling artifact;
final evidence uses viewport screenshots.

Evidence outside the repository:
- `/tmp/launchauth-companion-desktop.png`
- `/tmp/launchauth-companion-mobile.png`
- `/tmp/launchauth-companion-resumed.png`
- `/tmp/launchauth-companion-browser.log`
- `/tmp/launchauth-ui-qa/check.cjs`

Real authenticated browser sessions, live/emulator Firestore, provider PKCE,
ChatGPT connection/tool selection, remote hosting and public package review were
not run. Mocked UI tests validate frontend behavior; service tests validate real
transaction logic against the in-memory Firestore double. Neither substitutes
for those live integration checks. No paid model/supplier calls, live uploads,
credentials, grants, account changes, commits, pushes or deployments occurred.

## 2026-10-10 companion real Firestore transactions

Added `tests/firestore-companion.integration.test.ts` to the guarded demo emulator launcher. Nine tests passed against actual Admin SDK reads/commits/transactions: approval and history consistency, approval invalidation after editing, concurrent fact approval versus brief edit, concurrent identical draft requests, competing draft versions, four order freeze statuses, and foreign ownership/revoked membership. No service fixes were needed. The full emulator run passed 48 tests across three files. This does not cover a deterministically forced companion approval/order commit race or source deletion, which is not implemented.

Full `npm test`: 515 passed across 33 files. `npm run lint`, `npm run build`, and `git diff --check` passed. No live provider, billing, credentials, grants, push or deployment. Retention changes are documentation proposals only.

## Approved review branch — companion retention

Approved retention code now omits sources from new history and scrubs bounded
legacy source copies on successful edits, supports owner archive/restore, and
provides explicit dry-run-by-default maintenance for eligible 30-day history and
operational events plus archived sources. See RETENTION.md for protective holds
and unresolved project deletion, provider logs and backups. No live scheduler,
TTL/security setting, destructive live cleanup or deployment was run.

Independent review found and fixed direct-client guided-project mutation bypass
(Firestore rules) and archived fulfillment preparation (transaction guard).
Reviewer reported no remaining must-fix findings and independently passed 129
persistence tests. Final full validation: 517 unit tests / 33 files; 57 emulator
tests / 3 files (18 companion tests); typecheck, production build and diff checks
passed. One intermediate test run failed from duplicate reviewer/editor guard
wording after executor reconnection; duplicate removed and final checks passed.

Before the approved push: GitHub workflows=0, hooks=[], deployments=[],
environments=[], main check-runs=[]; Pages returned 404. No local deployment
workflow, provider hosting configuration or publishing trigger was found.
Main remained aba42c28fd221b98da8f0f211f4aa0640a84403e and review branch did not
previously exist remotely. These are observed repository surfaces, not an audit
of every external provider account. Original checkout next-env.d.ts is untouched.

## Confirmed draft-project deletion completion

Added bounded atomic project deletion with exact confirmation, derived-content
acknowledgement, owner and revision checks, retry/recreation marker, HTTP 410
recovery, and explicit account-deletion HTTP 409. No real customer data was
removed. Protected/linked/legacy/unknown/oversized records block the operation.

Final validation: 519 unit tests / 33 files; 74 emulator tests / 3 files,
including 35 companion tests; typecheck, production build and diff checks PASS.
Deletion emulator cases include interrupted transaction/no partial writes,
repeated/lost-response retries, concurrent deletes, edit and final-approval races,
ownership isolation, protected records, missing-parent descendants, size guard
and direct-client recreation denial. Independent review identified and verified
fixes for orphan descendant inventory and stale concurrent-retry inventory;
reviewer reported no remaining must-fix and independently passed 34 focused tests.

Local production-build browser test with synthetic intercepted API responses
passed at 390x844: confirmation requires exact project ID plus derived-content
checkbox, payload binds displayed revision, successful deletion clears cached
content, reopened deleted URL recovers from 410, and account limitation is visible.
No runtime errors or horizontal overflow. This is not live login acceptance.

No merge, deployment, live purge, credential or hosting changes. Full account
removal needs the exact policy/identity/backups decisions listed in RETENTION.md.

## Readiness completion pass — 2026-10-10

Implemented supplier status/evidence separation and package/refund handling;
versioned package contracts and execution entitlements; customer-only fulfillment
projections; support triage/guidance; saved content recommendations; session
identity/cache and bounded-input hardening; explicit source truncation; offline
plugin preflight and an inactive staging configuration example.

Independent reviewers found and closed: partial-refund dispatch races, terminal
URL-verification recovery, directory entitlement/replay gaps, invalid customer
contract presentation, legacy campaign placeholders and Firebase ServerApp hash
cache isolation. Review is scoped; it is not a full penetration test or live
acceptance.

| Final check | Result |
| --- | --- |
| `npm test` | 587 tests passed across 41 files |
| `npm run lint` | TypeScript passed |
| `npm run build` | Production Next.js build passed |
| `node --test scripts/customer-plugin-preflight.test.mjs` | 5 passed; synthetic offline configuration only |
| Guarded Firestore emulator launcher | 86 tests across 5 files: order locks 25, diagnostics 14, companion/retention/deletion 35, supplier lifecycle 7, recommendations 5 |
| Browser, built local companion | Create/resume, correct-project autosave, fact approval, context export, draft import/exact-version approval, invalid file, desktop/mobile and runtime checks passed with intercepted synthetic API data |
| Browser, current recommendation component/CSS | Review/approval, stale export refusal, reload, mobile overflow and runtime checks passed with mocked APIs |
| Browser, built local support page | Mobile layout and disconnect guidance passed without runtime errors |
| Independent followup | 24 supplier-dispatch, 31 directory/customer-boundary and final 9 projection tests passed in reviewer runs |
| Diff/original checkout | Diff whitespace check passed; original checkout's dirty `next-env.d.ts` preserved |

An initial unit run failed to resolve the new bounded-JSON test alias; this was
corrected and the full suite rerun successfully. An initial browser harness used
a missing esbuild dependency and then an ambiguous accessible-label selector;
the fixture was rebuilt with already-installed Vite and an exact selector, and
passed. A sandboxed emulator bind probe was denied; the authorized loopback run
passed. No product failures remain from those attempts.

Not run: live Firebase/Auth, deployed rules/indexes/scheduler, real OAuth/PKCE and
ChatGPT connection, signed live/test Stripe end-to-end acceptance, real PRNow
submission/refund, real listing, customer analytics/imports, paid AI generation,
account erasure or backup restore. All supplier/crawler/HTTP responses in emulator
acceptance are synthetic; database transactions and rules are real emulator SDK
operations. No deployment, credentials, grants, live cleanup, contacts or purchases
were created.

See [completion matrix](../COMPLETION-MATRIX.md) and
[owner checklist](../OWNER-ACTIONS.md). Historical counts above remain historical.

## Staging publication blockers — local fix

Added restricted deployment access at verified Firebase session and mapped MCP
identity boundaries, plus a server-owned Firestore policy enforced by client
rules. Missing/invalid policy denies direct Web SDK/REST access, including signup
users attempting to bootstrap their own workspace. Deployed standard mode also
requires a matching explicit policy. Production/unknown runtimes default to
restricted; approved UID values and policy remain unconfigured.

Missing Firebase configuration now rejects analysis before crawling; local demo
analysis requires explicit development/loopback/exact-Origin opt-in. Restricted
login omits registration. This does not disable provider signup APIs: that remains
a separate cloud approval. See [staging access/migration](STAGING-ACCESS.md).

Local validation: 599 unit tests / 43 files; typecheck and production build;
101 actual Firestore emulator tests / 6 files, including 15 deployment-policy
cases; five offline plugin preflight tests. Independent review found and closed a
standard-mode policy mismatch and reran 15 access/session tests successfully.
No live settings/accounts, credentials, source upload or deployment were made.

## 2026-10-11 bounded audit corrections

See AUDIT-FOLLOWUP.md for independently reproduced evidence, fixes, conditional
impact and remaining failed delayed-payment recovery limitation. Final checks:

- `npm test`: **638 passed / 45 files**.
- Guarded local Firestore emulator: **109 passed / 7 files**, including six
  namespace/bootstrap cases and two additional payment concurrency/replay cases.
  Uses only `demo-launch-order-lock`, loopback and synthetic identities/data.
- `npm run lint` (`tsc --noEmit`), `npm run build`, `git diff --check`: passed.
- `node --test scripts/customer-plugin-preflight.test.mjs`: **5 passed**.
- Original audit baseline copy: **4 passed / 2 files**, independently rerun.
- Independent code review: 167 focused tests, then 55 identity/Stripe tests after
  fixing its additional Unicode HTTP-header finding; no remaining scoped must-fix.
  Reviewer did not independently execute emulator tests or full original attack.

Intermediate unit fixture failures (128) and first emulator run (17 failed, 92
passed) exposed outdated workspace fixtures after server bootstrap/namespace
hardening. Fixtures now establish the actual personal owner and inject the real
emulator Admin handle. Legacy foreign member edits explicitly deny; original
owner order-lock and real commit-race assertions remain. Final runs above pass.

Not run: live Stripe method/subscription/payment acceptance, failed delayed-session
recovery, live Auth0 linking, cloud rollout, ChatGPT connection, public approval.
No live mutations or paid calls. Original checkout's dirty next-env.d.ts remains
untouched. Pre-push remote inspection: workflows 0, hooks 0, deployments 0; absence
of remote CI is not a passing CI result. Source archive and approval plan are
regenerated outside the repo from the exact final commit, with a separate hash.
