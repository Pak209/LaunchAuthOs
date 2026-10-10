import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JWTVerifyGetKey } from "jose";
import { AccessError, authenticate, challenge, type Config } from "./auth";
import { createCustomerServer } from "./server";
import type { CustomerStore } from "./store";

export async function handleMcp(request: Request, config: Config, keys: JWTVerifyGetKey, store: CustomerStore) {
  const headers = new Headers({ "cache-control": "private, no-store", "vary": "Authorization, Origin" });
  try {
    const origin = request.headers.get("origin");
    if (origin && !config.origins.includes(origin)) throw new AccessError(403, "Origin not allowed.");
    const principal = await authenticate(request.headers.get("authorization"), config, keys, (issuer, subject) => store.resolve(issuer, subject));
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...Object.fromEntries(headers), Allow: "POST" } });
    const server = createCustomerServer(principal, store, config);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 160000 });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      headers.forEach((value, name) => response.headers.set(name, value));
      return response;
    } finally { await server.close(); }
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 503;
    if (status === 401 || status === 403) headers.set("www-authenticate", challenge(config, status === 403));
    return Response.json({ error: error instanceof AccessError ? error.message : "Customer integration unavailable." }, { status, headers });
  }
}
