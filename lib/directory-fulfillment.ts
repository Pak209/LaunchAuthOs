import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { assertCampaignAttestation, campaignDigest, type CampaignApprovalAttestation } from "./campaign-approval";
import { parsePublicHttpUrl } from "./url-security";
import type { CampaignDraft, DirectorySubmission, DirectorySubmissionStatus, ProviderOrder } from "./types";

// The operator may update only tasks provisioned by prepareFulfillment. This is
// deliberately not a general-purpose URL submission service or provider adapter.
const directoryCatalog = {
  betalist: { directory: "BetaList", mode: "editorial" },
  uneed: { directory: "Uneed", mode: "assisted" },
  sourceforge: { directory: "SourceForge", mode: "manual" },
} as const;

const evidenceUrl = z.string().trim().min(1).max(2_048).transform((value, context) => {
  try {
    const url = parsePublicHttpUrl(value);
    // A public-looking URL is evidence supplied by an operator, not a network
    // verification. No DNS request or HTTP request is performed here.
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) throw new Error("Use a public website URL.");
    return url.toString();
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Use a public http(s) URL." });
    return z.NEVER;
  }
});

export const directoryOperationSchema = z.object({
  workspaceId: z.string().regex(/^personal_[A-Za-z0-9_-]{1,128}$/),
  projectId: z.string().regex(/^[a-f0-9]{24}$/),
  directoryId: z.enum(["betalist", "uneed", "sourceforge"]),
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  targetStatus: z.enum(["queued", "needs_customer", "submitted", "accepted", "published", "rejected", "failed", "removed"]),
  evidenceUrl: evidenceUrl.optional(),
  observedAt: z.iso.datetime({ offset: true }),
  requiredActions: z.array(z.string().trim().min(3).max(300)).max(12).optional(),
  note: z.string().trim().min(20).max(2_000),
  confirmed: z.literal(true),
}).strict().superRefine((input, context) => {
  if ((input.targetStatus === "submitted" || input.targetStatus === "published") && !input.evidenceUrl) {
    context.addIssue({ code: "custom", path: ["evidenceUrl"], message: input.targetStatus === "published" ? "Provide the public listing URL you matched to this project." : "Provide the public submission or directory evidence URL." });
  }
  if (input.targetStatus === "needs_customer" && !input.requiredActions?.length) {
    context.addIssue({ code: "custom", path: ["requiredActions"], message: "Explain the actions the customer must complete." });
  }
  if (input.targetStatus !== "needs_customer" && input.requiredActions?.length) {
    context.addIssue({ code: "custom", path: ["requiredActions"], message: "Customer actions may only accompany a needs-customer status." });
  }
});

export type DirectoryOperationInput = z.infer<typeof directoryOperationSchema>;
export type DirectoryOperationResult = { directoryId: string; status: DirectoryOperationInput["targetStatus"]; revision: number; recordedAt: string };
export class DirectoryOperationConflict extends Error {}

const transitions: Record<DirectorySubmissionStatus, readonly DirectoryOperationInput["targetStatus"][]> = {
  needs_customer: ["queued", "needs_customer", "failed"],
  ready_for_human: ["queued", "needs_customer", "submitted", "failed"],
  queued: ["needs_customer", "submitted", "failed"],
  submitted: ["accepted", "published", "rejected", "failed"],
  accepted: ["published", "rejected", "failed"],
  published: ["removed"],
  rejected: ["queued", "needs_customer"],
  failed: ["queued", "needs_customer"],
  removed: ["queued", "needs_customer"],
};

function assertOrderBinding(directory: DirectorySubmission, order: ProviderOrder) {
  if (order.id !== "current" || !order.campaignDigest || !Number.isSafeInteger(order.campaignVersion)) throw new DirectoryOperationConflict("The directory task has no valid current order.");
  const hasBinding = directory.orderId !== undefined || directory.campaignDigest !== undefined || directory.campaignVersion !== undefined;
  if (hasBinding) {
    if (directory.orderId !== "current" || directory.campaignDigest !== order.campaignDigest || directory.campaignVersion !== order.campaignVersion) throw new DirectoryOperationConflict("This directory task belongs to a different order or campaign.");
  } else if (!directory.createdAt || directory.createdAt !== order.createdAt) {
    throw new DirectoryOperationConflict("This legacy directory task cannot be matched to the current order.");
  }
}

