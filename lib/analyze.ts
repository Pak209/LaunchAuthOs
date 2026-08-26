import { lookup } from "node:dns/promises";
import { parsePublicHttpUrl, isPrivateIp } from "./url-security";
import type { AnalysisResult, Claim } from "./types";

const MAX_HTML_BYTES = 1_000_000;
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

async function readLimitedHtml(response: Response): Promise<string> {
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
      if (received > MAX_HTML_BYTES) throw new Error("The page is too large to analyze safely.");
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

export async function analyzeCompany(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
  resolver: DnsLookup = lookup,
): Promise<AnalysisResult> {
  const url = parsePublicHttpUrl(rawUrl);
  await assertPublicDns(url.hostname, resolver);

  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { "user-agent": "LaunchAuthBot/0.1 (+source-backed brand profile)" },
  });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML page.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES) throw new Error("The page is too large to analyze safely.");

  const html = await readLimitedHtml(response);
  const { title, description } = extractMetadata(html);
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

  const missingInformation = [
    !description && "A clear public product description",
    "Independent customer or user evidence",
    "A dated, verifiable launch milestone",
    "Founder-approved target audience",
  ].filter(Boolean) as string[];
  const score = Math.min(82, 35 + (title ? 18 : 0) + (description ? 22 : 0) + (url.protocol === "https:" ? 7 : 0));

  return {
    profile: {
      company,
      product: title || company,
      audience: "UNKNOWN — founder confirmation required",
      positioning: description || "UNKNOWN — no public description found",
      sourceUrl: url.toString(),
      claims,
    },
    readiness: {
      score,
      label: score >= 70 ? "Promising, with proof gaps" : "Not ready for paid distribution",
      rationale: [
        title ? "The homepage identifies the product or company." : "The homepage has no usable title.",
        description ? "The homepage provides public positioning language." : "Public positioning is incomplete.",
        "No independent proof was observed in this initial homepage-only crawl.",
      ],
      missingInformation,
      strongestStoryAngle: description
        ? `Clarify the most verifiable change behind “${description.slice(0, 100)}${description.length > 100 ? "…" : ""}”`
        : "No defensible story angle yet—add a concrete milestone or product change.",
    },
    fetchedAt: new Date().toISOString(),
  };
}
