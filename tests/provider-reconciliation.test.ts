import { describe, expect, it, vi } from "vitest";
import { prepareFulfillment, runQueuedFulfillmentJobs } from "../lib/fulfillment";
import { campaignDigest } from "../lib/campaign-approval";
import { providerReleaseBindingPath, type DistributionProvider } from "../lib/provider";
import { reconciliationSchema, reconcileProviderSubmission, ReconciliationConflict, type ReconciliationInput } from "../lib/provider-reconciliation";
import type { CampaignDraft } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const projectId = "a".repeat(24);
const workspaceId = "personal_owner";
const projectPath = `workspaces/${workspaceId}/projects/${projectId}`;
const orderPath = `${projectPath}/orders/current`;
const jobPath = `${projectPath}/jobs/provider_submission_current`;
const now = "2026-09-11T00:00:00.000Z";
const externalId = "release_123";
const details = { country: "United States", city: "Boston", categories: ["Technology"], contactName: "Founder", contactEmail: "press@example.com" };
const campaign: CampaignDraft = {
  version: 1, status: "approved", model: "test", generatedAt: now, updatedAt: now,
  assets: [{ id: "release", type: "press_release", title: "Acme Introduces A New Product Today", content: "word ".repeat(300), claimIds: ["approved"], status: "approved" }],
};
const quote = { provider: "prnow", sandbox: false, nonBillable: false, currency: "usd", providerCostCents: 2175, providerPlan: "standard", requiredCredits: 10 };

