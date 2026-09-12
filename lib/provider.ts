import { randomUUID } from "node:crypto";

export type ProviderQuote = { provider: string; sandbox: boolean; nonBillable: boolean; providerCostCents: number; currency: string; providerPlan?: string; requiredCredits?: number | null };
export type ProviderPreflight = ProviderQuote & { packageId: ProviderPackageId; availableCredits: number | null; requiredCredits: number | null; submissionEnabled: boolean };
export type ProviderPackageId = "launch" | "authority" | "authority_plus";
export type DistributionDetails = { country: string; city: string; categories: string[]; contactName: string; contactEmail: string };
export type ProviderSubmissionInput = DistributionDetails & {
  campaignVersion: number;
  idempotencyKey: string;
  packageId: ProviderPackageId;
  title: string;
  summary: string;
  content: string;
  company: string;
  website: string;
  providerPlan?: string;
};
export type ProviderPackageOutcome = { package: string; state: string; creditsRefunded?: number; reason?: string };
export type ProviderSubmission = {
  externalId: string;
  status: "submitted" | "processing" | "published" | "failed" | "canceled";
  statusReason?: string;
  packageOutcomes?: ProviderPackageOutcome[];
};
export type ProviderEvidence = { url: string; state: "published" | "indexed"; observedAt: string };

export class ProviderSubmissionNeedsReviewError extends Error {
  readonly needsHumanReview = true;
}

export interface DistributionProvider {
  readonly id: string;
  assertCanSubmit(input: ProviderSubmissionInput): void;
  preflight(packageId: ProviderPackageId): Promise<ProviderPreflight>;
  quote(packageId: ProviderPackageId): Promise<ProviderQuote>;
  validate(details: DistributionDetails): Promise<void>;
  submit(input: ProviderSubmissionInput): Promise<ProviderSubmission>;
  status(externalId: string): Promise<ProviderSubmission>;
  evidence(externalId: string): Promise<ProviderEvidence[]>;
  cancel(externalId: string): Promise<{ canceled: boolean }>;
  refund(externalId: string): Promise<{ requested: boolean }>;
}

export class SandboxDistributionProvider implements DistributionProvider {
  readonly id = "sandbox";
  assertCanSubmit(_input: ProviderSubmissionInput): void {}
  async preflight(packageId: ProviderPackageId): Promise<ProviderPreflight> {
    return { ...(await this.quote(packageId)), packageId, availableCredits: null, requiredCredits: null, submissionEnabled: false };
  }

  async quote(_packageId: ProviderPackageId): Promise<ProviderQuote> {
    const configured = Number(process.env.SANDBOX_PROVIDER_COST_CENTS ?? 0);
    return { provider: "sandbox", sandbox: true, nonBillable: true, providerCostCents: Number.isFinite(configured) ? Math.max(0, configured) : 0, currency: "usd" };
  }

  async validate(_details: DistributionDetails): Promise<void> {}

  async submit(_input: ProviderSubmissionInput): Promise<ProviderSubmission> {
    return { externalId: `sandbox_${randomUUID()}`, status: "submitted" };
  }

  async status(externalId: string): Promise<ProviderSubmission> {
    return { externalId, status: "processing" };
  }

  async evidence(_externalId: string): Promise<ProviderEvidence[]> { return []; }
  async cancel(_externalId: string): Promise<{ canceled: boolean }> { return { canceled: true }; }
  async refund(_externalId: string): Promise<{ requested: boolean }> { return { requested: true }; }
}

type PrNowEnvelope = { success?: boolean; data?: unknown; error?: unknown } & Record<string, unknown>;

function nonPlaceholder(name: string) {
  const value = process.env[name]?.trim();
  if (!value || /replace_me|replace_with/i.test(value)) throw new Error(`${name} is not configured.`);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 1_000) throw new Error("PRNow returned too many records.");
  return value;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeProviderId(value: unknown) {
  const id = text(value);
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : "";
}

function mapPrNowStatus(value: unknown): ProviderSubmission["status"] {
  switch (text(value).toLowerCase()) {
    case "draft":
    case "pending": return "submitted";
    case "in_progress": return "processing";
    case "published":
    case "distributed": return "published";
    case "rejected": return "failed";
    case "refunded": return "canceled";
    default: throw new Error("PRNow returned an unknown release status.");
  }
}

function packageOutcomes(value: unknown): ProviderPackageOutcome[] {
  return array(value).flatMap((entry) => {
    const item = object(entry);
    const packageName = text(item.package || item.name || item.plan);
    const state = text(item.state || item.status);
    if (!packageName || !state) return [];
    const creditsRefunded = Number(item.creditsRefunded);
    return [{
      package: packageName.slice(0, 160),
      state: state.slice(0, 80),
      ...(Number.isSafeInteger(creditsRefunded) && creditsRefunded >= 0 ? { creditsRefunded } : {}),
      ...(text(item.reason) ? { reason: text(item.reason).slice(0, 500) } : {}),
    }];
  });
}

