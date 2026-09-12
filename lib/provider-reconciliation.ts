import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { assertCampaignAttestation, campaignDigest, type CampaignApprovalAttestation } from "./campaign-approval";
import type { CampaignDraft, JobRun, ProviderOrder } from "./types";
import type { DistributionProviderResolver } from "./fulfillment";
import { providerReleaseBindingPath } from "./provider";

export const reconciliationSchema = z.object({
  workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  projectId: z.string().regex(/^[a-f0-9]{24}$/),
  requestId: z.string().uuid(),
  expectedAttempt: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  action: z.enum(["attach_release", "authorize_retry"]),
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),
  evidenceReference: z.string().trim().min(5).max(500),
  note: z.string().trim().min(20).max(2_000),
  confirmed: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.action === "attach_release" && !value.externalId) ctx.addIssue({ code: "custom", path: ["externalId"], message: "Enter the supplier release identifier." });
  if (value.action === "authorize_retry" && value.externalId) ctx.addIssue({ code: "custom", path: ["externalId"], message: "An existing release must be linked, not retried." });
});

export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
export class ReconciliationConflict extends Error {}

function assertReviewable(order: ProviderOrder, job: JobRun, input: ReconciliationInput) {
  if (job.type !== "provider_submission" || job.status !== "failed") throw new ReconciliationConflict("Only a stopped, failed supplier submission can be reconciled. Recover an expired running job first.");
  if (!job.needsHumanReview && !job.dispatchStartedAt && !order.providerSubmissionUncertain && !order.providerSubmissionStartedAt) throw new ReconciliationConflict("This job is not awaiting supplier reconciliation.");
  if (job.attempts !== input.expectedAttempt || (order.reconciliationRevision ?? 0) !== input.expectedRevision) throw new ReconciliationConflict("This order changed. Refresh the queue before reconciling it.");
  if (order.externalId) throw new ReconciliationConflict("This order already has a supplier release. Use status polling or supplier cancellation.");
}