async function fixture() {
  const db = new MemoryFirestore();
  db.seed(projectPath, { createdBy: "owner", profile: { company: "Acme", sourceUrl: "https://acme.example" } });
  db.seed(`${projectPath}/campaigns/current`, campaign);
  db.seed(`${projectPath}/campaignApprovals/current`, { approvedBy: "owner", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
  await prepareFulfillment(db.asFirestore(), "owner", projectId, campaign, quote, details, "launch");
  db.seed(orderPath, { ...db.read(orderPath), status: "paid", billingStatus: "paid", stripeLivemode: true, providerSubmissionStartedAt: now, providerSubmissionUncertain: true });
  db.seed(jobPath, { ...db.read(jobPath), status: "failed", attempts: 1, needsHumanReview: true, dispatchStartedAt: now, lastError: "uncertain" });
  const status = vi.fn(async (id: string) => ({ externalId: id, status: "submitted" as const, statusReason: "seen" }));
  const assertCanSubmit = vi.fn();
  const provider: DistributionProvider = {
    id: "prnow", assertCanSubmit, submit: vi.fn(), quote: vi.fn(), preflight: vi.fn(), validate: vi.fn(), status,
    evidence: vi.fn(async () => []), cancel: vi.fn(), refund: vi.fn(),
  };
  const resolve = vi.fn(() => provider);
  const base = (action: ReconciliationInput["action"], requestId = "11111111-1111-4111-8111-111111111111"): ReconciliationInput => ({
    workspaceId, projectId, requestId, expectedAttempt: 1, expectedRevision: 0, action,
    ...(action === "attach_release" ? { externalId } : {}), evidenceReference: "supplier dashboard case 123", note: "I confirmed the company, release, package, and supplier record match.", confirmed: true,
  });
  return { db, provider, status, assertCanSubmit, resolve, base };
}

describe("provider submission reconciliation", () => {
  it("attaches an existing release without submitting and creates verification work", async () => {
    const f = await fixture();
    const result = await reconcileProviderSubmission(f.db.asFirestore(), "admin", f.base("attach_release"), f.resolve);
    expect(result).toMatchObject({ action: "attach_release", status: "submitted", revision: 1 });
    expect(f.status).toHaveBeenCalledWith(externalId);
    expect(f.provider.submit).not.toHaveBeenCalled();
    expect(f.db.read(orderPath)).toMatchObject({ externalId, status: "submitted", billingStatus: "paid", providerSubmissionUncertain: false });
    expect(f.db.read(jobPath)).toMatchObject({ status: "complete", needsHumanReview: false });
    expect(f.db.read(`${projectPath}/jobs/placement_verification_current`)).toMatchObject({ status: "queued" });
  });

  it("preserves refunded billing when attaching a release that was already submitted", async () => {
    const f = await fixture();
    f.db.seed(orderPath, { ...f.db.read(orderPath), status: "submitted", billingStatus: "refunded", refundedAmountCents: 9900 });
    const result = await reconcileProviderSubmission(f.db.asFirestore(), "admin", f.base("attach_release"), f.resolve);
    expect(result).toMatchObject({ action: "attach_release", status: "submitted" });
    expect(f.db.read(orderPath)).toMatchObject({ status: "submitted", billingStatus: "refunded", refundedAmountCents: 9900, externalId });
  });

  it("is idempotent for a duplicate request and rejects reuse with changed details", async () => {
    const f = await fixture();
    const input = f.base("attach_release");
    const first = await reconcileProviderSubmission(f.db.asFirestore(), "admin", input, f.resolve);
    await expect(reconcileProviderSubmission(f.db.asFirestore(), "admin", input, f.resolve)).resolves.toEqual(first);
    expect(f.status).toHaveBeenCalledTimes(1);
    await expect(reconcileProviderSubmission(f.db.asFirestore(), "admin", { ...input, note: `${input.note} Changed.` }, f.resolve)).rejects.toThrow(ReconciliationConflict);
  });

  it.each([
    ["stale attempt", { expectedAttempt: 2 }], ["stale revision", { expectedRevision: 1 }],
  ])("rejects %s", async (_label, change) => {
    const f = await fixture();
    await expect(reconcileProviderSubmission(f.db.asFirestore(), "admin", { ...f.base("attach_release"), ...change }, f.resolve)).rejects.toThrow(/changed|Refresh/);
  });

  it("rejects live jobs, provider mismatches, and releases bound to another order", async () => {
    const live = await fixture();
    live.db.seed(jobPath, { ...live.db.read(jobPath), status: "running" });
    await expect(reconcileProviderSubmission(live.db.asFirestore(), "admin", live.base("attach_release"), live.resolve)).rejects.toThrow(ReconciliationConflict);
    const mismatch = await fixture();
    mismatch.resolve.mockReturnValue({ ...mismatch.provider, id: "other" });
    await expect(reconcileProviderSubmission(mismatch.db.asFirestore(), "admin", mismatch.base("attach_release"), mismatch.resolve)).rejects.toThrow(/match/);
    const bound = await fixture();
    bound.db.seed(providerReleaseBindingPath("prnow", externalId), { provider: "prnow", externalId, orderPath: "workspaces/personal_other/projects/other/orders/current" });
    await expect(reconcileProviderSubmission(bound.db.asFirestore(), "admin", bound.base("attach_release"), bound.resolve)).rejects.toThrow(/another order/);
  });

  it("requires a confirmed supplier evidence attestation before authorizing a retry", async () => {
    const f = await fixture();
    const input = f.base("authorize_retry");
    const approval = f.db.read(`${projectPath}/campaignApprovals/current`);
    f.db.seed(`${projectPath}/campaignApprovals/current`, { ...approval, campaignDigest: "0".repeat(64) });
    await expect(reconcileProviderSubmission(f.db.asFirestore(), "admin", input, f.resolve)).rejects.toThrow(/approval|matches|attestation/i);
    expect(f.assertCanSubmit).not.toHaveBeenCalled();
  });

  it("authorizes a retry only for a paid, unrefunded order with frozen input", async () => {
    const f = await fixture();
    const result = await reconcileProviderSubmission(f.db.asFirestore(), "admin", f.base("authorize_retry"), f.resolve);
    expect(result).toMatchObject({ action: "authorize_retry", status: "queued", revision: 1 });
    expect(f.status).not.toHaveBeenCalled();
    expect(f.assertCanSubmit).toHaveBeenCalledTimes(1);
    expect(f.db.read(orderPath)).toMatchObject({ status: "paid", billingStatus: "paid", providerSubmissionUncertain: false });
    expect(f.db.read(orderPath).providerSubmissionStartedAt).toBeUndefined();
    expect(f.db.read(jobPath)).toMatchObject({ status: "queued", needsHumanReview: false, attempts: 1 });
  });

  it("rejects retry for missing frozen payload and canceled, refunded, or partially refunded orders", async () => {
    for (const change of [
      { removeInput: true }, { status: "canceled" }, { status: "refunded", billingStatus: "refunded", refundedAmountCents: 9900 },
      { billingStatus: "partially_refunded", refundedAmountCents: 2000 },
    ]) {
      const f = await fixture();
      const order = f.db.read(orderPath);
      if (change.removeInput) delete order.submissionInput;
      else Object.assign(order, change);
      f.db.seed(orderPath, order);
      await expect(reconcileProviderSubmission(f.db.asFirestore(), "admin", f.base("authorize_retry"), f.resolve)).rejects.toThrow(ReconciliationConflict);
      expect(f.assertCanSubmit).not.toHaveBeenCalled();
    }
  });

  it("requires explicit confirmation and an evidence record, not just a retry action", async () => {
    const f = await fixture();
    expect(reconciliationSchema.safeParse({ ...f.base("authorize_retry"), confirmed: false }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...f.base("authorize_retry"), evidenceReference: "" }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...f.base("attach_release"), externalId: "" }).success).toBe(false);
  });

  it("allows only one of two simultaneous administrator decisions", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      reconcileProviderSubmission(f.db.asFirestore(), "admin-one", f.base("attach_release"), f.resolve),
      reconcileProviderSubmission(f.db.asFirestore(), "admin-two", f.base("authorize_retry", "22222222-2222-4222-8222-222222222222"), f.resolve),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.db.read(orderPath).reconciliationRevision).toBe(1);
  });

  it("completes exactly one freshly authorized attempt using unchanged release content", async () => {
    const f = await fixture();
    const originalInput = f.db.read(orderPath).submissionInput;
    vi.mocked(f.provider.submit).mockResolvedValue({ externalId: "release_456", status: "submitted" });
    await reconcileProviderSubmission(f.db.asFirestore(), "admin", f.base("authorize_retry"), f.resolve);
    await runQueuedFulfillmentJobs(f.db.asFirestore(), f.resolve, { send: vi.fn() });
    expect(f.provider.submit).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(f.provider.submit).mock.calls[0][0];
    expect(submitted).toEqual({ ...originalInput, idempotencyKey: expect.any(String) });
    expect(submitted.idempotencyKey).not.toBe(originalInput.idempotencyKey);
    expect(f.db.read(orderPath).externalId).toBe("release_456");
    expect(f.db.read(jobPath).attempts).toBe(2);
  });
});
