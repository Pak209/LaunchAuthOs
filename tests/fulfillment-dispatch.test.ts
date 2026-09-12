import { afterEach, describe, expect, it, vi } from "vitest";
import { assertJobCanRetry, markPaymentIntentRefunded, prepareFulfillment, runQueuedFulfillmentJobs } from "../lib/fulfillment";
import { campaignDigest } from "../lib/campaign-approval";
import { ProviderSubmissionNeedsReviewError, type DistributionProvider, type ProviderSubmissionInput } from "../lib/provider";
import type { CampaignDraft, JobRun } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const projectId = "a".repeat(24);
const project = `workspaces/personal_owner/projects/${projectId}`;
const orderPath = `${project}/orders/current`;
const jobPath = `${project}/jobs/provider_submission_current`;
const now = "2026-09-11T00:00:00.000Z";
const details = { country: "United States", city: "Boston", categories: ["Technology"], contactName: "Founder", contactEmail: "press@example.com" };
const campaign: CampaignDraft = {
  version: 1, status: "approved", model: "test", generatedAt: now, updatedAt: now,
  assets: [{ id: "release", type: "press_release", title: "Acme Introduces A New Product Today", content: "word ".repeat(300), claimIds: ["approved"], status: "approved" }],
};
const quote = { provider: "prnow", sandbox: false, nonBillable: false, currency: "usd", providerCostCents: 2175, providerPlan: "standard", requiredCredits: 10 };

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const db = new MemoryFirestore();
  db.seed(project, { createdBy: "owner", profile: { company: "Acme", sourceUrl: "https://acme.example" } });
  db.seed(`${project}/campaigns/current`, campaign);
  db.seed(`${project}/campaignApprovals/current`, { approvedBy: "owner", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
  await prepareFulfillment(db.asFirestore(), "owner", projectId, campaign, quote, details, "launch");
  db.seed(orderPath, { ...db.read(orderPath), status: "paid", billingStatus: "paid", stripeLivemode: true });
  db.seed(jobPath, { ...db.read(jobPath), status: "queued" });
  const submit = vi.fn(async (_input: ProviderSubmissionInput) => ({ externalId: "release_123", status: "submitted" as const }));
  const provider: DistributionProvider = {
    id: "prnow", assertCanSubmit: vi.fn(), submit,
    quote: vi.fn(), preflight: vi.fn(), validate: vi.fn(),
    status: vi.fn(async (externalId) => ({ externalId, status: "processing" as const })),
    evidence: vi.fn(async () => []), cancel: vi.fn(), refund: vi.fn(),
  };
  const resolve = vi.fn(() => provider);
  const email = { send: vi.fn() };
  const run = () => runQueuedFulfillmentJobs(db.asFirestore(), resolve, email);
  return { db, provider, submit, resolve, run };
}

afterEach(() => vi.useRealTimers());

describe("durable supplier dispatch", () => {
  it("rejects a stale approved campaign when an order is prepared after restoration", async () => {
    const db = new MemoryFirestore();
    db.seed(project, { createdBy: "owner", profile: { company: "Acme", sourceUrl: "https://acme.example" } });
    db.seed(`${project}/campaigns/current`, { ...campaign, version: 2, status: "draft" });
    db.seed(`${project}/campaignApprovals/current`, { approvedBy: "owner", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
    await expect(prepareFulfillment(db.asFirestore(), "owner", projectId, campaign, quote, details, "launch")).rejects.toThrow(/campaign changed/);
    expect(db.rows.has(orderPath)).toBe(false);
    expect(db.rows.has(jobPath)).toBe(false);
  });
  it("persists the dispatch fence before the actual supplier call and submits frozen company/plan details", async () => {
    const { db, submit, resolve, run } = await fixture();
    db.seed(project, { ...db.read(project), profile: { company: "Edited after checkout", sourceUrl: "https://other.example" } });
    submit.mockImplementation(async (input) => {
      expect(db.read(jobPath).dispatchStartedAt).toBe(now);
      expect(db.read(orderPath).providerSubmissionStartedAt).toBe(now);
      expect(input).toMatchObject({ company: "Acme", website: "https://acme.example", providerPlan: "standard", packageId: "launch" });
      return { externalId: "release_123", status: "submitted" };
    });
    await run();
    expect(resolve).toHaveBeenCalledWith("prnow");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(db.read(orderPath)).toMatchObject({ externalId: "release_123", status: "submitted", providerPlan: "standard", requiredCredits: 10 });
    expect(db.read(jobPath).status).toBe("complete");
    await run();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("allows only one of two concurrent workers to submit", async () => {
    const { db, submit, run } = await fixture();
    await Promise.all([run(), run()]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(db.read(jobPath).status).toBe("complete");
  });

  it.each([new Error("commit response lost"), new ProviderSubmissionNeedsReviewError("connection reset")])("requires reconciliation for any post-dispatch error", async (error) => {
    const { db, submit, run } = await fixture();
    submit.mockRejectedValue(error);
    await run();
    expect(db.read(jobPath)).toMatchObject({ status: "failed", needsHumanReview: true, dispatchStartedAt: now });
    expect(db.read(orderPath).providerSubmissionUncertain).toBe(true);
    expect(() => assertJobCanRetry(db.read(jobPath) as JobRun)).toThrow(/reconciliation/);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await run();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("recovers a crash after supplier acceptance without submitting again", async () => {
    const { db, submit, run } = await fixture();
    submit.mockImplementation(async () => {
      // Supplier accepted; now both completion and error-recording DB writes fail.
      db.beforeCommit = () => { throw new Error("database unavailable"); };
      return { externalId: "release_123", status: "submitted" };
    });
    await expect(run()).rejects.toThrow(/database unavailable/);
    expect(db.read(jobPath)).toMatchObject({ status: "running", dispatchStartedAt: now });
    db.beforeCommit = undefined;
    vi.advanceTimersByTime(11 * 60_000);
    await run();
    expect(db.read(jobPath)).toMatchObject({ status: "failed", needsHumanReview: true });
    expect(db.read(orderPath).providerSubmissionUncertain).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("requires reconciliation if the dispatch fence committed but its acknowledgement was lost", async () => {
    const { db, submit, run } = await fixture();
    db.afterCommit = (writes) => {
      if (writes.some((write) => write.data.dispatchStartedAt)) {
        db.afterCommit = undefined;
        throw new Error("commit acknowledgement lost");
      }
    };
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath)).toMatchObject({ status: "failed", needsHumanReview: true });
    expect(db.read(orderPath).providerSubmissionUncertain).toBe(true);
    await run();
    expect(submit).not.toHaveBeenCalled();
  });

  it("recovers a crash before the durable dispatch fence and safely processes it", async () => {
    const { db, submit, run } = await fixture();
    db.seed(jobPath, { ...db.read(jobPath), status: "running", runToken: "lost", leaseExpiresAt: "2026-09-10T23:59:00Z" });
    await run();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(db.read(jobPath).status).toBe("complete");
  });

  it("fails closed for a legacy running job with no known dispatch protocol", async () => {
    const { db, submit, run } = await fixture();
    const legacy = db.read(jobPath);
    delete legacy.dispatchProtocolVersion;
    db.seed(jobPath, { ...legacy, status: "running", leaseExpiresAt: "2026-09-10T23:59:00Z" });
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath)).toMatchObject({ status: "failed", needsHumanReview: true });
  });

  it("does not mark a pre-dispatch kill-switch failure as an uncertain submission", async () => {
    const { db, provider, submit, run } = await fixture();
    vi.mocked(provider.assertCanSubmit).mockImplementation(() => { throw new Error("Submission disabled"); });
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath)).toMatchObject({ status: "scheduled" });
    expect(db.read(jobPath).dispatchStartedAt).toBeUndefined();
    expect(db.read(orderPath).providerSubmissionStartedAt).toBeUndefined();
  });

  it("rechecks order eligibility inside the dispatch transaction", async () => {
    const { db, provider, submit, run } = await fixture();
    vi.mocked(provider.assertCanSubmit).mockImplementation(() => {
      db.seed(orderPath, { ...db.read(orderPath), status: "refunded", billingStatus: "refunded" });
    });
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath).dispatchStartedAt).toBeUndefined();
  });

  it("refuses a different provider returned by the resolver", async () => {
    const { db, resolve, provider, submit, run } = await fixture();
    resolve.mockReturnValue({ ...provider, id: "sandbox" });
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath).lastError).toMatch(/does not match/);
  });

  it("will not claim a blindly requeued dispatched or human-review job", async () => {
    const { db, submit, run } = await fixture();
    db.seed(jobPath, { ...db.read(jobPath), dispatchStartedAt: now });
    await run();
    expect(submit).not.toHaveBeenCalled();
    db.seed(jobPath, { ...db.read(jobPath), needsHumanReview: true });
    await run();
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires manual handling for old orders without a frozen submission payload", async () => {
    const { db, submit, run } = await fixture();
    const legacy = db.read(orderPath);
    delete legacy.submissionInput;
    db.seed(orderPath, legacy);
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath).lastError).toMatch(/frozen submission/);
  });

  it.each([false, undefined])("does not submit a live provider order without a verified live payment (%s)", async (livemode) => {
    const { db, submit, run } = await fixture();
    const order = db.read(orderPath);
    if (livemode === undefined) delete order.stripeLivemode;
    else order.stripeLivemode = livemode;
    db.seed(orderPath, order);
    await run();
    expect(submit).not.toHaveBeenCalled();
    expect(db.read(jobPath).dispatchStartedAt).toBeUndefined();
    expect(db.read(jobPath).lastError).toMatch(/live-mode payment/);
  });

  it("does not roll back a full refund when an older partial-refund event arrives", async () => {
    const { db, submit, run } = await fixture();
    db.seed(orderPath, { ...db.read(orderPath), stripePaymentIntentId: "pi_123", amountTotal: 9900 });
    const refund = { paymentIntentId: "pi_123", amount: 9900, currency: "usd", livemode: true };
    await markPaymentIntentRefunded(db.asFirestore(), { ...refund, eventId: "evt_full", amountRefunded: 9900, fullyRefunded: true });
    await markPaymentIntentRefunded(db.asFirestore(), { ...refund, eventId: "evt_partial", amountRefunded: 2000, fullyRefunded: false });
    expect(db.read(orderPath)).toMatchObject({ refundedAmountCents: 9900, billingStatus: "refunded", status: "refunded" });
    expect(db.read(jobPath)).toMatchObject({ status: "complete" });
    expect(db.read("stripeEvents/evt_partial").amountRefunded).toBe(2000);
    await run();
    expect(submit).not.toHaveBeenCalled();
  });
});