export async function reconcileProviderSubmission(db: Firestore, actorId: string, rawInput: ReconciliationInput, resolveProvider: DistributionProviderResolver) {
  const input = reconciliationSchema.parse(rawInput);
  const project = db.doc(`workspaces/${input.workspaceId}/projects/${input.projectId}`);
  const orderRef = project.collection("orders").doc("current");
  const jobRef = project.collection("jobs").doc("provider_submission_current");
  const receiptRef = project.collection("adminOperations").doc(`reconciliation_${input.requestId}`);
  const requestDigest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const [orderSnapshot, jobSnapshot, receiptSnapshot] = await Promise.all([orderRef.get(), jobRef.get(), receiptRef.get()]);
  if (receiptSnapshot.exists) {
    if (receiptSnapshot.data()?.requestDigest !== requestDigest) throw new ReconciliationConflict("This request identifier was already used for different reconciliation details.");
    return receiptSnapshot.data()!.result as { action: string; status: string; revision: number };
  }
  if (!orderSnapshot.exists || !jobSnapshot.exists) throw new ReconciliationConflict("The order or supplier submission job was not found.");
  const order = orderSnapshot.data() as ProviderOrder;
  const job = jobSnapshot.data() as JobRun;
  assertReviewable(order, job, input);
  if (!order.provider) throw new ReconciliationConflict("The order has no known supplier identity.");

  // A status lookup proves the ID exists, not that it belongs to this customer.
  // The operator must separately attest the company, release, and package match.
  const provider = resolveProvider(order.provider);
  if (provider.id !== order.provider) throw new ReconciliationConflict("The supplier does not match this order.");
  const observed = input.action === "attach_release" ? await provider.status(input.externalId!) : null;
  if (observed && observed.externalId !== input.externalId) throw new ReconciliationConflict("The supplier returned a different release identifier.");
  const bindingRef = observed ? db.doc(providerReleaseBindingPath(order.provider, observed.externalId)) : null;

  return db.runTransaction(async (transaction) => {
    const [freshOrderSnapshot, freshJobSnapshot, receipt, binding, projectSnapshot, campaignSnapshot, approvalSnapshot] = await Promise.all([
      transaction.get(orderRef), transaction.get(jobRef), transaction.get(receiptRef),
      bindingRef ? transaction.get(bindingRef) : Promise.resolve(null),
      transaction.get(project), transaction.get(project.collection("campaigns").doc("current")),
      transaction.get(project.collection("campaignApprovals").doc("current")),
    ]);
    if (receipt.exists) {
      if (receipt.data()?.requestDigest !== requestDigest) throw new ReconciliationConflict("This request identifier was already used for different reconciliation details.");
      return receipt.data()!.result as { action: string; status: string; revision: number };
    }
    if (!freshOrderSnapshot.exists || !freshJobSnapshot.exists || !projectSnapshot.exists) throw new ReconciliationConflict("The order, job, or project no longer exists.");
    const current = freshOrderSnapshot.data() as ProviderOrder;
    const currentJob = freshJobSnapshot.data() as JobRun;
    assertReviewable(current, currentJob, input);
    if (current.provider !== order.provider || current.campaignDigest !== order.campaignDigest || currentJob.dispatchStartedAt !== job.dispatchStartedAt) throw new ReconciliationConflict("The submission changed while it was being checked. Refresh the queue.");
    if (binding?.exists && binding.data()?.orderPath !== orderRef.path) throw new ReconciliationConflict("This supplier release is already bound to another order.");

    const now = new Date().toISOString();
    const revision = (current.reconciliationRevision ?? 0) + 1;
    const result = { action: input.action, status: observed?.status ?? "queued", revision };
    const audit = {
      type: "provider_reconciliation", status: "complete", actorId, requestDigest,
      action: input.action, evidenceReference: input.evidenceReference, note: input.note,
      provider: current.provider, campaignDigest: current.campaignDigest,
      priorAttempt: currentJob.attempts, priorDispatchStartedAt: currentJob.dispatchStartedAt ?? null,
      priorIdempotencyKey: currentJob.idempotencyKey, externalId: observed?.externalId ?? null,
      result, createdAt: now, createdAtServer: FieldValue.serverTimestamp(),
    };
    if (observed) {
      transaction.set(bindingRef!, { provider: current.provider, externalId: observed.externalId, orderPath: orderRef.path, boundAt: now });
      transaction.update(orderRef, {
        status: observed.status, externalId: observed.externalId,
        providerStatusReason: observed.statusReason ?? null, providerPackageOutcomes: observed.packageOutcomes ?? [],
        providerSubmissionUncertain: false, reconciliationRevision: revision, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
      });
      transaction.update(jobRef, {
        status: "complete", needsHumanReview: false, lastError: FieldValue.delete(),
        runToken: FieldValue.delete(), leaseExpiresAt: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: now,
      });
      const verification = project.collection("jobs").doc("placement_verification_current");
      transaction.set(verification, {
        id: verification.id, type: "placement_verification", status: "queued", attempts: 0, failureCount: 0,
        idempotencyKey: createHash("sha256").update(`verify:${observed.externalId}`).digest("hex"),
        createdAt: now, updatedAt: now, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp(),
      });
      transaction.update(project, { lifecycleStatus: "fulfillment", campaignStatus: "fulfillment", updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
    } else {
      if (current.status !== "paid" || current.billingStatus !== "paid" || (current.refundedAmountCents ?? 0) > 0) throw new ReconciliationConflict("Retry requires an unrefunded, paid order. Refunded orders cannot be resubmitted.");
      if ((!current.sandbox || !current.nonBillable) && current.stripeLivemode !== true) throw new ReconciliationConflict("A verified live payment is required for a live supplier retry.");
      if ((current.sandbox || current.nonBillable) && current.stripeLivemode !== false) throw new ReconciliationConflict("Sandbox retry requires a verified test payment.");
      const campaign = campaignSnapshot.data() as CampaignDraft | undefined;
      if (!campaign || campaignDigest(campaign) !== current.campaignDigest) throw new ReconciliationConflict("The campaign changed. Do not retry this order with different content.");
      assertCampaignAttestation(campaign, approvalSnapshot.data() as CampaignApprovalAttestation | undefined, String(projectSnapshot.data()?.createdBy));
      if (!current.submissionInput || current.submissionInput.idempotencyKey !== currentJob.idempotencyKey) throw new ReconciliationConflict("This legacy order lacks frozen submission details and needs manual fulfillment or a refund.");
      const idempotencyKey = createHash("sha256").update(`${currentJob.idempotencyKey}:${revision}:${input.requestId}`).digest("hex");
      const submissionInput = { ...current.submissionInput, idempotencyKey };
      provider.assertCanSubmit(submissionInput);
      transaction.update(orderRef, {
        submissionInput, providerSubmissionStartedAt: FieldValue.delete(), providerSubmissionUncertain: false,
        reconciliationRevision: revision, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
      });
      transaction.update(jobRef, {
        status: "queued", needsHumanReview: false, dispatchStartedAt: FieldValue.delete(), dispatchProtocolVersion: 1,
        idempotencyKey, failureCount: 0, lastError: FieldValue.delete(), runToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(receiptRef, audit);
    transaction.create(project.collection("auditLogs").doc(), { ...audit, action: `provider.reconciled.${input.action}` });
    return result;
  });
}
