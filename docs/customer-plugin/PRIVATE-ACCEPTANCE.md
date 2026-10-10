# Private staging acceptance

This is an offline preparation checklist, not deployment approval or evidence of
live acceptance. No domain purchase is required: an approved provider-generated
HTTPS hostname can serve the application. Allocation of `web.app` does not prove
the dynamic Next.js app is deployed. Hosting budget, region and project remain
owner decisions. Do not enable paid checkout, supplier submission or schedulers.

## Offline package gate

Run from repository root:

```
node --test scripts/customer-plugin-preflight.test.mjs
node scripts/customer-plugin-preflight.mjs
```

The second command intentionally exits 1 for the checked-in `.invalid` skeleton.
It prints check identifiers only, never environment values. It reads only the two
package JSON files and the calling process environment; no .env file loading,
network requests, authentication, registration, filesystem writes or deployment.
Its curated structural/policy checks are not full upstream JSON-schema validation
or portal validation. A passing configuration still reports live acceptance false.

The portable package contains root `plugin.json`, `mcp.json` and one bundled
`skills/launch-companion/SKILL.md`. Copy it to an approved private local marketplace
only after configuration. The manifest's client ID is deliberately unresolved;
client secrets never belong in this directory. No local marketplace is installed
or automatically registered by this repository. The package is structurally
prepared, not currently connectable or proven installable in the host.

## Approval-dependent staging sequence

1. Approve staging project/provider, region, budget and runtime permissions. Deploy
   this reviewed branch explicitly to that target with isolated synthetic data.
   Keep `CUSTOMER_MCP_ENABLED=false` during initial setup.
2. Owner registers the provider's public authorization-code client, exact host
   callback, PKCE S256 and no client-secret authentication. Configure the pinned
   issuer, JWKS and audience/resource; verify provider discovery and access-token
   profile. Owner enters credentials privately; do not copy them into tickets.
3. Verify the Firebase user link using immutable verified issuer+subject, active
   user and owned workspace. Email alone is not a link. Deny client-side writes to
   link records. Use two independently consented synthetic identities.
4. Configure approved HTTPS resource URL/client ID in a private package copy and
   environment. Run the offline gate. Separately approve enabling the MCP route
   and creating the private ChatGPT connection/grant. Register its actual callback;
   never guess an app identifier. Recheck host installation requirements then.
5. Test six tools in a fresh private chat: list projects, status, report, brief,
   saved campaign and explicitly confirmed draft save. Final approval remains on
   the website. Read calls must produce no writes, charges or generation.

## Live acceptance evidence to collect (not yet executed)

Record timestamp, deployment commit, check ID, pass/fail and sanitized request ID;
never token, source text or customer draft payload. Verify HTTPS discovery and 401
challenge, PKCE exchange, exact audience, wrong issuer, expired token, missing
scope, two-customer isolation, origin policy, pagination, conflict/retry behavior,
and both allowed and denied draft saves. Verify website login/session behavior.

Disable the identity link then verify the next call is rejected; disconnect in
ChatGPT and verify its UI. Disconnect alone is not a deletion promise. Provider
refresh/session revocation does not invalidate already-issued JWTs immediately;
test the configured access-token expiry. Independently test deleted and disabled
Firebase users and removed workspace membership. Retain sanitized evidence of
these tests before any claim that live integration works.

Official requirements rechecked 2026-10-10:
[Packaging](https://developers.openai.com/plugins/build/plugins),
[Authentication](https://developers.openai.com/plugins/build/auth),
[MCP server](https://developers.openai.com/plugins/build/mcp-server).
