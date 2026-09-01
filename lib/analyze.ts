import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { parsePublicHttpUrl, isPrivateIp } from "./url-security";
import type { AnalysisResult, Claim, EvidenceSnapshot, FindingKind, StructuredFinding } from "./types";

const MAX_HTML_BYTES = 1_000_000;
const MAX_SECONDARY_HTML_BYTES = 350_000;
const MAX_PAGES = 4;
const META_PATTERN = /<meta\s+[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
const REVERSED_META_PATTERN = /<meta\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']([^"']+)["'][^>]*>/gi;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageText(html: string): string {
  return decode(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function extractMetadata(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const heading = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "");
  const metadata = new Map<string, string>();
  for (const match of html.matchAll(META_PATTERN)) metadata.set(match[1].toLowerCase(), decode(match[2]));
  for (const match of html.matchAll(REVERSED_META_PATTERN)) metadata.set(match[2].toLowerCase(), decode(match[1]));
  return {
    title: metadata.get("og:site_name") || title,
    description: metadata.get("description") || metadata.get("og:description") || "",
    heading,
  };
}

function cleanCompanyName(title: string, hostname: string): string {
  const firstSegment = title.split(/[|–—-]/)[0]?.trim();
  if (firstSegment && firstSegment.length <= 80) return firstSegment;
  const base = hostname.replace(/^www\./, "").split(".")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : hostname;
}

async function readLimitedHtml(response: Response, maxBytes = MAX_HTML_BYTES): Promise<string> {
  if (!response.body) throw new Error("The page returned no readable content.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error("The page is too large to analyze safely.");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

type DnsLookup = typeof lookup;
type PublicAddress = { address: string; family: number };

async function resolvePublicAddress(hostname: string, resolver: DnsLookup): Promise<PublicAddress> {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The URL resolves to a private or unavailable network address.");
  }
  return addresses[0];
}

function pinnedRequest(url: URL, target: PublicAddress, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const lookupPinned: LookupFunction = (_hostname, _options, callback) => callback(null, target.address, target.family);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: { "user-agent": "LaunchAuthBot/0.3 (+source-backed brand profile)", accept: "text/html" },
      lookup: lookupPinned,
      servername: url.hostname,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(status >= 300 && status < 400 ? "Redirects are not followed during secure analysis." : `The website returned HTTP ${status}.`));
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "");
      if (!contentType.includes("text/html")) {
        response.resume();
        reject(new Error("The URL did not return an HTML page."));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > maxBytes) {
        response.resume();
        reject(new Error("The page is too large to analyze safely."));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > maxBytes) request.destroy(new Error("The page is too large to analyze safely."));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    request.setTimeout(8_000, () => request.destroy(new Error("The website took too long to respond.")));
    request.on("error", reject);
    request.end();
  });
}

function discoverSourceUrls(html: string, baseUrl: URL): URL[] {
  const priority = /(about|product|features|solutions|customers|company|press|news|launch)/i;
  const links: Array<{ url: URL; priority: number }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\s+[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const candidate = new URL(match[1], baseUrl);
      candidate.hash = "";
      candidate.search = "";
      if (candidate.origin !== baseUrl.origin || candidate.pathname === baseUrl.pathname || seen.has(candidate.href)) continue;
      if (!(["http:", "https:"] as string[]).includes(candidate.protocol)) continue;
      seen.add(candidate.href);
      links.push({ url: candidate, priority: priority.test(candidate.pathname) ? 0 : 1 });
    } catch {
      continue;
    }
  }
  return links.sort((a, b) => a.priority - b.priority || a.url.pathname.length - b.url.pathname.length).slice(0, MAX_PAGES - 1).map(({ url }) => url);
}

async function fetchHtmlPage(url: URL, fetcher: typeof fetch | undefined, resolver: DnsLookup, maxBytes = MAX_HTML_BYTES) {
  const address = await resolvePublicAddress(url.hostname, resolver);
  if (!fetcher) return pinnedRequest(url, address, maxBytes);
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { "user-agent": "LaunchAuthBot/0.3 (+source-backed brand profile)" },
  });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML page.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("The page is too large to analyze safely.");
  return readLimitedHtml(response, maxBytes);
}

function snapshotFor(url: string, html: string, capturedAt: string): EvidenceSnapshot {
  const metadata = extractMetadata(html);
  const text = pageText(html);
  const contentHash = createHash("sha256").update(html).digest("hex");
  return {
    id: createHash("sha256").update(`${url}:${contentHash}:${capturedAt}`).digest("hex").slice(0, 24),
    url,
    title: metadata.title,
    description: metadata.description,
    excerpt: text.slice(0, 1_500),
    contentHash,
    capturedAt,
  };
}

function findingId(kind: FindingKind, value: string, evidenceId: string): string {
  return createHash("sha256").update(`${kind}:${value}:${evidenceId}`).digest("hex").slice(0, 20);
}

