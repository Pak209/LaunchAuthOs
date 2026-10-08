import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isPrivateIp, parsePublicHttpUrl } from "./url-security";
import type { SiteCanonical, SiteDiagnosticAgent, SiteDiagnosticCheck, SiteDiagnosticPage, SiteDiagnosticRedirect, SiteDiagnosticReport, SiteDiagnosticResult, SiteDiagnosticSnapshot, SiteMetaRobots, SiteRobotDecision, SiteSitemapReport } from "./site-diagnostic-types";

export type { SiteDiagnosticReport } from "./site-diagnostic-types";

const AGENTS: SiteDiagnosticAgent[] = ["LaunchAuthBot", "Googlebot", "Bingbot"];
const USER_AGENT = "LaunchAuthBot/1.0 (+customer-authorized site diagnostics)";
const LIMITS = { maxPages: 4, maxRequests: 24, maxRedirects: 3, maxTotalBytes: 2_500_000, maxHtmlBytes: 600_000, maxRobotsBytes: 512_000, maxSitemapBytes: 300_000, maxSitemaps: 2, maxSitemapEntries: 100, deadlineMs: 25_000, requestTimeoutMs: 6_000 } as const;
type Limits = { -readonly [K in keyof typeof LIMITS]: number };
type Address = { address: string; family: number };

/** Server-only dependency injection. No HTTP/API input may supply these capabilities. */
export interface SiteDiagnosticDependencies {
  resolver?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Address[]>;
  /** Tests may replace the Node request factory; production always uses IP-pinned native requests. */
  request?: typeof httpRequest;
  /** Tests can lower, never raise, production limits. */
  limits?: Partial<Limits>;
}

type ResponseData = { url: string; status: number; headers: Record<string, string[]>; body: string; bytes: number; hash: string; complete: boolean; error: string | null; capturedAt: string };
type ChainResult = { response: ResponseData | null; snapshot: SiteDiagnosticSnapshot | null; redirects: SiteDiagnosticRedirect[]; error: string | null };
type Rule = { allow: boolean; path: string; raw: string };
type Group = { agents: string[]; rules: Rule[] };
type RobotsRules = { groups: Group[]; sitemaps: string[] };

function digest(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "The request failed."; }
function stamp() { return new Date().toISOString(); }

function secureUrl(raw: string): URL {
  if (raw.length > 2_048) throw new Error("The URL exceeds the 2,048-character diagnostic limit.");
  const url = parsePublicHttpUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error("Private or non-public network addresses are not supported.");
  return url;
}

