import { randomUUID } from "node:crypto";

export type ProviderQuote = { provider: string; sandbox: boolean; nonBillable: boolean; providerCostCents: number; currency: string };
export type ProviderSubmission = { externalId: string; status: "submitted" | "processing" | "published" | "failed" | "canceled" };
export type ProviderEvidence = { url: string; state: "published" | "indexed"; observedAt: string };

export interface DistributionProvider {
  quote(): Promise<ProviderQuote>;
  submit(input: { campaignVersion: number; idempotencyKey: string }): Promise<ProviderSubmission>;
  status(externalId: string): Promise<ProviderSubmission>;
  evidence(externalId: string): Promise<ProviderEvidence[]>;
  cancel(externalId: string): Promise<{ canceled: boolean }>;
  refund(externalId: string): Promise<{ requested: boolean }>;
}

export class SandboxDistributionProvider implements DistributionProvider {
  async quote(): Promise<ProviderQuote> {
    const configured = Number(process.env.SANDBOX_PROVIDER_COST_CENTS ?? 0);
    return { provider: "sandbox", sandbox: true, nonBillable: true, providerCostCents: Number.isFinite(configured) ? Math.max(0, configured) : 0, currency: "usd" };
  }

  async submit(_input: { campaignVersion: number; idempotencyKey: string }): Promise<ProviderSubmission> {
    return { externalId: `sandbox_${randomUUID()}`, status: "submitted" };
  }

  async status(externalId: string): Promise<ProviderSubmission> {
    return { externalId, status: "processing" };
  }

  async evidence(_externalId: string): Promise<ProviderEvidence[]> { return []; }
  async cancel(_externalId: string): Promise<{ canceled: boolean }> { return { canceled: true }; }
  async refund(_externalId: string): Promise<{ requested: boolean }> { return { requested: true }; }
}

export function getDistributionProvider(): DistributionProvider {
  if (process.env.FULFILLMENT_PROVIDER && process.env.FULFILLMENT_PROVIDER !== "sandbox") {
    throw new Error("The configured distribution provider is not implemented.");
  }
  return new SandboxDistributionProvider();
}