function structuredFindings(snapshots: EvidenceSnapshot[], company: string): Record<FindingKind, StructuredFinding[]> {
  const findings: Record<FindingKind, StructuredFinding[]> = {
    product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [],
  };
  const seen = new Set<string>();
  function add(kind: FindingKind, value: string, source: EvidenceSnapshot, confidence: number) {
    const normalized = value.replace(/\s+/g, " ").replace(/^[\s:,-]+|[\s,;:-]+$/g, "").trim();
    const key = `${kind}:${normalized.toLowerCase()}`;
    if (normalized.length < 3 || normalized.length > 240 || seen.has(key) || findings[kind].length >= 12) return;
    seen.add(key);
    findings[kind].push({
      id: findingId(kind, normalized, source.id), kind, value: normalized,
      sourceUrl: source.url, evidenceId: source.id, confidence, observedAt: source.capturedAt,
    });
  }

  for (const [index, source] of snapshots.entries()) {
    if (source.description) add("positioning", source.description, source, index === 0 ? 0.96 : 0.9);
    if (index === 0 && source.title) add("product", source.title.split(/[|–—]/)[0], source, 0.86);
    const text = source.excerpt;
    for (const match of text.matchAll(/(?:built|designed|created|platform|software|tool|solution)\s+for\s+([^.!?]{3,100})/gi)) add("audience", match[1], source, 0.78);
    for (const match of text.matchAll(/(?:helps?|empowers?|enables?)\s+([^.!?]{3,100})\s+(?:to|build|create|launch|grow|manage)/gi)) add("audience", match[1], source, 0.72);
    for (const match of text.matchAll(/(?:founded by|co-founders?|founder(?:\s+and\s+ceo)?)\s*[:,-]?\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})/gi)) add("founder", match[1], source, 0.84);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length <= 240);
    for (const sentence of sentences) {
      if (/\b(?:launched|founded|raised|announced|released|reached|serves?)\b/i.test(sentence) && /\b(?:19|20)\d{2}\b|\b\d[\d,.]*\s*(?:users?|customers?|million|billion|k|m)\b/i.test(sentence)) add("milestone", sentence, source, 0.76);
      if (/\b\d[\d,.]*\s*(?:%|users?|customers?|teams?|companies|reviews?|stars?|million|billion|k|m)\b/i.test(sentence)) add("proof_point", sentence, source, 0.82);
    }
    for (const match of text.matchAll(/(?:alternative to|compared (?:with|to)|versus|vs\.?)\s+([A-Z][A-Za-z0-9 .'-]{2,60})/g)) add("competitor", match[1], source, 0.68);
  }
  if (!findings.product.length && snapshots[0]) add("product", company, snapshots[0], 0.6);
  return findings;
}

export async function analyzeCompany(
  rawUrl: string,
  fetcher?: typeof fetch,
  resolver: DnsLookup = lookup,
): Promise<AnalysisResult> {
  const url = parsePublicHttpUrl(rawUrl);
  const capturedAt = new Date().toISOString();
  const html = await fetchHtmlPage(url, fetcher, resolver);
  const { title, description } = extractMetadata(html);
  const discovered = discoverSourceUrls(html, url);
  const secondaryResults = await Promise.allSettled(discovered.map(async (sourceUrl) => ({
    url: sourceUrl.toString(),
    html: await fetchHtmlPage(sourceUrl, fetcher, resolver, MAX_SECONDARY_HTML_BYTES),
  })));
  const pages = [{ url: url.toString(), html }, ...secondaryResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])];
  const sources = pages.map((page) => snapshotFor(page.url, page.html, capturedAt));
  const company = cleanCompanyName(title, url.hostname);
  const findings = structuredFindings(sources, company);
  const strongestDescription = description || sources.find((source) => source.description)?.description || "";
  const claims: Claim[] = [{
    id: "site-exists",
    text: `${company} operates the website ${url.hostname}.`,
    sourceUrl: url.toString(), state: "VERIFIED", approved: false,
    evidenceIds: [sources[0].id], confidence: 1, observedAt: capturedAt,
  }];
  const observedStatements = [...findings.positioning, ...findings.milestone, ...findings.proof_point];
  for (const finding of observedStatements) {
    if (claims.some((claim) => claim.text === finding.value)) continue;
    claims.push({
      id: `finding-${finding.id}`, text: finding.value, sourceUrl: finding.sourceUrl,
      state: "VERIFIED", approved: false, evidenceIds: [finding.evidenceId],
      confidence: finding.confidence, observedAt: finding.observedAt,
    });
  }

  const audience = findings.audience[0]?.value ?? "UNKNOWN — founder confirmation required";
  const missingInformation = [
    !strongestDescription && "A clear public product description",
    !findings.audience.length && "Founder-approved target audience",
    !findings.proof_point.length && "Independent customer or user evidence",
    !findings.milestone.length && "A dated, verifiable launch milestone",
    !findings.founder.length && "Founder identity and role",
  ].filter(Boolean) as string[];
  const score = Math.min(90, 35 + (title ? 18 : 0) + (strongestDescription ? 22 : 0) + (url.protocol === "https:" ? 7 : 0) + Math.min(8, (sources.length - 1) * 3));

  return {
    profile: {
      company,
      product: findings.product[0]?.value || title || company,
      audience,
      positioning: strongestDescription || "UNKNOWN — no public description found",
      sourceUrl: url.toString(), claims, findings,
    },
    readiness: {
      score,
      label: score >= 70 ? "Promising, with proof gaps" : "Not ready for paid distribution",
      rationale: [
        title ? "The homepage identifies the product or company." : "The homepage has no usable title.",
        strongestDescription ? "Public positioning language was observed." : "Public positioning is incomplete.",
        `${sources.length} bounded public source page${sources.length === 1 ? " was" : "s were"} captured as immutable evidence.`,
      ],
      missingInformation,
      strongestStoryAngle: strongestDescription
        ? `Clarify the most verifiable change behind “${strongestDescription.slice(0, 100)}${strongestDescription.length > 100 ? "…" : ""}”`
        : "No defensible story angle yet—add a concrete milestone or product change.",
    },
    sources,
    fetchedAt: capturedAt,
  };
}
