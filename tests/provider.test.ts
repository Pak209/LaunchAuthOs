import { afterEach, describe, expect, it, vi } from "vitest";
import { getDistributionProvider, PrNowDistributionProvider, ProviderSubmissionNeedsReviewError, SandboxDistributionProvider, type ProviderSubmissionInput } from "../lib/provider";
import { nextProviderOrderStatus, providerReleaseFromCampaign } from "../lib/fulfillment";
import type { CampaignDraft } from "../lib/types";

const submissionInput: ProviderSubmissionInput = {
  campaignVersion: 1,
  idempotencyKey: "one",
  packageId: "launch",
  providerPlan: "standard",
  title: "Acme Introduces A Source Backed Launch Platform",
  summary: "Acme introduces a launch platform.",
  content: "word ".repeat(250).trim(),
  country: "United States",
  city: "Los Angeles",
  categories: ["Technology"],
  contactName: "Avery Founder",
  contactEmail: "press@acme.example",
  company: "Acme",
  website: "https://acme.example",
};

function configurePrNow() {
  vi.stubEnv("PRNOW_API_KEY", "prnow_test_key");
  vi.stubEnv("PRNOW_SUBMIT_ENABLED", "true");
  vi.stubEnv("PRNOW_COST_CENTS_LAUNCH", "2175");
  vi.stubEnv("PRNOW_REQUIRED_CREDITS_LAUNCH", "10");
  vi.stubEnv("PRNOW_PLAN_LAUNCH", "standard");
}

afterEach(() => vi.unstubAllEnvs());