export function prNowSubmissionBody(input: ProviderSubmissionInput, plan: string) {
  const contact = ["Media Contact", input.contactName, input.company, input.contactEmail, input.website].join("\n");
  const content = `${input.content.trim()}\n\n${contact}`;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount > 1_200) throw new Error("The release and media contact block exceed PRNow's 1,200-word limit.");
  return {
    title: input.title,
    summary: input.summary,
    content,
    plan,
    categories: input.categories,
    country: input.country,
    city: input.city,
  };
}

const prNowPackageEnv: Record<ProviderPackageId, { plan: string; cost: string; credits: string }> = {
  launch: { plan: "PRNOW_PLAN_LAUNCH", cost: "PRNOW_COST_CENTS_LAUNCH", credits: "PRNOW_REQUIRED_CREDITS_LAUNCH" },
  authority: { plan: "PRNOW_PLAN_AUTHORITY", cost: "PRNOW_COST_CENTS_AUTHORITY", credits: "PRNOW_REQUIRED_CREDITS_AUTHORITY" },
  authority_plus: { plan: "PRNOW_PLAN_AUTHORITY_PLUS", cost: "PRNOW_COST_CENTS_AUTHORITY_PLUS", credits: "PRNOW_REQUIRED_CREDITS_AUTHORITY_PLUS" },
};

function prNowPackage(packageId: ProviderPackageId) {
  const names = prNowPackageEnv[packageId];
  const providerCostCents = Number(nonPlaceholder(names.cost));
  const requiredCredits = Number(nonPlaceholder(names.credits));
  if (!Number.isSafeInteger(providerCostCents) || providerCostCents <= 0) throw new Error(`${names.cost} must be a positive whole number.`);
  if (!Number.isSafeInteger(requiredCredits) || requiredCredits <= 0) throw new Error(`${names.credits} must be a positive whole number.`);
  return { plan: nonPlaceholder(names.plan), providerCostCents, requiredCredits };
}

export class PrNowDistributionProvider implements DistributionProvider {
  readonly id = "prnow";
  private readonly baseUrl = "https://prnow.io/api/v1";

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  assertCanSubmit(input: ProviderSubmissionInput): void {
    if (process.env.PRNOW_SUBMIT_ENABLED !== "true") throw new Error("PRNow submission is disabled until pilot approval is confirmed.");
    this.apiKey();
    if (!input.providerPlan?.trim()) throw new Error("The order has no frozen provider plan. Reconcile this order before submission.");
    prNowSubmissionBody(input, input.providerPlan);
  }

  private apiKey() {
    const apiKey = nonPlaceholder("PRNOW_API_KEY");
    if (!/^prnow_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("PRNOW_API_KEY has an invalid format.");
    return apiKey;
  }

  private async request(path: string, init: RequestInit = {}, submission = false) {
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.apiKey()}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
      if (response.status >= 300 && response.status < 400) throw new Error("PRNow redirects are not allowed.");
      const maximumBytes = 1_048_576;
      if (Number(response.headers.get("content-length")) > maximumBytes) {
        await response.body?.cancel();
        throw new Error("PRNow response exceeds the size limit.");
      }
      if (!response.body) throw new Error("PRNow returned an empty response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maximumBytes) {
            await reader.cancel();
            throw new Error("PRNow response exceeds the size limit.");
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PrNowEnvelope | null;
      if (!response.ok || payload?.success === false) {
        throw new Error(`PRNow request failed: ${(text(payload?.error) || `HTTP ${response.status}`).slice(0, 500)}`);
      }
      return payload?.data ?? payload;
    } catch (error) {
      // Any failure after dispatch can conceal an accepted, billable release.
      // Do not infer that a 4xx, parse failure, or transport error means no submission occurred.
      if (submission) throw new ProviderSubmissionNeedsReviewError(`PRNow submission response was uncertain. Reconcile the provider dashboard before retrying: ${error instanceof Error ? error.message : "network failure"}`);
      throw error;
    }
  }

  async preflight(packageId: ProviderPackageId): Promise<ProviderPreflight> {
    const { plan, providerCostCents, requiredCredits } = prNowPackage(packageId);
    const account = object(object(await this.request("/test")).account);
    const availableCredits = Number(account.maxSingleWalletCredits);
    if (!Number.isFinite(availableCredits) || availableCredits < requiredCredits) {
      throw new Error("The PRNow account does not have enough credits in one wallet for this package.");
    }
    return { provider: "prnow", sandbox: false, nonBillable: false, providerCostCents, currency: "usd", providerPlan: plan, packageId, availableCredits, requiredCredits, submissionEnabled: process.env.PRNOW_SUBMIT_ENABLED === "true" };
  }

