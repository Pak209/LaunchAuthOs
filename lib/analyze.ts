import { lookup } from "node:dns/promises";
import { parsePublicHttpUrl, isPrivateIp } from "./url-security";
import type { AnalysisResult, Claim } from "./types";

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
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetadata(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const metadata = new Map<string, string>();
  for (const match of html.matchAll(META_PATTERN)) metadata.set(match[1].toLowerCase(), decode(match[2]));
  for (const match of html.matchAll(REVERSED_META_PATTERN)) metadata.set(match[2].toLowerCase(), decode(match[1]));
  return {
    title: metadata.get("og:site_name") || title,
    description: metadata.get("description") || metadata.get("og:description") || "",
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

async function assertPublicDns(hostname: string, resolver: DnsLookup): Promise<void> {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The URL resolves to a private or unavailable network address.");
  }
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

async function fetchHtmlPage(url: URL, fetcher: typeof fetch, resolver: DnsLookup, maxBytes = MAX_HTML_BYTES) {
  await assertPublicDns(url.hostname, resolver);
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { "user-agent": "LaunchAuthBot/0.2 (+source-backed brand profile)" },
  });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML page.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("The page is too large to analyze safely.");
  return readLimitedHtml(response, maxBytes);
}

export async function analyzeCompany(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
  resolver: DnsLookup = lookup,
): Promise<AnalysisResult> {
  const url = parsePublicHttpUrl(rawUrl);
  const html = await fetchHtmlPage(url, fetcher, resolver);
  const { title, description } = extractMetadata(html);
  const discovered = discoverSourceUrls(html, url);
  const secondaryResults = await Promise.allSettled(discovered.map(async (sourceUrl) => {
    const sourceHtml = await fetchHtmlPage(sourceUrl, fetcher, resolver, MAX_SECONDARY_HTML_BYTES);
    return { url: sourceUrl.toString(), ...extractMetadata(sourceHtml) };
  }));
  const sources = [
    { url: url.toString(), title, description },
    ...secondaryResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
  ];
  const company = cleanCompanyName(title, url.hostname);
  const claims: Claim[] = [
    {
      id: "site-exists",
      text: `${company} operates the website ${url.hostname}.`,
      sourceUrl: url.toString(),
      state: "VERIFIED",
      approved: false,
    },
  ];

  if (description) {
    claims.push({
      id: "site-description",
      text: description,
      sourceUrl: url.toString(),
      state: "VERIFIED",
      approved: false,
    });
  }
  const seenDescriptions = new Set(description ? [description] : []);
  for (const [index, source] of sources.slice(1).entries()) {
    if (!source.description || seenDescriptions.has(source.description)) continue;
    seenDescriptions.add(source.description);
    claims.push({
      id: `source-description-${index + 1}`,
      text: source.description,
      sourceUrl: source.url,
      state: "VERIFIED",
      approved: false,
    });
  }

  const strongestDescription = description || sources.find((source) => source.description)?.description || "";

  const missingInformation = [
    !strongestDescription && "A clear public product description",
    "Independent customer or user evidence",
    "A dated, verifiable launch milestone",
    "Founder-approved target audience",
  ].filter(Boolean) as string[];
  const score = Math.min(90, 35 + (title ? 18 : 0) + (strongestDescription ? 22 : 0) + (url.protocol === "https:" ? 7 : 0) + Math.min(8, (sources.length - 1) * 3));

  return {
    profile: {
      company,
      product: title || company,
      audience: "UNKNOWN — founder confirmation required",
      positioning: strongestDescription || "UNKNOWN — no public description found",
      sourceUrl: url.toString(),
      claims,
    },
    readiness: {
      score,
      label: score >= 70 ? "Promising, with proof gaps" : "Not ready for paid distribution",
      rationale: [
        title ? "The homepage identifies the product or company." : "The homepage has no usable title.",
        strongestDescription ? "Public positioning language was observed." : "Public positioning is incomplete.",
        `${sources.length} bounded public source page${sources.length === 1 ? " was" : "s were"} observed; independent proof still requires validation.`,
      ],
      missingInformation,
      strongestStoryAngle: strongestDescription
        ? `Clarify the most verifiable change behind “${strongestDescription.slice(0, 100)}${strongestDescription.length > 100 ? "…" : ""}”`
        : "No defensible story angle yet—add a concrete milestone or product change.",
    },
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
