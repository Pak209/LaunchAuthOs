import { describe, expect, it, vi } from "vitest";
import { analyzeCompany } from "../lib/analyze";

const publicResolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("company analysis", () => {
  it("creates evidence-backed claims from homepage metadata", async () => {
    const fetcher = vi.fn(async () => new Response(
      '<html><head><title>Acme — Ship faster</title><meta name="description" content="A release platform for small teams."></head></html>',
      { status: 200, headers: { "content-type": "text/html" } },
    ));

    const result = await analyzeCompany("https://acme.example", fetcher as typeof fetch, publicResolver as never);

    expect(result.profile.company).toBe("Acme");
    expect(result.profile.positioning).toBe("A release platform for small teams.");
    expect(result.profile.claims).toHaveLength(2);
    expect(result.profile.claims.every((claim) => claim.state === "VERIFIED")).toBe(true);
    expect(result.sources?.[0]).toMatchObject({ url: "https://acme.example/", description: "A release platform for small teams." });
    expect(result.sources?.[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.profile.findings.positioning[0].confidence).toBeGreaterThan(0.9);
    expect(result.readiness.score).toBe(82);
  });

  it("extracts structured audiences, founders, milestones, proof points, and competitors", async () => {
    const html = `<html><head><title>Acme</title><meta name="description" content="Launch software for independent teams."></head><body>
      <h1>Acme Launch Cloud</h1><p>Founded by Ada Lovelace. Built for startup marketing teams.</p>
      <p>Acme launched in 2024 and now serves 12,000 customers.</p><p>An alternative to Legacy Press.</p></body></html>`;
    const fetcher = vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }));

    const result = await analyzeCompany("https://acme.example", fetcher as typeof fetch, publicResolver as never);

    expect(result.profile.findings.audience.some((finding) => /teams/i.test(finding.value))).toBe(true);
    expect(result.profile.findings.founder.some((finding) => finding.value === "Ada Lovelace")).toBe(true);
    expect(result.profile.findings.milestone.some((finding) => /2024/.test(finding.value))).toBe(true);
    expect(result.profile.findings.proof_point.some((finding) => /12,000/.test(finding.value))).toBe(true);
    expect(result.profile.findings.competitor.some((finding) => /Legacy Press/.test(finding.value))).toBe(true);
  });

  it("rejects non-HTML responses", async () => {
    const fetcher = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(analyzeCompany("https://acme.example", fetcher as typeof fetch, publicResolver as never))
      .rejects.toThrow(/HTML/);
  });

  it("rejects hosts resolving to private addresses", async () => {
    const privateResolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const fetcher = vi.fn();

    await expect(analyzeCompany("https://acme.example", fetcher as typeof fetch, privateResolver as never))
      .rejects.toThrow(/private/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops reading chunked HTML after the byte limit", async () => {
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(750_000));
        controller.enqueue(new Uint8Array(300_001));
        controller.close();
      },
    });
    const fetcher = vi.fn(async () => new Response(oversized, {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    await expect(analyzeCompany("https://acme.example", fetcher as typeof fetch, publicResolver as never))
      .rejects.toThrow(/too large/);
  });

  it("collects a bounded set of same-origin source pages", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const requested = input.toString();
      const html = requested.includes("/about")
        ? '<html><head><title>About Acme</title><meta name="description" content="Acme helps independent teams ship verified launches."></head></html>'
        : '<html><head><title>Acme</title></head><body><a href="/about">About</a><a href="https://other.example/press">Offsite</a></body></html>';
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const result = await analyzeCompany("https://acme.example", fetcher as typeof fetch, publicResolver as never);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.sources).toHaveLength(2);
    expect(result.profile.positioning).toContain("independent teams");
    expect(result.profile.claims.some((claim) => claim.sourceUrl.endsWith("/about"))).toBe(true);
    expect(result.sources?.some((source) => source.url.includes("other.example"))).toBe(false);
  });
});
