import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPackage, safeHttps, scopes } from './customer-plugin-preflight.mjs';
const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'launchauth-customer', version: '0.1.0', description: 'Private launch management' };
function fixture() {
  const url = 'https://staging.launch.test/api/mcp';
  return { mcp: { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { 'launchauth-customer': { type: 'streamable-http', url, extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'provided', clientId: 'synthetic-test', tokenEndpointAuthMethod: 'none' }, baseScopes: [...scopes] } } } } } }, env: { CUSTOMER_MCP_RESOURCE: url, CUSTOMER_MCP_ENABLED: 'false', CUSTOMER_MCP_ISSUER: 'https://issuer.launch.test/', CUSTOMER_MCP_JWKS_URL: 'https://issuer.launch.test/jwks' } };
}
test('configured synthetic package passes offline checks without claiming live acceptance', () => { const {mcp,env}=fixture(); assert.deepEqual(inspectPackage(manifest,mcp,env),{configurationReady:true,liveAcceptanceVerified:false,failures:[]}); });
test('missing setup fails closed', () => { assert.equal(inspectPackage({},{}).configurationReady,false); });
test('URL rejects credentials, placeholders and non HTTPS', () => { for(const v of ['http://a.test','https://u:p@a.test','https://a.invalid','https://localhost','https://a.test/?secret=x','https://a.test/#x']) assert.equal(safeHttps(v),false); });
test('resource mismatch and enabled live features block readiness', () => { const {mcp,env}=fixture(); env.CUSTOMER_MCP_RESOURCE='https://other.test/api/mcp'; env.CUSTOMER_MCP_ENABLED='true'; env.PRNOW_SUBMIT_ENABLED='true'; env.STRIPE_SECRET_KEY='sk_live_synthetic'; const r=inspectPackage(manifest,mcp,env); for(const id of ['resource_matches_package','disabled_until_live_acceptance','no_live_delivery','no_live_stripe']) assert.ok(r.failures.includes(id)); });
test('extra tools server, scope expansion and credential embedding rejected', () => {const {mcp,env}=fixture(); mcp.mcpServers.extra={}; const s=mcp.mcpServers['launchauth-customer']; s.headers={Authorization:'synthetic'}; s.extensions['com.openai'].auth.baseScopes.push('admin'); const r=inspectPackage(manifest,mcp,env); for(const id of ['portable_transport','scopes','no_embedded_credentials']) assert.ok(r.failures.includes(id));});