function assertPaidWorkAllowed(order: ProviderOrder, campaign: CampaignDraft | undefined, approval: CampaignApprovalAttestation | undefined, ownerId: string) {
  if (!["paid", "submitted", "processing", "published"].includes(order.status)
    || order.billingStatus !== "paid" || (order.refundedAmountCents ?? 0) !== 0) {
    throw new DirectoryOperationConflict("Queueing or recording a new submission requires an unrefunded, paid order.");
  }
  const verifiedLivePayment = order.sandbox === false && order.nonBillable === false && order.stripeLivemode === true;
  const verifiedTestPayment = order.sandbox === true && order.nonBillable === true && order.stripeLivemode === false;
  if (!verifiedLivePayment && !verifiedTestPayment) throw new DirectoryOperationConflict("A verified payment matching this order's live or sandbox mode is required.");
  if (!campaign || campaign.version !== order.campaignVersion || campaignDigest(campaign) !== order.campaignDigest) throw new DirectoryOperationConflict("The campaign changed. Do not submit directory copy from a different approval.");
  assertCampaignAttestation(campaign, approval, ownerId);
}

/** Internal-admin caller only. Records a human's evidence; never submits or verifies externally. */
export async function recordDirectoryOperation(db: Firestore, actorId: string, rawInput: DirectoryOperationInput): Promise<DirectoryOperationResult> {
  const input = directoryOperationSchema.parse(rawInput);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(actorId)) throw new DirectoryOperationConflict("The operator identity is invalid.");
  const project = db.doc(`workspaces/${input.workspaceId}/projects/${input.projectId}`);
  const orderRef = project.collection("orders").doc("current");
  const directoryRef = project.collection("directorySubmissions").doc(input.directoryId);
  const receiptRef = project.collection("adminOperations").doc(`directory_${input.requestId}`);
  const requestDigest = createHash("sha256").update(JSON.stringify({ actorId, input })).digest("hex");

  return db.runTransaction(async (transaction) => {
    const [projectSnapshot, orderSnapshot, directorySnapshot, receipt, campaignSnapshot, approvalSnapshot] = await Promise.all([
      transaction.get(project), transaction.get(orderRef), transaction.get(directoryRef), transaction.get(receiptRef),
      transaction.get(project.collection("campaigns").doc("current")), transaction.get(project.collection("campaignApprovals").doc("current")),
    ]);
    if (!projectSnapshot.exists || !orderSnapshot.exists || !directorySnapshot.exists) throw new DirectoryOperationConflict("The project, order, or existing directory task was not found.");
    const ownerId = projectSnapshot.data()?.createdBy;
    if (typeof ownerId !== "string" || input.workspaceId !== `personal_${ownerId}`) throw new DirectoryOperationConflict("The project does not match this customer workspace.");
    if (receipt.exists) {
      if (receipt.data()?.requestDigest !== requestDigest) throw new DirectoryOperationConflict("This request identifier was already used with different directory details or another operator.");
      return receipt.data()!.result as DirectoryOperationResult;
    }
    const directory = directorySnapshot.data() as DirectorySubmission;
    const order = orderSnapshot.data() as ProviderOrder;
    const template = directoryCatalog[input.directoryId];
    if (directory.id !== input.directoryId || directory.directory !== template.directory || directory.mode !== template.mode) throw new DirectoryOperationConflict("The directory task does not match a supported provisioned directory.");
    assertOrderBinding(directory, order);
    if ((directory.revision ?? 0) !== input.expectedRevision) throw new DirectoryOperationConflict("This directory task changed. Refresh before recording another decision.");
    if (!transitions[directory.status]?.includes(input.targetStatus)) throw new DirectoryOperationConflict(`Cannot change a directory task from ${directory.status} to ${input.targetStatus}.`);
    if (input.targetStatus === "queued" || input.targetStatus === "submitted") {
      assertPaidWorkAllowed(order, campaignSnapshot.data() as CampaignDraft | undefined, approvalSnapshot.data() as CampaignApprovalAttestation | undefined, ownerId);
    }
    if (input.targetStatus === "removed" && (!directory.publishedAt || !directory.listingUrl)) throw new DirectoryOperationConflict("Only a previously published listing with recorded evidence can be marked removed.");
    const now = new Date().toISOString();
    const observed = Date.parse(input.observedAt);
    if (observed > Date.parse(now) + 5 * 60_000 || observed < Date.parse(directory.createdAt) || (directory.lastObservedAt && observed < Date.parse(directory.lastObservedAt))) {
      throw new DirectoryOperationConflict("The observation time must follow this task's previous event and cannot be in the future.");
    }
    const revision = (directory.revision ?? 0) + 1;
    const result: DirectoryOperationResult = { directoryId: directory.id, status: input.targetStatus, revision, recordedAt: now };
    const timestampField: Partial<Record<DirectoryOperationInput["targetStatus"], string>> = {
      queued: "queuedAt", submitted: "submittedAt", accepted: "acceptedAt", published: "publishedAt", rejected: "rejectedAt", failed: "failedAt", removed: "removedAt",
    };
    const patch: Record<string, unknown> = {
      status: input.targetStatus, revision, orderId: "current", campaignVersion: order.campaignVersion, campaignDigest: order.campaignDigest,
      requiredActions: input.targetStatus === "needs_customer" ? input.requiredActions! : [],
      evidenceSource: "operator_recorded", lastObservedAt: input.observedAt,
      operatorRecordedAt: now,
      updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
    };
    const timestamp = timestampField[input.targetStatus];
    if (timestamp) patch[timestamp] = input.observedAt;
    if (input.targetStatus === "queued") {
      // A fresh attempt must not display an old rejected/removed listing as its
      // current outcome. The prior evidence remains in both immutable journals.
      for (const field of ["submissionUrl", "listingUrl", "submittedAt", "acceptedAt", "publishedAt", "rejectedAt", "failedAt", "removedAt"]) patch[field] = FieldValue.delete();
    }
    if (input.targetStatus === "submitted") {
      patch.submissionUrl = input.evidenceUrl!;
      patch.attempt = (directory.attempt ?? 0) + 1;
    }
    if (input.targetStatus === "published") patch.listingUrl = input.evidenceUrl!;
    const audit = {
      type: "directory_operation", action: `directory.${input.targetStatus}`, status: "complete",
      actorId, requestId: input.requestId, requestDigest, directoryId: directory.id, directory: directory.directory,
      workspaceId: input.workspaceId, projectId: input.projectId, orderId: "current", campaignDigest: order.campaignDigest,
      priorStatus: directory.status, priorRevision: directory.revision ?? 0, priorRequiredActions: directory.requiredActions,
      priorSubmissionUrl: directory.submissionUrl ?? null, priorListingUrl: directory.listingUrl ?? null,
      priorSubmittedAt: directory.submittedAt ?? null, priorPublishedAt: directory.publishedAt ?? null,
      priorRemovedAt: directory.removedAt ?? null, priorAttempt: directory.attempt ?? 0,
      evidenceSource: "operator_recorded", evidenceUrl: input.evidenceUrl ?? null, note: input.note, confirmed: true,
      requiredActions: input.requiredActions ?? [],
      observedAt: input.observedAt, result, createdAt: now, createdAtServer: FieldValue.serverTimestamp(),
    };
    transaction.update(directoryRef, patch);
    transaction.create(receiptRef, audit);
    transaction.create(project.collection("auditLogs").doc(), audit);
    // Internal notes and operator identity exist only in the admin-only journals,
    // never in the tenant-readable directory document.
    // No order/billing writes, worker job creation, network calls, or independently
    // verified/indexed placement records are part of this manual operation.
    return result;
  });
}