// Keep the shared URL protections, and fail closed on additional special-use address ranges.
function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isPrivateIp(normalized)) return false;
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return !(a === 192 && (b === 0 || (b === 88 && c === 99)) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  if (isIP(normalized) !== 6) return false;
  const [firstWord, secondWord] = normalized.split(":");
  const first = Number.parseInt(firstWord, 16);
  const second = Number.parseInt(secondWord || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002;
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number = entity.toLowerCase().startsWith("&#x") ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : "�";
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1].toLowerCase();
    if (!(key in result)) result[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function activeMarkup(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
}

function tags(markup: string, name: string): string[] {
  return [...markup.matchAll(new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi"))].slice(0, 500).map((match) => match[0]);
}

function parseHtml(html: string, finalUrl: URL, headers: Record<string, string[]>) {
  const markup = activeMarkup(html);
  const head = markup.match(/<head\b[^>]*>([\s\S]*?)(?:<\/head\s*>|<body\b|$)/i)?.[1] ?? markup.split(/<body\b/i)[0];
  let base = finalUrl;
  const declaredBase = attributes(tags(head, "base")[0] ?? "").href;
  try { if (declaredBase) base = secureUrl(new URL(declaredBase, finalUrl).href); } catch { /* retain the response URL */ }
  const metaRobots: SiteMetaRobots[] = tags(head, "meta").flatMap((raw) => {
    const attrs = attributes(raw);
    return attrs.name && /^(robots|[a-z_-]*bot[a-z_-]*)$/i.test(attrs.name) && typeof attrs.content === "string"
      ? [{ agent: attrs.name.toLowerCase().slice(0, 64), value: attrs.content.slice(0, 500), raw: raw.slice(0, 512) }] : [];
  });
  const canonicals: SiteCanonical[] = [];
  function canonical(raw: string, href: string, source: SiteCanonical["source"]) {
    try {
      if (!href.trim()) throw new Error("Empty canonical target.");
      const target = secureUrl(new URL(href, source === "html" ? base : finalUrl).href);
      canonicals.push({ source, raw: raw.slice(0, 512), url: target.href, sameOrigin: target.origin === finalUrl.origin });
    } catch { canonicals.push({ source, raw: raw.slice(0, 512), url: null, sameOrigin: null }); }
  }
  for (const raw of tags(head, "link")) {
    const attrs = attributes(raw);
    if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) canonical(raw, attrs.href ?? "", "html");
  }
  for (const value of headers.link ?? []) {
    for (const entry of value.split(/,(?=\s*<)/)) {
      if (/;\s*rel\s*=\s*(?:"[^"]*\bcanonical\b[^"]*"|'[^']*\bcanonical\b[^']*'|canonical\b)/i.test(entry)) canonical(entry, entry.match(/<([^>]+)>/)?.[1] ?? "", "http_header");
    }
  }
  const links: Array<{ href: string; nofollow: boolean }> = tags(markup, "a").flatMap((raw) => {
    const attrs = attributes(raw);
    if (!attrs.href || attrs.href.startsWith("#")) return [];
    try { return [{ href: new URL(attrs.href, base).href, nofollow: (attrs.rel ?? "").toLowerCase().split(/\s+/).includes("nofollow") }]; } catch { return []; }
  });
  const body = markup.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i)?.[1] ?? markup.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
  const text = decodeEntities(body.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const inspectionLimited = tags(head, "meta").length >= 500 || tags(head, "link").length >= 500 || metaRobots.length > 20 || metaRobots.some((tag) => tag.agent.length >= 64 || tag.value.length >= 500 || tag.raw.length >= 512) || canonicals.length > 8;
  return { metaRobots: metaRobots.slice(0, 20), canonicals: canonicals.slice(0, 8), links, text, scriptCount, inspectionLimited, relevantTags: [...metaRobots.map((tag) => tag.raw), ...canonicals.map((tag) => tag.raw)].slice(0, 12) };
}

function parseRobots(body: string): RobotsRules {
  if (/<(?:!doctype\s+html|html|body)\b/i.test(body) || body.includes("\0") || body.includes("�")) throw new Error("robots.txt was not a usable UTF-8 text policy; crawling stopped.");
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let records = 0;
  let meaningfulLines = 0;
  let understoodLines = 0;
  for (const raw of body.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    const line = raw.split("#", 1)[0].trim();
    if (!line) continue;
    meaningfulLines++;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    if (++records > 10_000 || line.length > 4_096) throw new Error("robots.txt exceeds the policy parsing limits; crawling stopped.");
    const field = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (["user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host", "request-rate", "noindex"].includes(field)) understoodLines++;
    if (field === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      if (!/^(?:[a-z_-]+|\*)$/i.test(value)) throw new Error("robots.txt contained an unsupported user-agent token; crawling stopped conservatively.");
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      // Empty rules still terminate a group's user-agent preamble.
      current.rules.push({ allow: field === "allow", path: value, raw: line });
    } else if (field === "sitemap" && sitemaps.length < 20 && value.length <= 2_048) sitemaps.push(value);
  }
  if (meaningfulLines && !understoodLines) throw new Error("robots.txt contained no recognizable policy records; crawling stopped conservatively.");
  if (meaningfulLines && !groups.length && !sitemaps.length) throw new Error("robots.txt had no usable user-agent group or sitemap declaration; crawling stopped conservatively.");
  return { groups, sitemaps };
}

function normalizedPath(value: string): string {
  return [...value].map((character) => character.charCodeAt(0) > 127 ? encodeURIComponent(character) : character).join("")
    .replace(/%[a-f\d]{2}/gi, (encoded) => {
      const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
      return /[a-z\d._~-]/i.test(character) ? character : encoded.toUpperCase();
    });
}

/** Greedy wildcard matching avoids attacker-controlled regex backtracking. */
function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const rule = normalizedPath(anchored ? pattern.slice(0, -1) : pattern);
  const candidate = normalizedPath(path);
  let p = 0, s = 0, star = -1, retry = 0;
  while (s < candidate.length) {
    if (p === rule.length && !anchored) return true;
    if (rule[p] === "*") { star = p++; retry = s; }
    else if (p < rule.length && rule[p] === candidate[s]) { p++; s++; }
    else if (star >= 0) { p = star + 1; s = ++retry; }
    else return false;
  }
  while (rule[p] === "*") p++;
  return p === rule.length;
}

function robotDecision(url: URL, agent: SiteDiagnosticAgent, rules: RobotsRules | null, state: SiteDiagnosticReport["robots"]["state"]): SiteRobotDecision {
  if (state === "unavailable") return { result: "not_checked", allowed: null, matchedRule: null, reason: "robots.txt could not be checked safely; Launch Auth fails closed and does not crawl pages." };
  if (state === "missing") return { result: "pass", allowed: true, matchedRule: null, reason: "robots.txt returned HTTP 404; no crawl restriction was available. This is not evidence of indexing." };
  if (url.pathname === "/robots.txt") return { result: "pass", allowed: true, matchedRule: null, reason: "The robots.txt policy URL is implicitly allowed by the Robots Exclusion Protocol." };
  const product = agent.toLowerCase();
  const groups = rules?.groups ?? [];
  const exact = groups.filter((group) => group.agents.includes(product));
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes("*"));
  const matched = selected.flatMap((group) => group.rules).filter((rule) => rule.path && ruleMatches(rule.path, url.pathname + url.search))
    .sort((a, b) => Buffer.byteLength(normalizedPath(b.path.replace(/\*|\$$/g, ""))) - Buffer.byteLength(normalizedPath(a.path.replace(/\*|\$$/g, ""))) || Number(b.allow) - Number(a.allow))[0];
  return { result: matched && !matched.allow ? "issue" : "pass", allowed: !matched || matched.allow, matchedRule: matched?.raw ?? null,
    reason: matched ? `${agent}: ${matched.raw}. Crawl permission is separate from index inclusion.` : `${agent}: no matching disallow rule in the retrieved policy. This does not establish indexing.` };
}

function relevantHeaders(headers: IncomingHttpHeaders): Record<string, string[]> {
  const retained: Record<string, string[]> = {};
  for (const name of ["content-type", "content-length", "content-encoding", "x-robots-tag", "location", "link", "last-modified"]) {
    const value = headers[name];
    // Native requests reject headers above this aggregate limit, so directive tails are not silently dropped.
    if (value !== undefined) retained[name] = (Array.isArray(value) ? value : [String(value)]).map((entry) => entry.slice(0, 16_384));
  }
  return retained;
}

function applicableDirectives(page: SiteDiagnosticPage, agent: SiteDiagnosticAgent): string[] {
  const wanted = agent.toLowerCase();
  const values = page.metaRobots.filter((entry) => entry.agent === "robots" || entry.agent === wanted).map((entry) => entry.value);
  for (const header of page.headerRobots) {
    let scope = "robots";
    for (const part of header.split(",")) {
      const prefix = part.trim().match(/^([a-z_-]+)\s*:\s*(.*)$/i);
      // Rule values containing a colon (e.g. max-snippet:0) are not user-agent scopes.
      const isRule = prefix && /^(?:max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i.test(prefix[1]);
      if (prefix && !isRule) scope = prefix[1].toLowerCase();
      if (scope === "robots" || scope === wanted) values.push(prefix && !isRule ? prefix[2] : part);
    }
  }
  return values.flatMap((value) => value.toLowerCase().split(/[,\s]+/)).filter(Boolean);
}

/** Inspect only the authorized origin. Authorization/tenant access belongs to the calling job boundary. */
export async function runSiteDiagnostics(rawUrl: string, dependencies: SiteDiagnosticDependencies = {}): Promise<SiteDiagnosticReport> {
  const target = secureUrl(rawUrl);
  const limits: Limits = { ...LIMITS };
  for (const key of Object.keys(LIMITS) as Array<keyof Limits>) {
    const provided = dependencies.limits?.[key];
    if (provided !== undefined && Number.isFinite(provided) && provided >= 1) limits[key] = Math.min(LIMITS[key], Math.floor(provided));
  }
  const started = Date.now();
  const deadline = started + limits.deadlineMs;
  const robotsUrl = new URL("/robots.txt", target);
  const report: SiteDiagnosticReport = {
    version: 1, id: randomUUID(), targetUrl: target.href, createdAt: stamp(), completedAt: "",
    pages: [], findings: [], snapshots: [], sitemaps: [], errors: [],
    robots: { url: robotsUrl.href, finalUrl: null, httpStatus: null, state: "unavailable", reason: "Not checked.", snapshotId: null, redirects: [], sitemapUrls: [] },
    scope: { origin: target.origin, maxPages: limits.maxPages, attemptedPageCount: 0, checkedPageCount: 0, retrievedPageCount: 0, requestCount: 0, maxRequests: limits.maxRequests, bytesRead: 0, maxTotalBytes: limits.maxTotalBytes, deadlineMs: limits.deadlineMs, sameOriginOnly: true, javascriptExecuted: false, searchEngineIndexChecked: false, skippedUrls: [],
      limitations: ["Customer-authorized public HTTP(S) origin only; no credentials, cookies, login, challenge bypass, or site changes.", "At most four page candidates: the submitted page and same-origin links discovered in its initial HTML only; omitted pages are not proven absent.", "Raw HTTP HTML only, with bounded lightweight tag extraction; JavaScript, styles, assets and browser DOM parsing are not executed. Engine-specific rendering and selected canonicals are not checked.", "Googlebot/Bingbot policy observations use robots.txt and directives served to LaunchAuthBot, not requests impersonating those engines; responses may vary by user agent.", "Crawl permission, HTTP success, canonical declarations and sitemap entries do not prove independent search-index inclusion.", "robots.txt failures (including non-404 errors), cross-origin redirects and limit exhaustion stop crawling conservatively. Sitemap indexes are inspected only within the two-file bound."] },
  };
  let rules: RobotsRules | null = null;
  function error(url: string, stage: "robots" | "page" | "sitemap", problem: string) { report.errors.push({ url, stage, message: problem, capturedAt: stamp() }); }
  function skip(url: string, reason: string) { if (report.scope.skippedUrls.length < 30) report.scope.skippedUrls.push({ url: url.slice(0, 512), reason }); }
  function finding(check: SiteDiagnosticCheck, url: string, result: SiteDiagnosticResult, reason: string, evidenceIds: string[] = [], agent?: SiteDiagnosticAgent) {
    report.findings.push({ id: digest(`${report.id}:${check}:${url}:${agent ?? ""}:${report.findings.length}`).slice(0, 24), check, url, result, reason, evidenceIds, capturedAt: stamp(), checkedScope: agent ? `${agent} rules in responses served to LaunchAuthBot; same-origin bounded HTTP inspection` : "Same-origin bounded HTTP inspection; initial response markup only", ...(agent ? { agent } : {}) });
  }
  function checkBudget() {
    if (Date.now() >= deadline) throw new Error("The total diagnostic deadline was reached.");
    if (report.scope.requestCount >= limits.maxRequests) throw new Error("The diagnostic request-count limit was reached.");
    if (report.scope.bytesRead >= limits.maxTotalBytes) throw new Error("The total diagnostic byte limit was reached.");
  }
  async function resolveAddress(url: URL): Promise<Address> {
    checkBudget();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        dependencies.resolver ? dependencies.resolver(hostname, { all: true, verbatim: true }) : lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Public DNS resolution exceeded the request deadline.")), Math.min(limits.requestTimeoutMs, deadline - Date.now())); }),
      ]);
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address) || entry.family !== isIP(entry.address))) throw new Error("The URL resolves to a private, non-public, or unavailable network address.");
      return addresses[0];
    } finally { if (timer) clearTimeout(timer); }
  }
  async function requestOne(url: URL, maxBytes: number): Promise<ResponseData> {
    const address = await resolveAddress(url);
    checkBudget();
    report.scope.requestCount++;
    const cap = Math.min(maxBytes, limits.maxTotalBytes - report.scope.bytesRead);
    return new Promise((resolve, reject) => {
      const capturedAt = stamp();
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finishResponse: ((problem: string) => void) | undefined;
      const pin: LookupFunction = (_hostname, _options, callback) => callback(null, address.address, address.family);
      const options: RequestOptions & { autoSelectFamily: false } = { method: "GET", agent: false, lookup: pin, family: address.family, autoSelectFamily: false, maxHeaderSize: 16_384,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/xml,text/xml;q=0.9", "accept-encoding": "identity" },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}) };
      const request = (dependencies.request ?? (url.protocol === "https:" ? httpsRequest : httpRequest))(url, options, (response) => {
        const headers = relevantHeaders(response.headers);
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let bytes = 0;
        function finish(problem: string | null = null) {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          const buffer = Buffer.concat(chunks);
          resolve({ url: url.href, status, headers, body: buffer.toString("utf8"), bytes, hash: digest(buffer), complete: !problem, error: problem, capturedAt });
        }
        finishResponse = finish;
        const encoding = headers["content-encoding"]?.[0]?.toLowerCase();
        const declaredLength = Number(headers["content-length"]?.[0] ?? 0);
        if (encoding && encoding !== "identity" || declaredLength > cap) {
          finish(encoding && encoding !== "identity" ? "Compressed responses are not decoded by this bounded inspector." : "The declared response exceeds the remaining byte limit.");
          response.destroy(); request.destroy(); return;
        }
        response.on("data", (input: Buffer | string) => {
          if (finished) return;
          const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
          const retained = chunk.subarray(0, Math.max(0, cap - bytes));
          chunks.push(retained); bytes += retained.byteLength; report.scope.bytesRead += retained.byteLength;
          if (retained.byteLength < chunk.byteLength) { finish("The response exceeded the bounded byte limit; content checks were not completed."); response.destroy(); request.destroy(); }
        });
        response.on("end", () => finish());
        response.on("error", (problem) => finish(message(problem)));
        response.on("aborted", () => finish("The response ended before its content was complete."));
        response.on("close", () => { if (!response.complete) finish("The response closed before its content was complete."); });
      });
      function fail(problem: Error) { if (!finished) { if (finishResponse) finishResponse(message(problem)); else { finished = true; if (timer) clearTimeout(timer); reject(problem); } } }
      request.on("error", fail);
      timer = setTimeout(() => { const problem = new Error("The request exceeded its bounded deadline."); fail(problem); request.destroy(problem); }, Math.min(limits.requestTimeoutMs, Math.max(1, deadline - Date.now())));
      request.end();
    });
  }
  function snapshot(response: ResponseData, kind: SiteDiagnosticSnapshot["kind"]) {
    const item: SiteDiagnosticSnapshot = { id: digest(`${response.url}:${response.capturedAt}:${response.hash}:${report.snapshots.length}`).slice(0, 24), url: response.url, capturedAt: response.capturedAt, kind, httpStatus: response.status, headers: response.headers, contentHash: response.hash, bytes: response.bytes, bodyComplete: response.complete, rawExcerpt: response.body.slice(0, kind === "robots" ? 8_000 : 3_000), relevantTags: [] };
    report.snapshots.push(item); return item;
  }
  async function chain(initial: URL, kind: "html" | "robots" | "sitemap", maxBytes: number): Promise<ChainResult> {
    const redirects: SiteDiagnosticRedirect[] = [];
    let url = initial;
    let last: ResponseData | null = null;
    let evidence: SiteDiagnosticSnapshot | null = null;
    const seen = new Set<string>();
    try {
      while (true) {
        url = secureUrl(url.href);
        if (url.origin !== target.origin) throw new Error("Cross-origin URLs are outside the authorized diagnostic scope.");
        if (kind !== "robots") {
          const decision = robotDecision(url, "LaunchAuthBot", rules, report.robots.state);
          if (decision.allowed !== true) throw new Error(decision.reason);
        }
        seen.add(url.href);
        last = await requestOne(url, maxBytes);
        evidence = snapshot(last, last.status >= 300 && last.status < 400 ? "response" : kind);
        if (![301, 302, 303, 307, 308].includes(last.status)) return { response: last, snapshot: evidence, redirects, error: last.error };
        const location = last.headers.location?.[0] ?? null;
        let next: URL | null = null;
        let reason = "Followed a same-origin redirect after public-DNS and robots checks.";
        try { if (!location) throw new Error("Redirect response has no Location header."); next = secureUrl(new URL(location, url).href); } catch (problem) { reason = message(problem); }
        if (next && next.origin !== target.origin) reason = "Cross-origin redirect recorded but not followed; it is outside the authorized origin.";
        else if (next && seen.has(next.href)) reason = "Redirect loop detected; not followed.";
        else if (redirects.length >= limits.maxRedirects) reason = "The same-origin redirect limit was reached; not followed.";
        else if (last.error) reason = last.error;
        else if (next && kind !== "robots" && robotDecision(next, "LaunchAuthBot", rules, report.robots.state).allowed !== true) reason = "Redirect target is not permitted by LaunchAuthBot robots rules; not followed.";
        const followed = reason.startsWith("Followed");
        redirects.push({ url: url.href, status: last.status, location: location?.slice(0, 2_048) ?? null, targetUrl: next?.href ?? null, followed, reason, evidenceId: evidence.id });
        if (!followed || !next) return { response: last, snapshot: evidence, redirects, error: reason };
        url = next;
      }
    } catch (problem) {
      const pending = redirects[redirects.length - 1];
      if (pending?.followed && pending.targetUrl !== last?.url) { pending.followed = false; pending.reason = `Redirect target was not successfully reached: ${message(problem)}`; }
      return { response: last, snapshot: evidence, redirects, error: message(problem) };
    }
  }

  const robots = await chain(robotsUrl, "robots", limits.maxRobotsBytes);
  report.robots.finalUrl = robots.response?.url ?? null;
  report.robots.httpStatus = robots.response?.status ?? null;
  report.robots.snapshotId = robots.snapshot?.id ?? null;
  report.robots.redirects = robots.redirects;
  try {
    if (robots.error) throw new Error(robots.error);
    if (robots.response?.status === 404) { report.robots.state = "missing"; report.robots.reason = "HTTP 404: no robots.txt policy was available."; }
    else if (robots.response && robots.response.status >= 200 && robots.response.status < 300) {
      const contentType = robots.response.headers["content-type"]?.[0] ?? "";
      if (robots.response.status === 206 || robots.response.body.trim() && !/^text\/plain(?:\s*;|$)/i.test(contentType)) throw new Error("robots.txt was partial or not served as a text/plain policy; crawling stopped conservatively.");
      rules = parseRobots(robots.response.body);
      report.robots.state = "available";
      report.robots.reason = "Parsed the captured robots.txt policy. Googlebot/Bingbot decisions are observations of this policy, not engine fetches or index evidence.";
      report.robots.sitemapUrls = rules.sitemaps;
    } else throw new Error(`robots.txt returned HTTP ${robots.response?.status ?? "unknown"}; crawling stopped conservatively.`);
  } catch (problem) { report.robots.reason = message(problem); error(robotsUrl.href, "robots", message(problem)); }

  const candidates = [target];
  const seenPages = new Set<string>([target.href]);
  for (let index = 0; index < candidates.length && report.pages.length < limits.maxPages; index++) {
    const url = candidates[index];
    const decisions = Object.fromEntries(AGENTS.map((agent) => [agent, robotDecision(url, agent, rules, report.robots.state)])) as SiteDiagnosticPage["robots"];
    const page: SiteDiagnosticPage = { id: digest(`${report.id}:${url.href}`).slice(0, 24), url: url.href, finalUrl: null, capturedAt: stamp(), httpStatus: null, retrieved: false, isHtml: null, redirects: [], robots: decisions, metaRobots: [], headerRobots: [], canonicals: [], indexStatus: "not_checked", snapshotId: null, error: null };
    report.pages.push(page);
    for (const agent of AGENTS) finding("robots_rules", url.href, decisions[agent].result, decisions[agent].reason, report.robots.snapshotId ? [report.robots.snapshotId] : [], agent);
    const result = decisions.LaunchAuthBot.allowed === true ? await chain(url, "html", limits.maxHtmlBytes) : null;
    if (result) report.scope.attemptedPageCount++;
    page.error = result?.error ?? (result ? null : decisions.LaunchAuthBot.reason);
    if (result?.response) {
      const response = result.response;
      page.finalUrl = response.url; page.capturedAt = response.capturedAt; page.httpStatus = response.status; page.snapshotId = result.snapshot?.id ?? null; page.redirects = result.redirects;
      page.headerRobots = response.headers["x-robots-tag"] ?? [];
      page.isHtml = /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers["content-type"]?.[0] ?? "");
      page.retrieved = response.status >= 200 && response.status < 300 && response.complete && !result.error;
      report.scope.checkedPageCount++;
      if (page.retrieved) report.scope.retrievedPageCount++;
      for (const agent of AGENTS) page.robots[agent] = robotDecision(new URL(response.url), agent, rules, report.robots.state);
    }
    if (page.error) error(url.href, "page", page.error);
    const evidence = page.snapshotId ? [page.snapshotId] : [];
    finding("accessibility", url.href, page.httpStatus === null ? "not_checked" : page.retrieved ? "pass" : "issue", page.httpStatus === null ? `No page response was checked. ${page.error ?? ""}` : `Observed HTTP ${page.httpStatus} at ${page.finalUrl}.${page.error ? ` ${page.error}` : page.retrieved ? " The response was retrievable; search indexing is not established." : " This was not a successful retrievable page response."}`, evidence);
    finding("redirects", url.href, page.redirects.length ? (page.redirects.some((entry) => !entry.followed) || page.error ? "issue" : "pass") : page.httpStatus === null ? "not_checked" : "not_applicable", page.redirects.length ? `${page.redirects.length} redirect response(s) recorded. ${page.redirects[page.redirects.length - 1].reason}` : page.httpStatus === null ? "No HTTP response was available to inspect redirects." : "No HTTP redirect was observed for this page.", page.redirects.map((entry) => entry.evidenceId));
    const htmlChecked = page.retrieved && page.httpStatus === 200 && page.isHtml === true && result?.response;
    let extractionLimited = false;
    if (htmlChecked) {
      const parsed = parseHtml(result.response!.body, new URL(page.finalUrl!), result.response!.headers);
      extractionLimited = parsed.inspectionLimited;
      page.metaRobots = parsed.metaRobots; page.canonicals = parsed.canonicals;
      if (result.snapshot) result.snapshot.relevantTags = parsed.relevantTags;
      finding("meta_robots", url.href, extractionLimited ? "not_checked" : "pass", extractionLimited ? "HTML tag/value extraction limits were reached; captured declarations are partial and absence of additional directives is unknown." : page.metaRobots.length ? `Captured ${page.metaRobots.length} robots meta declaration(s); applicability is evaluated separately per agent below.` : "No robots meta directive was observed in the initial HTML head. Rendered directives were not checked.", evidence);
      const canonicalUrls = new Set(page.canonicals.map((entry) => entry.url));
      const canonicalIssue = page.canonicals.some((entry) => !entry.url || entry.sameOrigin === false) || canonicalUrls.size > 1 || (canonicalUrls.size === 1 && !canonicalUrls.has(page.finalUrl));
      finding("canonical", url.href, canonicalIssue ? "issue" : extractionLimited ? "not_checked" : !page.canonicals.length ? "not_applicable" : "pass", extractionLimited ? "Tag extraction limits were reached; canonical declarations may be incomplete and need review." : !page.canonicals.length ? "No canonical declaration was observed; a canonical tag is not mandatory. Engine-selected canonical was not checked." : canonicalIssue ? "Canonical declarations differ from the response URL, conflict, are invalid, or point outside the origin. This may be intentional; review the captured declarations. No canonical target was fetched and the engine-selected canonical is unknown." : "The observed canonical declaration matches the final response URL. This is a publisher preference, not evidence of the engine-selected canonical.", evidence);
      finding("rendering", url.href, "not_checked", parsed.scriptCount && parsed.text.length < 100 ? `Potential rendering dependence: ${parsed.scriptCount} script tag(s) and ${parsed.text.length} characters of initial body text. JavaScript was not executed; this does not prove an empty page or failed engine rendering.` : `${parsed.text.length} characters of initial body text and ${parsed.scriptCount} script tag(s) observed. Rendered content, visual completeness and engine rendering were not checked.`, evidence);
      if (index === 0) {
        const nofollow = applicableDirectives(page, "LaunchAuthBot").some((directive) => directive === "nofollow" || directive === "none");
        for (const link of parsed.links) {
          try {
            const candidate = secureUrl(link.href);
            if (candidate.origin !== target.origin) { skip(candidate.href, "Off-origin link was not followed."); continue; }
            if (seenPages.has(candidate.href)) continue;
            seenPages.add(candidate.href);
            if (nofollow || link.nofollow) { skip(candidate.href, "A nofollow directive was respected."); continue; }
            if (candidate.search || /\.(?:pdf|jpe?g|png|gif|svg|webp|zip|xml|txt|mp4|mp3|css|js)$/i.test(candidate.pathname)) { skip(candidate.href, "Query-bearing URLs and apparent non-HTML assets are outside page discovery scope."); continue; }
            if (candidates.length >= limits.maxPages) { skip(candidate.href, "The four-page candidate limit was reached."); continue; }
            candidates.push(candidate);
          } catch { /* unsupported or credentialed links are never requested */ }
        }
      }
    } else {
      for (const check of ["meta_robots", "canonical", "rendering"] as const) finding(check, url.href, page.retrieved && page.isHtml === false ? "not_applicable" : "not_checked", page.retrieved && page.isHtml === false ? "The response was not HTML; HTML-specific inspection does not apply." : "No complete successful HTML response was available for this check.", evidence);
    }
    finding("header_robots", url.href, page.httpStatus === null ? "not_checked" : "pass", page.httpStatus === null ? "No HTTP response headers were available." : page.headerRobots.length ? `Captured ${page.headerRobots.length} X-Robots-Tag value(s); directives are evaluated only for their applicable agent.` : "No X-Robots-Tag was observed in the captured response headers.", evidence);
    for (const agent of ["Googlebot", "Bingbot"] as const) {
      const noindex = applicableDirectives(page, agent).some((directive) => directive === "noindex" || directive === "none");
      const unknown = !htmlChecked || extractionLimited || page.robots[agent].allowed === null;
      finding("indexability", url.href, noindex || page.robots[agent].allowed === false ? "issue" : unknown ? "not_checked" : "pass", noindex ? `${agent}: an applicable noindex/none directive was observed. It concerns this agent, not all engines; a robots block can prevent an engine from seeing it. Current index inclusion remains unmeasured.` : page.robots[agent].allowed === false ? `${agent}: this URL is blocked by the captured robots policy. That is a crawl restriction, not proof that the URL is absent from the index.` : unknown ? `${agent}: apparent indexability could not be assessed from complete HTML and available robots evidence.` : `${agent}: retrievable HTML with no applicable noindex and no matching robots block was observed. This is only apparent eligibility from initial HTML; rendering, engine-specific responses and actual index inclusion are unmeasured.`, [...evidence, ...(report.robots.snapshotId ? [report.robots.snapshotId] : [])], agent);
    }
    finding("index_status", url.href, "not_checked", "No dated native search-engine index inspection evidence was supplied. HTTP success, crawl permission, canonical tags, sitemap entries and supplier assertions do not establish index inclusion.", []);
  }

  const sitemapCandidates: Array<{ url: string; discoveredBy: SiteSitemapReport["discoveredBy"] }> = (rules?.sitemaps.length ? rules.sitemaps.map((url) => ({ url, discoveredBy: "robots" as const })) : [{ url: new URL("/sitemap.xml", target).href, discoveredBy: "default" }]);
  const seenSitemaps = new Set<string>();
  for (let index = 0; index < sitemapCandidates.length && report.sitemaps.length < limits.maxSitemaps; index++) {
    const candidate = sitemapCandidates[index];
    let url: URL;
    try { url = secureUrl(candidate.url); } catch { skip(candidate.url, "Invalid or non-public sitemap URL was not requested."); continue; }
    if (seenSitemaps.has(url.href)) continue;
    seenSitemaps.add(url.href);
    if (url.origin !== target.origin) { skip(url.href, "Off-origin sitemap declaration was not followed."); continue; }
    const sitemap: SiteSitemapReport = { url: url.href, finalUrl: null, discoveredBy: candidate.discoveredBy, result: "not_checked", reason: "Not checked.", httpStatus: null, snapshotId: null, redirects: [], kind: null, entries: [], entriesTruncated: false };
    report.sitemaps.push(sitemap);
    const fetched = await chain(url, "sitemap", limits.maxSitemapBytes);
    sitemap.finalUrl = fetched.response?.url ?? null; sitemap.httpStatus = fetched.response?.status ?? null; sitemap.snapshotId = fetched.snapshot?.id ?? null; sitemap.redirects = fetched.redirects;
    try {
      if (fetched.error) throw new Error(fetched.error);
      if (fetched.response?.status === 404 && candidate.discoveredBy === "default") { sitemap.result = "not_applicable"; sitemap.reason = "No sitemap declaration was discovered, and /sitemap.xml returned HTTP 404. Other sitemap locations were not searched."; }
      else {
        if (!fetched.response || fetched.response.status < 200 || fetched.response.status >= 300) throw new Error(`Sitemap returned HTTP ${fetched.response?.status ?? "unknown"}.`);
        const xml = fetched.response.body;
        // Never instantiate an XML parser or resolve entities. Reject DTDs entirely.
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Sitemap DTD/entity declarations are unsupported and were not processed.");
        const content = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "").trim();
        const root = content.match(/^<(urlset|sitemapindex)(?:\s[^>]*)?>/i)?.[1].toLowerCase();
        if (!root || !new RegExp(`</${root}\\s*>\\s*$`, "i").test(content)) throw new Error("The response was not a complete supported sitemap urlset or sitemapindex.");
        sitemap.kind = root as SiteSitemapReport["kind"];
        for (const match of content.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc\s*>/gi)) {
          if (sitemap.entries.length >= limits.maxSitemapEntries) { sitemap.entriesTruncated = true; break; }
          const value = decodeEntities(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, "$1").trim());
          try {
            const entry = secureUrl(value);
            if (entry.href.length > 512) { sitemap.entriesTruncated = true; skip(entry.href, "Sitemap URL exceeded the 512-character entry-retention limit."); continue; }
            if (entry.origin !== target.origin) { skip(entry.href, "Off-origin sitemap entry was not requested or counted as same-origin membership."); continue; }
            sitemap.entries.push(entry.href);
            if (root === "sitemapindex") sitemapCandidates.push({ url: entry.href, discoveredBy: "sitemap_index" });
          } catch { skip(value, "Invalid sitemap entry was not processed."); }
        }
        sitemap.result = "pass"; sitemap.reason = `Inspected a bounded ${root} with ${sitemap.entries.length} retained same-origin entries${sitemap.entriesTruncated ? " (entry limit reached)" : ""}. This is lightweight discovery, not XML schema validation or evidence of indexing.`;
      }
    } catch (problem) { sitemap.result = sitemap.httpStatus === null || fetched.error ? "not_checked" : "issue"; sitemap.reason = message(problem); error(url.href, "sitemap", sitemap.reason); }
    finding("sitemap_discovery", url.href, sitemap.result, sitemap.reason, sitemap.snapshotId ? [sitemap.snapshotId] : []);
  }
  if (!report.sitemaps.length) finding("sitemap_discovery", robotsUrl.href, "not_checked", "Declared sitemap locations were outside the authorized origin or invalid; they were not fetched.", report.robots.snapshotId ? [report.robots.snapshotId] : []);
  for (const page of report.pages) {
    const member = report.sitemaps.find((sitemap) => sitemap.kind === "urlset" && sitemap.entries.includes(page.finalUrl ?? page.url));
    finding("sitemap_membership", page.url, member ? "pass" : "not_checked", member ? "The final page URL was found in an inspected sitemap. Membership is a discovery hint, not index evidence." : "The URL was not found in the bounded inspected sitemap entries. Other sitemaps/entries may exist; sitewide membership is unknown.", member?.snapshotId ? [member.snapshotId] : []);
  }
  report.completedAt = stamp();
  // Raw evidence is useful but untrusted pages must not inflate the durable job document.
  // Keep primary-page evidence first; hashes/statuses always survive excerpt compaction.
  let retainedEvidenceBytes = 0;
  for (const item of [...report.snapshots].sort((a, b) => Number(b.kind === "html") - Number(a.kind === "html"))) {
    const size = Buffer.byteLength(JSON.stringify({ headers: item.headers, rawExcerpt: item.rawExcerpt, relevantTags: item.relevantTags }));
    if (retainedEvidenceBytes + size > 150_000) {
      item.rawEvidenceTruncated = true;
      item.headers = {};
      item.rawExcerpt = "";
      item.relevantTags = [];
    } else retainedEvidenceBytes += size;
  }
  if (report.snapshots.some((item) => item.rawEvidenceTruncated)) report.scope.limitations.push("The 150KB aggregate snapshot raw-evidence retention limit was reached. Marked snapshots retain status/hash but omit raw excerpts; a hash does not replace the omitted content.");
  return report;
}
