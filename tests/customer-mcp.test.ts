import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { authenticate, configFromEnv, mappingId, metadata, type Config } from "../lib/customer-mcp/auth";
import { CustomerStore } from "../lib/customer-mcp/store";
import { handleMcp } from "../lib/customer-mcp/http";
import { FieldPath, type Firestore } from "firebase-admin/firestore";

const config: Config = { issuer: "https://identity.example.test/", resource: "https://launch.example.test/api/mcp", jwksUrl: "https://identity.example.test/jwks", origins: [] };
let key: CryptoKey, keys: JWTVerifyGetKey;
const pid = "a".repeat(24), other = "b".repeat(24);
beforeAll(async () => { const pair = await generateKeyPair("RS256"); key = pair.privateKey; keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test" }] }); });
async function token(claims: Record<string, unknown> = {}, signingKey = key) {
  return new SignJWT({ scope: "launch:projects:read launch:status:read launch:reports:read", ...claims }).setProtectedHeader({ alg: "RS256", kid: "test", typ: "at+jwt" }).setIssuer(String(claims.iss ?? config.issuer)).setSubject(String(claims.sub ?? "subject-a")).setAudience(String(claims.aud ?? config.resource)).setIssuedAt().setExpirationTime(claims.exp as number ?? "5m").sign(signingKey);
}
// Read-only Firestore double; no write API exists. Query ordering/cursors/limits are applied.
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const root = "workspaces/personal_alice";
  rows.set(`customerMcpLinks/${mappingId(config.issuer, "subject-a")}`, { issuer: config.issuer, subject: "subject-a", firebaseUid: "alice", enabled: true });
  rows.set(`${root}/members/alice`, { userId: "alice", role: "owner" });
  rows.set(`${root}/projects/${pid}`, { workspaceId: "personal_alice", createdBy: "alice", name: "Alice launch", campaignStatus: "draft_ready", providerSecret: "SECRET" });
  rows.set(`${root}/projects/${other}`, { workspaceId: "personal_bob", createdBy: "bob", name: "Bob secret" });
  rows.set(`${root}/intelligenceJobs/job1`, { projectId: pid, workspaceId: "personal_alice", userId: "alice", type: "analysis", status: "completed", runToken: "SECRET", message: "SECRET" });
  rows.set(`${root}/intelligenceJobs/job2`, { projectId: pid, workspaceId: "personal_bob", userId: "bob", status: "running" });
  rows.set(`${root}/projects/${pid}/placements/p1`, { outlet: "Example", url: "https://news.example.test/article?secret=SECRET#SECRET", state: "published", lastVerificationError: "SECRET" });
  const snap = (path: string) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => rows.get(path) });
  function collection(path: string, filters: Array<[string, unknown]> = [], cap = Infinity, after = "") {
    return { doc: (id: string) => doc(`${path}/${id}`), where: (field: string, op: string, value: unknown) => { expect(op).toBe("=="); return collection(path, [...filters, [field, value]], cap, after); }, orderBy: (field: FieldPath) => { expect(field.isEqual(FieldPath.documentId())).toBe(true); return collection(path, filters, cap, after); }, limit: (value: number) => collection(path, filters, value, after), startAfter: (value: string) => collection(path, filters, cap, value), get: async () => ({ docs: [...rows.keys()].filter(p => p.split("/").slice(0, -1).join("/") === path && p.split("/").at(-1)! > after && filters.every(([f, v]) => rows.get(p)![f] === v)).sort().slice(0, cap).map(snap) }) };
  }
  function doc(path: string): any { return { id: path.split("/").at(-1), get: async () => snap(path), collection: (name: string) => collection(`${path}/${name}`) }; }
  const activeUser = vi.fn(async (uid: string) => uid === "alice");
  return { rows, root, activeUser, store: new CustomerStore({ doc } as unknown as Firestore, activeUser) };
}
async function rpc(store: CustomerStore, method: string, params: unknown = {}, access?: string, extraHeaders = {}) {
  return handleMcp(new Request(config.resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(access ? { authorization: `Bearer ${access}` } : {}), ...extraHeaders }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), config, keys, store);
}
describe("customer MCP authorization", () => {
  it("is disabled by default and publishes resource-scoped discovery", () => { vi.stubEnv("CUSTOMER_MCP_ENABLED", "false"); expect(() => configFromEnv()).toThrow(); vi.unstubAllEnvs(); expect(metadata(config).resource).toBe(config.resource); });
  it("rejects anonymous requests before reading data", async () => { const f = fixture(); const resolve = vi.spyOn(f.store, "resolve"); const response = await rpc(f.store, "tools/list"); expect(response.status).toBe(401); expect(response.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp"); expect(resolve).not.toHaveBeenCalled(); });
  it.each([{ iss: "https://evil.test" }, { aud: "website" }, { exp: 1 }, { scope: "unrelated" }])("rejects invalid claims %j", async claims => { const f = fixture(); const response = await rpc(f.store, "tools/list", {}, await token(claims)); expect(response.status).toBe(claims.scope ? 403 : 401); expect(f.activeUser).not.toHaveBeenCalled(); });
  it("rejects a signature from another key", async () => { const pair = await generateKeyPair("RS256"); expect((await rpc(fixture().store, "tools/list", {}, await token({}, pair.privateKey))).status).toBe(401); });
  it("never links by email, rejects unknown/revoked identities and disabled Firebase users", async () => { const f = fixture(); expect((await rpc(f.store, "tools/list", {}, await token({ sub: "unknown", email: "alice@example.test", email_verified: true }))).status).toBe(403); f.activeUser.mockResolvedValue(false); expect((await rpc(f.store, "tools/list", {}, await token())).status).toBe(403); f.rows.clear(); expect((await rpc(f.store, "tools/list", {}, await token())).status).toBe(403); });
  it("rejects untrusted origins", async () => { expect((await rpc(fixture().store, "tools/list", {}, await token(), { origin: "https://evil.test" })).status).toBe(403); });
  it("derives the principal solely from verified issuer/subject", async () => { const f = fixture(); expect(await authenticate(`Bearer ${await token({ userId: "bob" })}`, config, keys, f.store.resolve.bind(f.store))).toEqual({ uid: "alice", scopes: ["launch:projects:read", "launch:status:read", "launch:reports:read"] }); });
});
describe("additional token and transport boundaries", () => {
  it("rejects disabled or mismatched stored links", async () => {
    const f = fixture(), path = `customerMcpLinks/${mappingId(config.issuer, "subject-a")}`;
    const valid = f.rows.get(path)!;
    for (const change of [{ enabled: false }, { issuer: "https://wrong.test" }, { subject: "another" }]) {
      f.rows.set(path, { ...valid, ...change });
      expect((await rpc(f.store, "tools/list", {}, await token())).status).toBe(403);
    }
    expect(f.activeUser).not.toHaveBeenCalled();
  });
  it("rejects signed HS256 and future issued-at", async () => {
    const claims = { scope: "launch:projects:read", iss: config.issuer, aud: config.resource, sub: "subject-a", exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) };
    const symmetric = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "at+jwt" }).sign(new Uint8Array(32).fill(7));
    const future = await new SignJWT({ ...claims, iat: claims.iat + 300 }).setProtectedHeader({ alg: "RS256", typ: "at+jwt", kid: "test" }).sign(key);
    for (const access of [symmetric, future]) expect((await rpc(fixture().store, "tools/list", {}, access)).status).toBe(401);
  });
  it("rejects ID tokens, unsigned tokens, missing expiry and future not-before", async () => {
    const f = fixture();
    const idToken = await new SignJWT({ scope: "launch:projects:read" }).setProtectedHeader({ alg: "RS256", kid: "test", typ: "JWT" }).setIssuer(config.issuer).setAudience(config.resource).setSubject("subject-a").setIssuedAt().setExpirationTime("5m").sign(key);
    const missingExpiry = await new SignJWT({ scope: "launch:projects:read" }).setProtectedHeader({ alg: "RS256", kid: "test", typ: "at+jwt" }).setIssuer(config.issuer).setAudience(config.resource).setSubject("subject-a").setIssuedAt().sign(key);
    for (const access of [idToken, missingExpiry, "eyJhbGciOiJub25lIn0.e30.", await token({ nbf: Math.floor(Date.now() / 1000) + 300 })]) expect((await rpc(f.store, "tools/list", {}, access)).status).toBe(401);
  });
  it("enforces body size and rejects GET without starting a stream", async () => {
    const f = fixture(), access = await token();
    const request = new Request(config.resource, { method: "POST", headers: { authorization: `Bearer ${access}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { excess: "x".repeat(170000) } }) });
    expect((await handleMcp(request, config, keys, f.store)).status).toBe(413);
    expect((await handleMcp(new Request(config.resource, { headers: { authorization: `Bearer ${access}` } }), config, keys, f.store)).status).toBe(405);
  });
  it("reads sanitized fulfillment job status without dispatch", async () => {
    const f = fixture();
    f.rows.set(`${f.root}/projects/${pid}/jobs/job1`, { type: "provider_submission", status: "running", runToken: "SECRET", lastError: "SECRET" });
    const body = await (await rpc(f.store, "tools/call", { name: "get_campaign_status", arguments: { projectId: pid, jobKind: "fulfillment" } }, await token())).json();
    expect(body.result.structuredContent.jobs).toEqual([{ id: "job1", type: "provider_submission", status: "running", updatedAt: null }]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});
describe("read-only MCP tools", () => {
  it("initializes and lists the six annotated companion tools", async () => { const f = fixture(), access = await token(); const init = await rpc(f.store, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }, access); expect((await init.json()).result.serverInfo.name).toBe("launchauth-customer"); const response = await rpc(f.store, "tools/list", {}, access); const tools = (await response.json()).result.tools; expect(tools).toHaveLength(6); for (const tool of tools) { expect(tool.securitySchemes[0].type).toBe("oauth2"); expect(tool.securitySchemes[0].scopes).toHaveLength(1); expect(tool.annotations.readOnlyHint).toBe(tool.name !== "save_campaign_draft"); expect(tool.annotations.destructiveHint).toBe(tool.name === "save_campaign_draft"); expect(tool.inputSchema.additionalProperties).toBe(false); } });
  it("returns own projects/status/report and redacts provider internals without mutations", async () => { const f = fixture(), before = JSON.stringify([...f.rows]), access = await token(); for (const name of ["list_launch_projects", "get_campaign_status", "get_placement_report"]) { const response = await rpc(f.store, "tools/call", { name, arguments: name === "list_launch_projects" ? {} : { projectId: pid } }, access); const body = await response.json(); expect(body.result.isError).not.toBe(true); expect(JSON.stringify(body)).not.toContain("SECRET"); expect(JSON.stringify(body)).not.toContain("Bob secret"); if (name === "get_campaign_status") expect(body.result.structuredContent.jobs).toHaveLength(1); if (name === "get_placement_report") expect(body.result.structuredContent.placements[0].url).toBe("https://news.example.test/article"); } expect(JSON.stringify([...f.rows])).toBe(before); });
  it.each(["get_campaign_status", "get_placement_report"])("rejects cross-customer and nonexistent projects for %s", async name => { const f = fixture(); for (const id of [other, "c".repeat(24)]) { const body = await (await rpc(f.store, "tools/call", { name, arguments: { projectId: id } }, await token())).json(); expect(body.result.isError).toBe(true); expect(body.result.content[0].text).toBe("Project not found."); } });
  it("enforces each tool's own scope", async () => { const body = await (await rpc(fixture().store, "tools/call", { name: "get_placement_report", arguments: { projectId: pid } }, await token({ scope: "launch:projects:read" }))).json(); expect(body.result.isError).toBe(true); expect(body.result._meta["mcp/www_authenticate"][0]).toContain("insufficient_scope"); expect(body.result._meta["mcp/www_authenticate"][0]).toContain("error_description"); });
  it("rejects revoked membership and supplied userId", async () => { const f = fixture(), access = await token(); f.rows.delete(`${f.root}/members/alice`); const body = await (await rpc(f.store, "tools/call", { name: "list_launch_projects", arguments: {} }, access)).json(); expect(body.result.isError).toBe(true); const bad = await (await rpc(f.store, "tools/call", { name: "list_launch_projects", arguments: { userId: "bob" } }, access)).json(); expect(bad.result.isError).toBe(true); });
  it("bounds and paginates results and rejects invalid cursors", async () => { const f = fixture(); const first = await f.store.projects("alice", 1); expect(first.projects).toHaveLength(1); expect(first.nextCursor).toBe(pid); expect((await f.store.projects("alice", 1, first.nextCursor!)).projects).toHaveLength(0); for (const args of [{ limit: 51 }, { after: "../bob" }]) { const body = await (await rpc(f.store, "tools/call", { name: "list_launch_projects", arguments: args }, await token())).json(); expect(body.result.isError).toBe(true); } });
  it("does not expose storage errors", async () => { const f = fixture(); vi.spyOn(f.store, "projects").mockRejectedValue(new Error("SECRET")); const body = await (await rpc(f.store, "tools/call", { name: "list_launch_projects", arguments: {} }, await token())).json(); expect(body.result.isError).toBe(true); expect(JSON.stringify(body)).not.toContain("SECRET"); });
});


describe("companion MCP mutation boundary", () => {
  it("requires write scope and passes only verified UID to draft save, never approval", async () => {
    const f = fixture(), save = vi.fn(async () => ({ version: 1, duplicate: false }));
    Object.defineProperty(f.store, "companion", { value: { saveDraft: save } });
    const args = { projectId: pid, expectedVersion: 0, briefRevision: 1, requestId: crypto.randomUUID(), assets: [{ id: "a", type: "press_release", title: "Draft", content: "Text", claimIds: ["fact1"] }] };
    const denied = await (await rpc(f.store, "tools/call", { name: "save_campaign_draft", arguments: args }, await token())).json();
    expect(denied.result.isError).toBe(true); expect(save).not.toHaveBeenCalled();
    const result = await (await rpc(f.store, "tools/call", { name: "save_campaign_draft", arguments: args }, await token({ scope: "launch:drafts:write", userId: "bob" }))).json();
    expect(result.result.structuredContent.version).toBe(1); expect((save.mock.calls[0] as unknown as unknown[])[0]).toBe("alice");
    const invalid = await (await rpc(f.store, "tools/call", { name: "save_campaign_draft", arguments: { ...args, approved: true } }, await token({ scope: "launch:drafts:write" }))).json();
    expect(invalid.result.isError).toBe(true); expect(save).toHaveBeenCalledTimes(1);
  });
});