  async quote(packageId: ProviderPackageId): Promise<ProviderQuote> {
    if (process.env.PRNOW_SUBMIT_ENABLED !== "true") throw new Error("PRNow submission is disabled until pilot approval is confirmed.");
    const preflight = await this.preflight(packageId);
    return { provider: preflight.provider, sandbox: preflight.sandbox, nonBillable: preflight.nonBillable, providerCostCents: preflight.providerCostCents, currency: preflight.currency, providerPlan: preflight.providerPlan, requiredCredits: preflight.requiredCredits };
  }

  async validate(details: DistributionDetails): Promise<void> {
    const [categoryPayload, countryPayload] = await Promise.all([this.request("/categories"), this.request("/countries")]);
    const categoryValues = new Set(array(object(categoryPayload).categories || categoryPayload).map((entry) => typeof entry === "string" ? entry : text(object(entry).name)).filter(Boolean));
    const countryValues = new Set(array(object(countryPayload).countries || countryPayload).map((entry) => typeof entry === "string" ? entry : text(object(entry).name)).filter(Boolean));
    if (!categoryValues.size || !countryValues.size) throw new Error("PRNow taxonomy is unavailable. Try again before preparing an order.");
    if (details.categories.some((category) => !categoryValues.has(category))) throw new Error("Choose categories from the current PRNow category list.");
    if (!countryValues.has(details.country)) throw new Error("Choose a country from the current PRNow country list.");
  }

  async submit(input: ProviderSubmissionInput): Promise<ProviderSubmission> {
    this.assertCanSubmit(input);
    try {
      const payload = object(await this.request("/submit", {
        method: "POST",
        body: JSON.stringify(prNowSubmissionBody(input, input.providerPlan!)),
      }, true));
      const externalId = safeProviderId(payload.pressReleaseId || payload.id || payload.release_id || payload.slugId);
      if (!externalId) throw new ProviderSubmissionNeedsReviewError("PRNow accepted the request but returned no usable release identifier. Reconcile the provider dashboard before retrying.");
      return { externalId, status: mapPrNowStatus(payload.status || "pending"), statusReason: text(payload.statusReason).slice(0, 500) || undefined, packageOutcomes: packageOutcomes(payload.packages) };
    } catch (error) {
      if (error instanceof ProviderSubmissionNeedsReviewError) throw error;
      throw new ProviderSubmissionNeedsReviewError(`PRNow submission needs reconciliation: ${error instanceof Error ? error.message : "invalid response"}`);
    }
  }

  async status(externalId: string): Promise<ProviderSubmission> {
    const id = safeProviderId(externalId);
    if (!id) throw new Error("The PRNow release identifier is invalid.");
    const payload = object(await this.request(`/status/${encodeURIComponent(id)}`));
    return {
      externalId: safeProviderId(payload.pressReleaseId || payload.id || payload.slugId) || id,
      status: mapPrNowStatus(payload.status),
      statusReason: text(payload.statusReason).slice(0, 500) || undefined,
      packageOutcomes: packageOutcomes(payload.packages),
    };
  }

  async evidence(externalId: string): Promise<ProviderEvidence[]> {
    const id = safeProviderId(externalId);
    if (!id) throw new Error("The PRNow release identifier is invalid.");
    const payload = await this.request(`/links/${encodeURIComponent(id)}`);
    const entries = array(object(payload).links || payload);
    const observedAt = new Date().toISOString();
    return entries.flatMap((entry) => {
      const item = object(entry);
      const rawUrl = typeof entry === "string" ? entry : text(item.url || item.link);
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") return [];
        const indexed = item.indexed === true || text(item.state || item.status).trim().toLowerCase() === "indexed";
        return [{ url: url.toString(), state: indexed ? "indexed" as const : "published" as const, observedAt: text(item.publishedAt || item.observedAt) || observedAt }];
      } catch { return []; }
    });
  }

  async cancel(externalId: string): Promise<{ canceled: boolean }> {
    const id = safeProviderId(externalId);
    if (!id) throw new Error("The PRNow release identifier is invalid.");
    const payload = object(await this.request(`/retract/${encodeURIComponent(id)}`, { method: "POST" }));
    return { canceled: text(payload.status).toLowerCase() === "refunded" };
  }

  async refund(externalId: string): Promise<{ requested: boolean }> {
    return { requested: (await this.cancel(externalId)).canceled };
  }
}

export function getDistributionProvider(providerId?: string): DistributionProvider {
  const configured = providerId ?? (process.env.FULFILLMENT_PROVIDER?.trim().toLowerCase() || "sandbox");
  if (configured === "sandbox") return new SandboxDistributionProvider();
  if (configured === "prnow") return new PrNowDistributionProvider();
  throw new Error("The configured distribution provider is not implemented.");
}
