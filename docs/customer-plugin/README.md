# LaunchAuth private customer MCP prototype

**Current extension:** See [Guided companion](COMPANION.md) for the implemented website brief, text intake, campaign review and three additional companion tools. The original read-only foundation below is retained for setup context; the companion document supersedes its tool/body-limit scope.

Implemented and pushed to the separate review branch; disabled by default. No live OAuth provider, account links,
credentials, hosting, ChatGPT connection, marketplace installation or publication
has been created. This is the customer product integration, separate from the
Lex/Go collaboration workflow. The website retains Firebase email/password authentication; request identity/cache checks and session input handling are additionally hardened.

## Scope and architecture

`POST /api/mcp` uses the official TypeScript MCP SDK's stateless Streamable HTTP
transport with JSON responses. Each request authenticates independently; no
shared authenticated sessions. GET/DELETE return 405 after authentication.
`GET /.well-known/oauth-protected-resource/api/mcp` publishes resource metadata
when configured. Both endpoints return 503 while disabled/unconfigured.

| Tool | Required scope | Data returned |
| --- | --- | --- |
| `list_launch_projects` | `launch:projects:read` | Own project ID, name, campaign state, update time |
| `get_campaign_status` | `launch:status:read` | Own project campaign state and intelligence or fulfillment job IDs/types/states/update times |
| `get_placement_report` | `launch:reports:read` | Own placement IDs, outlets, URLs, recorded states, publication/verification dates and limitations |

The three foundational tools above are read-only, idempotent and bounded to 20 records by default, maximum
50. Use the returned `nextCursor` as `after`; for status retain `jobKind` and
`projectId` on subsequent pages. Pagination follows document IDs, not recency,
and is not a snapshot across concurrent updates. Ownership filtering can produce
empty pages with a non-null cursor. Null cursor ends pagination. Reports with no
placements return an empty list, without creating or refreshing anything.

The dedicated Admin Firestore reader performs membership and ownership checks
because Admin SDK reads bypass Firestore security rules. Only personal workspaces
are supported. No calls to existing `ensureWorkspace`, generation, fulfillment
workers, supplier APIs or checkout occur. Free-form failure messages, run tokens,
provider/order/payment data, campaign assets, contacts, evidence and user emails
are excluded. Placement URL query strings/fragments are removed. Remaining
customer-authored names/outlets/URLs must be treated as untrusted data.

## OAuth provider contract and account linking (owner setup required)

Use an established authorization provider, not an authorization server in this
Next.js app. Select a provider/plan that supports authorization code with S256
PKCE, resource indicators, the required scopes, discovery, and a supported
ChatGPT client registration method (CIMD, DCR or a predefined client). Auth0 is the recommended first pilot provider; see [the concrete proposed configuration and owner inputs](PROVIDER-DECISION.md). No provider
account or paid plan has been selected. Discovery/callback compatibility still
needs an end-to-end test against the selected provider and ChatGPT.

Set the non-secret variables shown in `config.env.example` only after reviewing
the integration. Resource must be the canonical HTTPS origin plus `/api/mcp`;
its exact string is the required token audience. Issuer comparison is exact,
including trailing slash. Pin the provider's HTTPS JWKS URL through trusted
configuration; token headers never select a key URL. The verifier uses JOSE,
allows RS256/ES256 only, and requires `typ: at+jwt`, issuer, subject, audience,
expiry and issued-at. It validates signatures, expiry, optional not-before,
and rejects future issued-at. Providers issuing opaque tokens or a different
access-token profile need a reviewed adapter; do not weaken validation or accept
Firebase website ID tokens as MCP access tokens.

After signature/claim validation, the server reads:

`customerMcpLinks/{sha256(JSON.stringify([issuer, subject]))}`

Expected server-owned record: `{ issuer, subject, firebaseUid, enabled: true }`.
The exact issuer/subject pair is the stable identity. Firebase Auth must report
an existing, enabled user. Every call then requires the user's current personal
workspace membership and, for project resources, matching `createdBy` and
`workspaceId`. Unknown, disabled or mismatched links fail closed. Clients cannot
write this collection under the existing default-deny Firestore rules.

