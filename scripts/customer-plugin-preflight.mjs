/** Offline only: never reads .env files, prints values, fetches URLs or changes state. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const scopes = ['launch:projects:read', 'launch:status:read', 'launch:reports:read', 'launch:brief:read', 'launch:drafts:write'];
export function safeHttps(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && !u.hostname.endsWith('.invalid') && u.hostname !== 'localhost' && !/replace|example/i.test(u.hostname); } catch { return false; }
}
export function inspectPackage(manifest, mcp, env = {}) {
  const failures = [];
  const require = (ok, id) => { if (!ok) failures.push(id); };
  require(manifest?.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' && manifest.name === 'launchauth-customer' && /^\d+\.\d+\.\d+$/.test(manifest.version) && typeof manifest.description === 'string', 'portable_manifest');
  const entries = Object.entries(mcp?.mcpServers ?? {});
  const server = mcp?.mcpServers?.['launchauth-customer'];
  const auth = server?.extensions?.['com.openai']?.auth;
  require(mcp?.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' && entries.length === 1 && server?.type === 'streamable-http', 'portable_transport');
  require(safeHttps(server?.url) && new URL(server.url).pathname === '/api/mcp', 'approved_endpoint');
  require(auth?.type === 'oauth' && auth?.client?.mode === 'provided' && auth?.client?.tokenEndpointAuthMethod === 'none' && typeof auth?.client?.clientId === 'string' && auth.client.clientId.trim().length > 0 && !/replace/i.test(auth.client.clientId), 'approved_public_oauth_client');
  require(Array.isArray(auth?.baseScopes) && auth.baseScopes.length === scopes.length && scopes.every(s => auth.baseScopes.includes(s)), 'scopes');
  require(!/clientSecret|authorization"|apiKey|accessToken|refreshToken|headers"/i.test(JSON.stringify({ manifest, mcp })), 'no_embedded_credentials');
  require(env.CUSTOMER_MCP_RESOURCE === server?.url && safeHttps(env.CUSTOMER_MCP_RESOURCE), 'resource_matches_package');
  require(safeHttps(env.CUSTOMER_MCP_ISSUER) && safeHttps(env.CUSTOMER_MCP_JWKS_URL), 'pinned_provider');
  require(env.CUSTOMER_MCP_ENABLED === 'false', 'disabled_until_live_acceptance');
  require(env.PRNOW_SUBMIT_ENABLED !== 'true' && env.JOB_SCHEDULER_VERIFIED !== 'true', 'no_live_delivery');
  require(!env.STRIPE_SECRET_KEY?.startsWith('sk_live_'), 'no_live_stripe');
  return { configurationReady: failures.length === 0, liveAcceptanceVerified: false, failures };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = process.argv[2] ?? 'docs/customer-plugin/package';
    const report = inspectPackage(JSON.parse(readFileSync(`${root}/plugin.json`, 'utf8')), JSON.parse(readFileSync(`${root}/mcp.json`, 'utf8')), process.env);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.configurationReady ? 0 : 1;
  } catch { console.error('Preflight could not read valid package JSON. No configuration values were logged.'); process.exitCode = 2; }
}
