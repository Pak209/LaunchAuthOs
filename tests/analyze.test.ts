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
    expect(result.readiness.score).toBe(82);
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