describe("distribution provider boundary", () => {
  it("returns an explicitly non-billable sandbox quote", async () => {
    vi.stubEnv("SANDBOX_PROVIDER_COST_CENTS", "2175");
    await expect(new SandboxDistributionProvider().quote("launch")).resolves.toEqual({
      provider: "sandbox", sandbox: true, nonBillable: true, providerCostCents: 2175, currency: "usd",
    });
  });

  it("never treats an unknown configured provider as implemented", () => {
    vi.stubEnv("FULFILLMENT_PROVIDER", "uncontracted-provider");
    expect(() => getDistributionProvider()).toThrow(/not implemented/);
  });

  it("exposes the complete adapter lifecycle in sandbox mode", async () => {
    const provider = new SandboxDistributionProvider();
    const submission = await provider.submit(submissionInput);
    expect(submission.externalId).toMatch(/^sandbox_/);
    await expect(provider.status(submission.externalId)).resolves.toMatchObject({ status: "processing" });
    await expect(provider.evidence(submission.externalId)).resolves.toEqual([]);
    await expect(provider.cancel(submission.externalId)).resolves.toEqual({ canceled: true });
    await expect(provider.refund(submission.externalId)).resolves.toEqual({ requested: true });
  });

  it("keeps PRNow billing disabled until pilot submission is explicitly enabled", async () => {
    vi.stubEnv("PRNOW_API_KEY", "prnow_test_key");
    vi.stubEnv("PRNOW_COST_CENTS_LAUNCH", "2175");
    vi.stubEnv("PRNOW_REQUIRED_CREDITS_LAUNCH", "10");
    vi.stubEnv("PRNOW_PLAN_LAUNCH", "standard");
    await expect(new PrNowDistributionProvider(vi.fn() as never).quote("launch")).rejects.toThrow(/disabled/);
  });

  it("allows a non-publishing preflight while live submission remains locked", async () => {
    vi.stubEnv("PRNOW_API_KEY", "prnow_test_key");
    vi.stubEnv("PRNOW_COST_CENTS_LAUNCH", "2175");
    vi.stubEnv("PRNOW_REQUIRED_CREDITS_LAUNCH", "10");
    vi.stubEnv("PRNOW_PLAN_LAUNCH", "standard");
    const provider = new PrNowDistributionProvider(vi.fn(async () => Response.json({ success: true, data: { account: { maxSingleWalletCredits: 25 } } })) as typeof fetch);
    await expect(provider.preflight("launch")).resolves.toMatchObject({ provider: "prnow", availableCredits: 25, requiredCredits: 10, submissionEnabled: false });
  });

  it("preflights PRNow credentials, credits, plan, cost, and current taxonomy", async () => {
    configurePrNow();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/test")) return Response.json({ success: true, data: { account: { maxSingleWalletCredits: 25 } } });
      if (url.endsWith("/categories")) return Response.json({ success: true, data: ["Technology", "Finance"] });
      if (url.endsWith("/countries")) return Response.json({ success: true, data: [{ name: "United States" }] });
      return Response.json({ success: false, error: "unexpected" }, { status: 400 });
    });
    const provider = new PrNowDistributionProvider(fetcher as typeof fetch);
    await expect(provider.quote("launch")).resolves.toEqual({ provider: "prnow", sandbox: false, nonBillable: false, providerCostCents: 2175, currency: "usd", providerPlan: "standard", requiredCredits: 10 });
    await expect(provider.validate(submissionInput)).resolves.toBeUndefined();
    await expect(provider.validate({ ...submissionInput, categories: ["Invented"] })).rejects.toThrow(/current PRNow category/);
  });

  it("submits only the documented release fields and maps the provider lifecycle", async () => {
    configurePrNow();
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/submit")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          title: submissionInput.title, summary: submissionInput.summary, content: `${submissionInput.content}\n\nMedia Contact\nAvery Founder\nAcme\npress@acme.example\nhttps://acme.example`,
          plan: "standard", categories: ["Technology"], country: "United States", city: "Los Angeles",
        });
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer prnow_test_key");
        return Response.json({ success: true, data: { pressReleaseId: "release_123", status: "pending" } });
      }
      if (url.includes("/status/")) return Response.json({ success: true, data: { pressReleaseId: "release_123", status: "published", packages: [{ package: "standard", state: "published" }] } });
      if (url.includes("/links/")) return Response.json({ success: true, data: { links: [{ url: "https://news.example/acme", status: "indexed" }] } });
      if (url.includes("/retract/")) return Response.json({ success: true, data: { status: "refunded" } });
      return Response.json({ success: false, error: "unexpected" }, { status: 400 });
    });
    const provider = new PrNowDistributionProvider(fetcher as typeof fetch);
    await expect(provider.submit(submissionInput)).resolves.toMatchObject({ externalId: "release_123", status: "submitted" });
    await expect(provider.status("release_123")).resolves.toMatchObject({ status: "published", packageOutcomes: [{ package: "standard", state: "published" }] });
    await expect(provider.evidence("release_123")).resolves.toMatchObject([{ url: "https://news.example/acme", state: "indexed" }]);
    await expect(provider.cancel("release_123")).resolves.toEqual({ canceled: true });
  });

  it("forces human reconciliation when a submit response is ambiguous", async () => {
    configurePrNow();
    const provider = new PrNowDistributionProvider(vi.fn(async () => { throw new Error("connection reset"); }) as typeof fetch);
    await expect(provider.submit(submissionInput)).rejects.toBeInstanceOf(ProviderSubmissionNeedsReviewError);
  });

  it("enforces the live submit kill switch even for an already-prepared order", async () => {
    configurePrNow();
    vi.stubEnv("PRNOW_SUBMIT_ENABLED", "false");
    const fetcher = vi.fn();
    await expect(new PrNowDistributionProvider(fetcher).submit(submissionInput)).rejects.toThrow(/disabled/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the frozen order plan, not a newly configured plan", async () => {
    configurePrNow();
    vi.stubEnv("PRNOW_PLAN_LAUNCH", "more-expensive-plan");
    const fetcher = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body).plan).toBe("standard");
      return Response.json({ data: { id: "release_123", status: "pending" } });
    });
    await new PrNowDistributionProvider(fetcher).submit(submissionInput);
    await expect(new PrNowDistributionProvider(fetcher).submit({ ...submissionInput, providerPlan: undefined })).rejects.toThrow(/frozen provider plan/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => Response.json({ data: { id: "accepted_123", status: "new_status" } }),
    () => new Response("invalid json"),
    () => Response.json({ error: "timeout" }, { status: 504 }),
    () => Response.json({ error: "conflict" }, { status: 409 }),
    () => Response.json({ data: {} }),
  ])("never retries an unrecognized submit response automatically", async (response) => {
    configurePrNow();
    await expect(new PrNowDistributionProvider(vi.fn(async () => response())).submit(submissionInput)).rejects.toBeInstanceOf(ProviderSubmissionNeedsReviewError);
  });

  it("rejects redirects and caps streamed response bytes", async () => {
    configurePrNow();
    const redirect = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    });
    await expect(new PrNowDistributionProvider(redirect).status("release_123")).rejects.toThrow(/redirects/);
    const oversized = vi.fn(async () => new Response("x".repeat(1_048_577)));
    await expect(new PrNowDistributionProvider(oversized).status("release_123")).rejects.toThrow(/size limit/);
    await expect(new PrNowDistributionProvider(oversized).submit(submissionInput)).rejects.toBeInstanceOf(ProviderSubmissionNeedsReviewError);
  });

  it("bounds result arrays, fails closed on missing taxonomy, and stores no nested undefined fields", async () => {
    configurePrNow();
    const tooMany = new PrNowDistributionProvider(vi.fn(async () => Response.json({ data: { links: Array(1001).fill("https://example.com") } })));
    await expect(tooMany.evidence("release_123")).rejects.toThrow(/too many/);
    const missing = new PrNowDistributionProvider(vi.fn(async () => Response.json({ data: [] })));
    await expect(missing.validate(submissionInput)).rejects.toThrow(/taxonomy/);
    const provider = new PrNowDistributionProvider(vi.fn(async () => Response.json({ data: { status: "pending", packages: [{ package: "standard", state: "pending" }] } })));
    const result = await provider.status("release_123");
    expect(result.packageOutcomes).toStrictEqual([{ package: "standard", state: "pending" }]);
  });

  it("does not label 'not indexed' as indexed", async () => {
    configurePrNow();
    const provider = new PrNowDistributionProvider(vi.fn(async () => Response.json({ data: [{ url: "https://example.com/release", status: "not indexed" }] })));
    await expect(provider.evidence("release_123")).resolves.toMatchObject([{ state: "published" }]);
  });

  it("resolves existing orders independently of the provider default", () => {
    vi.stubEnv("FULFILLMENT_PROVIDER", "sandbox");
    expect(getDistributionProvider("prnow").id).toBe("prnow");
    expect(getDistributionProvider().id).toBe("sandbox");
  });

  it("validates the approved release against provider publication limits before payment", () => {
    const campaign: CampaignDraft = {
      version: 1, status: "approved", model: "test", generatedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      assets: [{ id: "release", type: "press_release", title: submissionInput.title, content: submissionInput.content, claimIds: ["claim"], status: "approved" }],
    };
    expect(providerReleaseFromCampaign(campaign)).toMatchObject({ title: submissionInput.title });
    expect(() => providerReleaseFromCampaign({ ...campaign, assets: [{ ...campaign.assets[0], content: "too short" }] })).toThrow(/250/);
  });

  it("does not move a provider order backward during later polling", () => {
    expect(nextProviderOrderStatus("submitted", "processing")).toBe("processing");
    expect(nextProviderOrderStatus("processing", "published")).toBe("published");
    expect(nextProviderOrderStatus("published", "processing")).toBe("published");
    expect(nextProviderOrderStatus("published", "failed")).toBe("failed");
    expect(nextProviderOrderStatus("refunded", "published")).toBe("refunded");
  });
});
