# Proposed next owner decision — Auth0 private pilot

Recommendation: use **Auth0 as the OAuth authorization server** for the first
private customer pilot. Keep Firebase Auth and Firestore as the existing website
identity/data system. This is a compatibility recommendation from current official
documentation, not a claim that a tenant, plan or connection has been tested.
No account, client, credentials, links, grants or deployments have been created.

## Concrete approval requested next

Approve an Auth0 development-tenant pilot with a **pre-registered public OAuth
client using authorization code + S256 PKCE** (token endpoint authentication
`none`), one owner-controlled test identity, and an owner-specified staging
Firebase project and HTTPS hostname. This avoids opening dynamic client
registration for the pilot. Confirm Auth0 tenant/region and who owns it; verify
feature availability and any costs before provisioning. This document alone does
not authorize account setup, credentials, links, deployment or ChatGPT grants.

Proposed configuration for the approved setup step:

- Register a dedicated Auth0 API with identifier exactly
  `https://<approved-staging-host>/api/mcp`, the three `launch:*:read` scopes,
  RS256 and the **RFC 9068** access-token profile (`at+jwt`). Enable RBAC so the
  `scope` claim contains only requested permissions assigned to the test user.
- Enable **Resource Parameter Compatibility Profile** and **Include Issuer in
  Authorization Responses**. Do not replace MCP's `resource` with a guessed
  `audience` parameter. Test both authorization and token exchange on staging.
- Register the public client in advance, restrict it to the authorization-code
  grant, and require S256 PKCE. Register only the exact callback displayed by
  ChatGPT's connection setup. Confirm provider/client flow works before enabling
  refresh tokens; if enabled, use rotation/revocation. Propose a five-minute
  access-token lifetime, subject to provider configuration validation.
- Pin the tenant's discovery `issuer` and `jwks_uri` in server configuration.
  Confirm discovery advertises S256. Never derive trusted issuer/key endpoints
  from incoming token headers. Use `client.mode: provided`, the real `clientId`,
  and `tokenEndpointAuthMethod: none` in packaging only after approval.
- Independently verify the tester's Auth0 identity and existing Firebase account
  with fresh logins before any operator-assisted mapping is provisioned. Record
  the verified Auth0 subject and Firebase UID; email equality is not proof.
  The server only reads the mapping; customer self-service linking remains to
  be designed/implemented before a broader launch.

Unresolved owner inputs: approved tenant/region and account owner; staging
hostname and Firebase project; test identity; identity verification/linking
operator; access-token lifetime/refresh policy; privacy/support owner. CIMD or
DCR can be evaluated later if needed; neither is enabled by this prototype.

## Revocation limits

Disabling/deleting the server-owned mapping, disabling/deleting the Firebase
user, or removing workspace membership blocks the next request. In-flight reads
can finish. This resource server does **not** introspect tokens, maintain a JWT
revocation list, or compare Firebase `tokensValidAfterTime` with an external
provider token. Revoking a provider session/refresh token, changing provider
permissions, or resetting Firebase credentials alone may leave an already-issued
JWT usable until its expiry if the mapping/user/membership remain enabled. For
immediate local denial, disable the mapping. Short token lifetimes limit the
remaining window. Cached JWKS keys follow JOSE's cache/refresh behavior; key
removal is not a substitute for application-level revocation.

## Official evidence checked 2026-10-09

- Auth0 supports resource indicators via an explicit tenant compatibility option:
  https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile
- Auth0's RFC 9068 profile has the required access-token type:
  https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles
- Auth0 documents authorization code with PKCE:
  https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce
- RBAC narrows the `scope` claim to requested assigned permissions:
  https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis
- OpenAI supports pre-registered clients and PKCE; actual callback/client details
  must come from connection setup:
  https://developers.openai.com/plugins/build/auth
  https://developers.openai.com/plugins/build/plugins
