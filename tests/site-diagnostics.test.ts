import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions, request as nodeRequest } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { runSiteDiagnostics, type SiteDiagnosticDependencies } from "../lib/site-diagnostics";
import type { SiteDiagnosticReport } from "../lib/site-diagnostic-types";

type Fixture = { status?: number; body?: string; headers?: Record<string, string | string[]>; error?: string; chunks?: Buffer[]; hang?: boolean; hangAfterHeaders?: boolean };
const origin = "https://customer.example";
const publicAddress = { address: "93.184.216.34", family: 4 };

/** Native request-shaped test transport: captures actual production pinning options, never opens a socket. */
function transport(fixtures: Record<string, Fixture>) {
  const calls: Array<{ url: URL; options: RequestOptions; destroyed: boolean }> = [];
  const request = vi.fn((input: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const url = new URL(input);
    const fixture = fixtures[url.href] ?? fixtures[url.pathname] ?? { status: 404, body: "Missing", headers: { "content-type": "text/plain" } };
    const call = { url, options, destroyed: false };
    calls.push(call);
    const emitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error?: Error) => void };
    emitter.destroy = (error) => { call.destroyed = true; if (error) queueMicrotask(() => emitter.emit("error", error)); };
    emitter.end = () => queueMicrotask(() => {
      if (fixture.hang) return;
      if (fixture.error) { emitter.emit("error", new Error(fixture.error)); return; }
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string | string[]>; complete: boolean; destroy: () => void };
      response.statusCode = fixture.status ?? 200;
      response.headers = fixture.headers ?? { "content-type": "text/html" };
      response.complete = false;
      response.destroy = () => { call.destroyed = true; };
      callback(response as unknown as IncomingMessage);
      if (fixture.hangAfterHeaders) return;
      if (call.destroyed) return;
      for (const chunk of fixture.chunks ?? [Buffer.from(fixture.body ?? "")]) {
        response.emit("data", chunk);
        if (call.destroyed) return;
      }
      response.complete = true;
      response.emit("end");
    });
    return emitter as unknown as ClientRequest;
  }) as unknown as typeof nodeRequest;
  const resolver = vi.fn(async () => [publicAddress]);
  const dependencies: SiteDiagnosticDependencies = { request, resolver };
  return { request, calls, resolver, dependencies };
}

function check(report: SiteDiagnosticReport, kind: string, agent?: string, url = `${origin}/`) {
  return report.findings.find((finding) => finding.check === kind && finding.agent === agent && finding.url === url);
}

