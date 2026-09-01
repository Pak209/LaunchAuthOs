import { afterEach, describe, expect, it, vi } from "vitest";
import { getDistributionProvider, SandboxDistributionProvider } from "../lib/provider";
import { nextProviderOrderStatus } from "../lib/fulfillment";

afterEach(() => vi.unstubAllEnvs());

describe("distribution provider boundary", () => {
  it("returns an explicitly non-billable sandbox quote", async () => {
    vi.stubEnv("SANDBOX_PROVIDER_COST_CENTS", "2175");
    await expect(new SandboxDistributionProvider().quote()).resolves.toEqual({
      provider: "sandbox", sandbox: true, nonBillable: true, providerCostCents: 2175, currency: "usd",
    });
  });

  it("never treats an unknown configured provider as implemented", () => {
    vi.stubEnv("FULFILLMENT_PROVIDER", "uncontracted-provider");
    expect(() => getDistributionProvider()).toThrow(/not implemented/);
  });

  it("exposes the complete adapter lifecycle in sandbox mode", async () => {
    const provider = new SandboxDistributionProvider();
    const submission = await provider.submit({ campaignVersion: 1, idempotencyKey: "one" });
    expect(submission.externalId).toMatch(/^sandbox_/);
    await expect(provider.status(submission.externalId)).resolves.toMatchObject({ status: "processing" });
    await expect(provider.evidence(submission.externalId)).resolves.toEqual([]);
    await expect(provider.cancel(submission.externalId)).resolves.toEqual({ canceled: true });
    await expect(provider.refund(submission.externalId)).resolves.toEqual({ requested: true });
  });

  it("does not move a provider order backward during later polling", () => {
    expect(nextProviderOrderStatus("submitted", "processing")).toBe("processing");
    expect(nextProviderOrderStatus("processing", "published")).toBe("published");
    expect(nextProviderOrderStatus("published", "processing")).toBe("published");
    expect(nextProviderOrderStatus("published", "failed")).toBe("failed");
    expect(nextProviderOrderStatus("refunded", "published")).toBe("refunded");
  });
});