**No account-linking writer or user consent UI is implemented.** Before creating
any live links, approve a linking process that independently verifies control of
both the OAuth identity and existing Firebase account using fresh authenticated
sessions, binds the flow to the session with CSRF/state protection, and records
consent. Never match on email or accept a client-provided Firebase UID. For the
first private tester an explicitly approved operator-assisted mapping can use
verified identities; document the verification and revocation procedure. No
mapping has been provisioned by this task. Revoke a link by disabling/deleting
its record through an approved administrative procedure. Request-time link and
Firebase checks make that effective on the next request; already issued access
tokens otherwise remain valid until expiry. Use short-lived access tokens and
provider-managed refresh rotation/revocation.

## Private connection procedure (not executed)

1. Approve the OAuth provider, controlled staging HTTPS hostname, Firebase
   project/data boundary and private test identities. Provision no customer links
   until the identity verification process above has been reviewed.
2. Configure the provider's audience/scopes, S256 PKCE and discovery. Take the
   exact redirect URI/client registration details from the actual ChatGPT
   connection setup. Do not guess callback URLs or commit client secrets.
3. Deploy to approved staging with existing server-only Firebase configuration,
   narrowly scoped infrastructure access, HTTPS, request/rate limits and sanitized
   logs. Enable the MCP feature only there. This code limits request bodies to
   16 KiB but does not implement distributed rate limiting. Approve quotas before
   enabling it: reads, token key retrieval and Firebase user checks incur load.
4. Verify discovery, missing-token 401 challenge, invalid-token rejection and
   scopes. Verify Firestore query/index availability on staging. Run a two-user
   isolation test, membership removal, link disable and disabled-user checks.
5. In ChatGPT Plugins choose Add custom MCP server, use the staging `/api/mcp`
   endpoint and OAuth, review the connection warning, then Create as a plugin.
   Install privately and test all six tools in a fresh chat. This step creates
   a connection/grant and requires separate approval.
6. Test realistic prompts, page traversal, empty reports, revoked permissions,
   expired access tokens and reauthorization. Confirm read tools produce no writes or generated jobs, only the explicitly scoped draft-save tool writes,
   and no provider secrets appear in responses or logs.

`package/` is a portable packaging skeleton matching the current documented
`plugin.json` / `mcp.json` shape. Its `.invalid` endpoint deliberately cannot
connect. Replace it only after hosting approval. Choose provider-supported OAuth
client registration settings at that point; secrets never belong in the package.
No fabricated registered `plugin_asdk_app` identifier, privacy URL or publisher
identity is included. The package has not been portal-validated or submitted.

## Privacy, support and release checklist (owner decisions, not legal text)

- Confirm publishing entity, support contact and supported countries.
- Approve privacy notice covering data sent to ChatGPT, OAuth/Firebase processing,
  purposes, retention/logging, deletion, access revocation and subprocessors.
- Supply approved privacy/terms/support URLs; none are invented here.
- Define user consent/linking, unlinking, account deletion and incident ownership.
- Review minimal scopes, rate limits, log redaction and data residency.
- Validate provider PKCE/discovery/refresh/revocation and the exact ChatGPT callback.
- Validate staging Firestore reads/indexes and rules denial of client link writes.
- Complete private tool-selection, injection, isolation and regression testing.
- Keep digital-service sales, upsells, checkout, supplier submissions and admin
  operations outside this plugin. Review the current public guidelines again
  before public submission; the useful scope is launch management.
- Separately approve deployment, test grants, any invitations and public review.
  Prepare reviewer test data/credentials privately only after approval.

## Official sources checked 2026-10-09

- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)

## Local verification

Run `npx vitest run tests/customer-mcp.test.ts`, `npm test`, `npm run lint`, and
`npm run build`. Tests use ephemeral local signing keys and an in-memory read-only
Firestore double; no live OAuth, Firebase, supplier, payment or generation calls.
Live/emulator integration tests are intentionally excluded by the existing test
configuration unless explicitly enabled. See `VALIDATION.md` for this run's results.

## Staging and package gate

See [PRIVATE-ACCEPTANCE.md](PRIVATE-ACCEPTANCE.md) for offline package checks,
private installation prerequisites, approval dependencies and unexecuted live
acceptance cases. The package now includes a scoped companion workflow skill and
an explicit placeholder public OAuth client. Neither is a registered connection.