describe("customer-site diagnostics", () => {
  it("retains evidence, exact response details, scoped directives, canonical and sitemap membership without claiming indexing", async () => {
    const fixture = transport({
      "/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://customer.example/sitemap.xml", headers: { "content-type": "text/plain" } },
      "/": { body: '<html><head><meta content="noindex" name="googlebot"><link href="/" rel="canonical"></head><body>Customer product details.</body></html>', headers: { "content-type": "text/html", "x-robots-tag": ["otherbot: noindex", "max-snippet:0"], "set-cookie": "secret=value" } },
      "/sitemap.xml": { body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://customer.example/</loc></url></urlset>', headers: { "content-type": "application/xml" } },
    });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report).toMatchObject({ version: 1, targetUrl: `${origin}/`, scope: { checkedPageCount: 1, retrievedPageCount: 1, javascriptExecuted: false, searchEngineIndexChecked: false } });
    expect(report.pages[0]).toMatchObject({ finalUrl: `${origin}/`, httpStatus: 200, retrieved: true, indexStatus: "not_checked", headerRobots: ["otherbot: noindex", "max-snippet:0"] });
    expect(check(report, "indexability", "Googlebot")).toMatchObject({ result: "issue", reason: expect.stringContaining("Googlebot") });
    expect(check(report, "indexability", "Bingbot")).toMatchObject({ result: "pass", reason: expect.stringContaining("apparent eligibility") });
    expect(check(report, "canonical")).toMatchObject({ result: "pass" });
    expect(check(report, "sitemap_membership")).toMatchObject({ result: "pass" });
    expect(check(report, "index_status")).toMatchObject({ result: "not_checked", evidenceIds: [] });
    expect(report.snapshots.every((snapshot) => /^[a-f0-9]{64}$/.test(snapshot.contentHash))).toBe(true);
    expect(report.snapshots.some((snapshot) => snapshot.relevantTags.some((tag) => tag.includes("googlebot")))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("secret=value");
    expect(report.findings.every((finding) => finding.url && finding.capturedAt && finding.checkedScope && finding.reason)).toBe(true);
  });

  it("uses pinned Node transport options on every request and never sends credentials or cookies", async () => {
    const fixture = transport({ "/": { body: "<html><body>Public content</body></html>" } });
    await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.resolver).toHaveBeenCalledTimes(fixture.calls.length);
    for (const call of fixture.calls) {
      expect(call.options).toMatchObject({ agent: false, method: "GET", family: 4, servername: "customer.example", autoSelectFamily: false });
      expect(call.options.headers).toMatchObject({ "user-agent": expect.stringContaining("LaunchAuthBot"), "accept-encoding": "identity" });
      expect(call.options.headers).not.toHaveProperty("cookie");
      expect(call.options.headers).not.toHaveProperty("authorization");
      const resolved = vi.fn();
      call.options.lookup!("customer.example", {}, resolved);
      expect(resolved).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    }
  });

  it("respects LaunchAuthBot groups, wildcard/longest matching/allow ties and distinguishes engine rules", async () => {
    const fixture = transport({
      "/robots.txt": { body: "User-agent: *\nDisallow: /\nUser-agent: LaunchAuthBot\nAllow: /\nDisallow: /private*\nAllow: /private-public$\nUser-agent: Googlebot\nDisallow: /\nUser-agent: Bingbot\nAllow: /", headers: { "content-type": "text/plain" } },
      "/": { body: '<html><body><a href="/private">Private</a><a href="/private-public">Public</a><a href="/about">About</a></body></html>' },
      "/private-public": { body: "<html><body>Allowed exact rule</body></html>" },
      "/about": { body: "<html><body>About</body></html>" },
    });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls.map((call) => call.url.pathname)).not.toContain("/private");
    expect(fixture.calls.map((call) => call.url.pathname)).toContain("/private-public");
    expect(report.pages.find((page) => page.url.endsWith("/private"))).toMatchObject({ httpStatus: null, retrieved: false, robots: { LaunchAuthBot: { allowed: false }, Googlebot: { allowed: false }, Bingbot: { allowed: true } } });
    expect(report.pages[0].robots.Googlebot.allowed).toBe(false);
    expect(report.pages[0].robots.Bingbot.allowed).toBe(true);
    expect(report.scope).toMatchObject({ checkedPageCount: 3, attemptedPageCount: 3, maxPages: 4 });
  });

  it("does not fetch any page when robots blocks LaunchAuthBot", async () => {
    const fixture = transport({ "/robots.txt": { body: "User-agent: LaunchAuthBot\nDisallow: /", headers: { "content-type": "text/plain" } } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls.map((call) => call.url.pathname)).toEqual(["/robots.txt"]);
    expect(report.pages[0].robots.LaunchAuthBot.allowed).toBe(false);
    expect(report.scope.checkedPageCount).toBe(0);
    expect(check(report, "meta_robots")?.result).toBe("not_checked");
  });

  it.each([401, 403, 429, 500, 503])("fails closed on robots HTTP %i", async (status) => {
    const fixture = transport({ "/robots.txt": { status, body: "Policy unavailable" } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls).toHaveLength(1);
    expect(report.robots).toMatchObject({ httpStatus: status, state: "unavailable" });
    expect(report.pages[0].robots.LaunchAuthBot).toMatchObject({ allowed: null, result: "not_checked" });
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("treats missing robots as permission to inspect, not evidence of indexing", async () => {
    const fixture = transport({ "/": { body: "<html><body>Public</body></html>" } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.robots).toMatchObject({ httpStatus: 404, state: "missing" });
    expect(report.pages[0].robots.LaunchAuthBot.reason).toContain("not evidence of indexing");
    expect(report.pages[0].indexStatus).toBe("not_checked");
  });

  it("fails closed for malformed, oversized and failed robots responses", async () => {
    const robotsResponses: Fixture[] = [
      { body: "<html><body>Login instead of policy</body></html>" },
      { headers: { "content-type": "text/plain", "content-length": "600000" }, body: "" },
      { error: "TLS handshake failed" },
      { body: "Please try later", headers: { "content-type": "text/plain" } },
      { body: "User-agent missing colon\nDisallow: /", headers: { "content-type": "text/plain" } },
    ];
    for (const robots of robotsResponses) {
      const fixture = transport({ "/robots.txt": robots });
      const report = await runSiteDiagnostics(origin, fixture.dependencies);
      expect(fixture.calls).toHaveLength(1);
      expect(report.robots.state).toBe("unavailable");
      expect(report.pages[0].httpStatus).toBeNull();
    }
  });

  it("follows bounded same-origin redirects, resolves every hop and uses final URL for relative canonicals", async () => {
    const fixture = transport({
      "/": { status: 301, headers: { location: "/home" } },
      "/home": { status: 302, headers: { location: "/home/" } },
      "/home/": { body: '<html><head><link rel="canonical" href="./"></head><body>Home</body></html>' },
    });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.pages[0]).toMatchObject({ finalUrl: `${origin}/home/`, httpStatus: 200, redirects: [{ status: 301, followed: true }, { status: 302, followed: true }] });
    expect(check(report, "redirects")?.result).toBe("pass");
    expect(check(report, "canonical")?.result).toBe("pass");
    expect(fixture.resolver).toHaveBeenCalledTimes(fixture.calls.length);
  });

  it.each(["https://outside.example/final", "http://127.0.0.1/internal", "https://user:password@customer.example/secret"])("records but never follows unsafe redirect %s", async (location) => {
    const fixture = transport({ "/": { status: 302, headers: { location } } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls.some((call) => call.url.href === location)).toBe(false);
    expect(report.pages[0]).toMatchObject({ httpStatus: 302, finalUrl: `${origin}/`, retrieved: false });
    expect(report.pages[0].redirects[0]).toMatchObject({ location, followed: false });
    expect(check(report, "redirects")?.result).toBe("issue");
  });

  it("does not follow redirect targets forbidden by robots", async () => {
    const fixture = transport({ "/robots.txt": { body: "User-agent: *\nDisallow: /private", headers: { "content-type": "text/plain" } }, "/": { status: 302, headers: { location: "/private" } } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls.some((call) => call.url.pathname === "/private")).toBe(false);
    expect(report.pages[0].redirects[0]).toMatchObject({ followed: false, reason: expect.stringContaining("robots") });
  });

  it("stops redirect loops and overlong chains", async () => {
    const loop = transport({ "/": { status: 302, headers: { location: "/other" } }, "/other": { status: 302, headers: { location: "/" } } });
    expect((await runSiteDiagnostics(origin, loop.dependencies)).pages[0].error).toContain("loop");
    const long = transport(Object.fromEntries(["/", "/1", "/2", "/3", "/4"].map((path, index) => [path, { status: 302, headers: { location: `/${index + 1}` } }])));
    const report = await runSiteDiagnostics(origin, long.dependencies);
    expect(report.pages[0].error).toContain("redirect limit");
    expect(long.calls.some((call) => call.url.pathname === "/4")).toBe(false);
  });

  it("rejects a mixed/private DNS answer and catches DNS rebinding on later hops", async () => {
    const fixture = transport({ "/": { status: 302, headers: { location: "/home" } } });
    fixture.resolver.mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([publicAddress]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(fixture.calls.map((call) => call.url.pathname)).toEqual(["/robots.txt", "/"]);
    expect(report.pages[0].error).toContain("private");
    const mixed = transport({});
    mixed.resolver.mockResolvedValue([publicAddress, { address: "169.254.169.254", family: 4 }]);
    expect((await runSiteDiagnostics(origin, mixed.dependencies)).robots.state).toBe("unavailable");
    expect(mixed.calls).toHaveLength(0);
  });

  it.each(["http://localhost", "http://[fe90::1]/", "http://[ff02::1]/", "http://[2001::1]/", "http://[2001:2::1]/", "http://[2001:20::1]/", "http://[::ffff:127.0.0.1]/", "https://user:pass@customer.example", "file:///etc/passwd"])("rejects unsafe initial URL %s", async (url) => {
    const fixture = transport({});
    await expect(runSiteDiagnostics(url, fixture.dependencies)).rejects.toThrow();
    expect(fixture.calls).toHaveLength(0);
  });

  it("reports non-HTML and HTTP failures without fabricating content checks", async () => {
    const fixture = transport({ "/": { status: 503, body: "Service unavailable" } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.pages[0]).toMatchObject({ httpStatus: 503, retrieved: false });
    expect(check(report, "accessibility")?.result).toBe("issue");
    expect(check(report, "meta_robots")?.result).toBe("not_checked");
    const pdf = transport({ "/": { headers: { "content-type": "application/pdf" }, body: "%PDF" } });
    const pdfReport = await runSiteDiagnostics(origin, pdf.dependencies);
    expect(pdfReport.pages[0]).toMatchObject({ retrieved: true, isHtml: false });
    expect(check(pdfReport, "meta_robots")?.result).toBe("not_applicable");
  });

  it("distinguishes potentially rendering-dependent HTML from an actually inspected rendered page", async () => {
    const fixture = transport({ "/": { body: '<html><head><script>const fake = \'<meta name="robots" content="noindex">\';</script></head><body><div id="root"></div><script src="/app.js"></script></body></html>' } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.pages[0].metaRobots).toEqual([]);
    expect(check(report, "rendering")).toMatchObject({ result: "not_checked", reason: expect.stringContaining("Potential rendering dependence") });
    expect(fixture.calls.some((call) => call.url.pathname === "/app.js")).toBe(false);
  });

  it("captures conflicting/other-origin canonicals but never fetches them", async () => {
    const fixture = transport({ "/": { body: '<html><head><link href="/first" rel="canonical"><link rel="canonical" href="https://other.example/canonical"></head></html>' } });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(check(report, "canonical")?.result).toBe("issue");
    expect(report.pages[0].canonicals).toHaveLength(2);
    expect(fixture.calls.some((call) => call.url.pathname === "/first" || call.url.hostname === "other.example")).toBe(false);
  });

  it("keeps robots/meta nofollow in the appropriate scope and limits homepage-only discovery", async () => {
    const fixture = transport({
      "/": { body: '<html><head><meta name="googlebot" content="nofollow"></head><body><a href="/no" rel="nofollow">No</a><a href="/?query=1">Query</a><a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a><a href="/four">Four</a><a href="https://other.example/">Other</a></body></html>' },
      "/one": { body: '<html><body><a href="/deeper">Deeper</a></body></html>' },
      "/two": { body: "<html>Two</html>" }, "/three": { body: "<html>Three</html>" },
    });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.pages).toHaveLength(4);
    expect(fixture.calls.map((call) => call.url.pathname)).toEqual(["/robots.txt", "/", "/one", "/two", "/three", "/sitemap.xml"]);
    expect(report.scope.skippedUrls.length).toBeGreaterThanOrEqual(4);
  });

  it("bounds sitemap-index traversal and entries without following off-origin URLs or XML entities", async () => {
    const fixture = transport({
      "/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://customer.example/index.xml\nSitemap: https://external.example/map.xml", headers: { "content-type": "text/plain" } },
      "/": { body: "<html>Home</html>" },
      "/index.xml": { body: "<sitemapindex><sitemap><loc>https://customer.example/child.xml</loc></sitemap><sitemap><loc>https://external.example/child.xml</loc></sitemap></sitemapindex>" },
      "/child.xml": { body: "<urlset><url><loc>https://customer.example/</loc></url><url><loc>https://customer.example/two</loc></url><url><loc>https://customer.example/three</loc></url></urlset>" },
    });
    const report = await runSiteDiagnostics(origin, { ...fixture.dependencies, limits: { maxSitemapEntries: 2 } });
    expect(report.sitemaps).toHaveLength(2);
    expect(report.sitemaps[1]).toMatchObject({ kind: "urlset", entriesTruncated: true, entries: [`${origin}/`, `${origin}/two`] });
    expect(fixture.calls.every((call) => call.url.origin === origin)).toBe(true);
    const entities = transport({ "/": { body: "<html>Home</html>" }, "/sitemap.xml": { body: '<!DOCTYPE urlset [<!ENTITY secret SYSTEM "http://169.254.169.254/">]><urlset><url><loc>&secret;</loc></url></urlset>' } });
    expect((await runSiteDiagnostics(origin, entities.dependencies)).sitemaps[0]).toMatchObject({ result: "issue", reason: expect.stringContaining("DTD/entity") });
    expect(entities.calls.every((call) => call.url.origin === origin)).toBe(true);
  });

  it("enforces per-response, total byte, request-count and total deadline bounds", async () => {
    const oversized = transport({ "/": { chunks: [Buffer.alloc(50), Buffer.alloc(60)] } });
    const partial = await runSiteDiagnostics(origin, { ...oversized.dependencies, limits: { maxHtmlBytes: 100 } });
    expect(partial.pages[0]).toMatchObject({ httpStatus: 200, retrieved: false, error: expect.stringContaining("byte limit") });
    expect(check(partial, "meta_robots")?.result).toBe("not_checked");
    expect(partial.snapshots.find((snapshot) => snapshot.kind === "html")).toMatchObject({ bytes: 100, bodyComplete: false });
    expect(oversized.calls.find((call) => call.url.pathname === "/")?.destroyed).toBe(true);
    const total = transport({ "/robots.txt": { status: 404, body: "" }, "/": { body: "x".repeat(150) } });
    const bounded = await runSiteDiagnostics(origin, { ...total.dependencies, limits: { maxTotalBytes: 100 } });
    expect(bounded.scope.bytesRead).toBe(100);
    expect(total.calls).toHaveLength(2);
    const count = transport({});
    expect((await runSiteDiagnostics(origin, { ...count.dependencies, limits: { maxRequests: 1 } })).scope.requestCount).toBe(1);
    const stalled = transport({ "/robots.txt": { hang: true } });
    const started = Date.now();
    const timed = await runSiteDiagnostics(origin, { ...stalled.dependencies, limits: { deadlineMs: 20 } });
    expect(Date.now() - started).toBeLessThan(500);
    expect(stalled.calls).toHaveLength(1);
    expect(stalled.calls[0].destroyed).toBe(true);
    expect(timed.robots.state).toBe("unavailable");
  });

  it("also bounds DNS resolution time without initiating a request", async () => {
    const fixture = transport({});
    const report = await runSiteDiagnostics(origin, { ...fixture.dependencies, resolver: () => new Promise(() => {}), limits: { deadlineMs: 15 } });
    expect(fixture.calls).toHaveLength(0);
    expect(report.robots.reason).toContain("DNS resolution");
  });

  it("retains actual status/header evidence when a response stalls after its headers", async () => {
    const fixture = transport({ "/": { status: 200, headers: { "content-type": "text/html", "x-robots-tag": "noindex" }, hangAfterHeaders: true } });
    const report = await runSiteDiagnostics(origin, { ...fixture.dependencies, limits: { requestTimeoutMs: 15 } });
    expect(report.pages[0]).toMatchObject({ httpStatus: 200, retrieved: false, headerRobots: ["noindex"], error: expect.stringContaining("deadline") });
    expect(report.snapshots.find((snapshot) => snapshot.kind === "html")).toMatchObject({ httpStatus: 200, bodyComplete: false });
  });

  it("marks omitted directive tails as unknown and bounds pathological reports below durable storage limits", async () => {
    const metadata = Array.from({ length: 450 }, () => `<meta name="robots" content="${"a".repeat(950)}">`).join("") + '<meta name="robots" content="noindex">';
    const html = `<html><head>${metadata}</head><body><a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a></body></html>`;
    const sitemap = `<urlset>${Array.from({ length: 200 }, (_, index) => `<url><loc>${origin}/${index}/${"s".repeat(460)}</loc></url>`).join("")}</urlset>`;
    const fixture = transport({
      "/robots.txt": { body: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\nSitemap: ${origin}/second.xml`, headers: { "content-type": "text/plain" } },
      "/": { body: html }, "/one": { body: html }, "/two": { body: html }, "/three": { body: html }, "/sitemap.xml": { body: sitemap }, "/second.xml": { body: sitemap },
    });
    const report = await runSiteDiagnostics(origin, fixture.dependencies);
    expect(report.pages).toHaveLength(4);
    expect(report.pages.every((page) => page.metaRobots.length <= 20)).toBe(true);
    expect(check(report, "indexability", "Googlebot")?.result).toBe("not_checked");
    expect(check(report, "meta_robots")?.result).toBe("not_checked");
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(700_000);
  });
});
