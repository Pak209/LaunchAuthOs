import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const scopes = ["launch:projects:read", "launch:status:read", "launch:reports:read", "launch:brief:read", "launch:drafts:write"] as const;
export type Config = { issuer: string; resource: string; jwksUrl: string; origins: string[] };
export type Principal = { uid: string; scopes: string[] };
export class AccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function https(value: string | undefined) {
  if (!value) throw new Error("MCP is not configured");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error("Invalid MCP configuration");
  return value;
}
export function configFromEnv(): Config {
  if (process.env.CUSTOMER_MCP_ENABLED !== "true") throw new Error("MCP is disabled");
  const resource = https(process.env.CUSTOMER_MCP_RESOURCE);
  if (new URL(resource).pathname !== "/api/mcp") throw new Error("MCP resource must end in /api/mcp");
  return { issuer: https(process.env.CUSTOMER_MCP_ISSUER), resource, jwksUrl: https(process.env.CUSTOMER_MCP_JWKS_URL), origins: (process.env.CUSTOMER_MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean).map(https) };
}
export function mappingId(issuer: string, subject: string) {
  return createHash("sha256").update(JSON.stringify([issuer, subject])).digest("hex");
}
export function metadata(config: Config) {
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [...scopes], bearer_methods_supported: ["header"] };
}
export function challenge(config: Config, insufficient = false) {
  const url = new URL(config.resource);
  const discovery = `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
  return `Bearer resource_metadata="${discovery}", scope="${scopes.join(" ")}"${insufficient ? ', error="insufficient_scope", error_description="Required permission missing."' : ""}`;
}
const keySets = new Map<string, JWTVerifyGetKey>();
export function remoteKeys(config: Config) {
  let keys = keySets.get(config.jwksUrl);
  if (!keys) { keys = createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000 }); keySets.set(config.jwksUrl, keys); }
  return keys;
}
export async function authenticate(header: string | null, config: Config, keys: JWTVerifyGetKey, resolve: (issuer: string, subject: string) => Promise<string | null>): Promise<Principal> {
  if (!header || !/^Bearer [^\s]+$/i.test(header) || header.length > 16384) throw new AccessError(401, "Authentication required.");
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(header.slice(7), keys, { issuer: config.issuer, audience: config.resource, algorithms: ["RS256", "ES256"], typ: "at+jwt", requiredClaims: ["iss", "sub", "aud", "exp", "iat"], clockTolerance: 0 }));
    if (!claims.sub || claims.sub.length > 512 || typeof claims.iat !== "number" || claims.iat > Date.now() / 1000) throw new Error("Invalid subject or issued-at");
  } catch { throw new AccessError(401, "Invalid access token."); }
  const granted = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  if (!scopes.some(scope => granted.includes(scope))) throw new AccessError(403, "Required permission missing.");
  const uid = await resolve(config.issuer, claims.sub!);
  if (!uid || uid.length > 128 || /[/\x00-\x1f]/.test(uid) || uid === "." || uid === "..") throw new AccessError(403, "Account linking required.");
  return { uid, scopes: granted };
}
