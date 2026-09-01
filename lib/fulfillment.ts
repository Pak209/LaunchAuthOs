import { createHash, randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { CampaignDraft, DirectorySubmission, FulfillmentState, JobRun, Placement, ProviderOrder } from "./types";
import type { ProviderQuote } from "./provider";
import type { DistributionProvider } from "./provider";
import { isTransactionalEmailConfigured, type TransactionalEmailProvider } from "./email";
import { assertCampaignAttestation, campaignDigest, type CampaignApprovalAttestation } from "./campaign-approval";
import { verifyPublicPlacementUrl } from "./placement-verification";

type PaidPackageId = "launch" | "authority" | "authority_plus";

export type CheckoutBinding = {
  uid: string;
  projectId: string;
  sessionId: string;
  packageId: PaidPackageId;
  priceId: string;
  amountSubtotal: number;
  currency: string;
  checkoutAttempt: number;
};

export type PaidCheckout = CheckoutBinding & {
  eventId: string;
  paymentIntentId: string;
  amountTotal: number;
  customerEmail?: string;
};

export type RefundedPayment = {
  paymentIntentId: string;
  eventId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  fullyRefunded: boolean;
};

const JOB_LEASE_MS = 10 * 60 * 1_000;
const VERIFICATION_POLL_MS = 60 * 60 * 1_000;

export function isJobLeaseExpired(job: Pick<JobRun, "status" | "leaseExpiresAt">, now = Date.now()) {
  const expiresAt = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN;
  return job.status === "running" && (!Number.isFinite(expiresAt) || expiresAt <= now);
}

export function nextProviderOrderStatus(current: ProviderOrder["status"], observed: Awaited<ReturnType<DistributionProvider["status"]>>["status"]): ProviderOrder["status"] {
  if (current === "failed" || current === "canceled" || current === "refunded") return current;
  if (observed === "failed" || observed === "canceled") return observed;
  const rank: Partial<Record<ProviderOrder["status"], number>> = { submitted: 1, processing: 2, published: 3 };
  return (rank[current] ?? 0) > (rank[observed] ?? 0) ? current : observed;
}

function clearLease() {
  return { runToken: FieldValue.delete(), leaseExpiresAt: FieldValue.delete() };
}

async function claimQueuedJob(db: Firestore, jobRef: FirebaseFirestore.DocumentReference) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data()?.status !== "queued") return null;
    const data = snapshot.data() as JobRun;
    if (data.nextAttemptAt && Date.parse(data.nextAttemptAt) > Date.now()) return null;
    const attempts = Number(data.attempts ?? 0) + 1;
    const runToken = randomUUID();
    const now = new Date();
    transaction.update(jobRef, {
      status: "running",
      attempts,
      runToken,
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS).toISOString(),
      nextAttemptAt: FieldValue.delete(),
      updatedAt: now.toISOString(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    return { data, attempts, runToken };
  });
}

async function failClaimedJob(
  db: Firestore,
  jobRef: FirebaseFirestore.DocumentReference,
  runToken: string,
  error: unknown,
) {
  const lastError = (error instanceof Error ? error.message : "Background job failed.").slice(0, 500);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.data() as JobRun | undefined;
    if (!snapshot.exists || current?.status !== "running" || current.runToken !== runToken) return { processed: false };
    const failureCount = Number(current.failureCount ?? 0) + 1;
    const failed = failureCount >= 3;
    const now = Date.now();
    transaction.update(jobRef, {
      status: failed ? "failed" : "scheduled",
      failureCount,
      lastError,
      nextAttemptAt: failed ? FieldValue.delete() : new Date(now + Math.min(15 * 60_000, 30_000 * 2 ** (failureCount - 1))).toISOString(),
      ...clearLease(),
      updatedAt: new Date(now).toISOString(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    return { processed: true, status: failed ? "failed" as const : "queued" as const, error: lastError };
  });
}

async function recoverExpiredJobLeases(db: Firestore, limit = 25) {
  const snapshot = await db.collectionGroup("jobs").where("status", "==", "running").limit(limit).get();
  let recovered = 0;
  for (const job of snapshot.docs) {
    const didRecover = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(job.ref);
      const current = currentSnapshot.data() as JobRun | undefined;
      if (!currentSnapshot.exists || !current || !isJobLeaseExpired(current)) return false;
      transaction.update(job.ref, {
        status: "queued",
        nextAttemptAt: new Date().toISOString(),
        lastError: "Recovered after the previous worker lease expired.",
        ...clearLease(),
        updatedAt: new Date().toISOString(),
        updatedAtServer: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (didRecover) recovered += 1;
  }
  return recovered;
}

async function promoteDueScheduledJobs(db: Firestore, limit = 100) {
  const snapshot = await db.collectionGroup("jobs").where("status", "==", "scheduled").limit(limit).get();
  let promoted = 0;
  for (const job of snapshot.docs) {
    const didPromote = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(job.ref);
      const current = currentSnapshot.data() as JobRun | undefined;
      if (!currentSnapshot.exists || current?.status !== "scheduled") return false;
      if (current.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.now()) return false;
      transaction.update(job.ref, {
        status: "queued",
        nextAttemptAt: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
        updatedAtServer: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (didPromote) promoted += 1;
  }
  return promoted;
}

const directoryTemplates: Array<Pick<DirectorySubmission, "id" | "directory" | "mode" | "requiredActions">> = [
  { id: "betalist", directory: "BetaList", mode: "editorial", requiredActions: ["Confirm founder authorization", "Provide product screenshots", "Review editorial submission copy"] },
  { id: "uneed", directory: "Uneed", mode: "assisted", requiredActions: ["Confirm category", "Approve listing copy", "Provide logo URL"] },
  { id: "sourceforge", directory: "SourceForge", mode: "manual", requiredActions: ["Confirm open-source eligibility", "Connect an authorized account", "Complete any phone or account verification"] },
];

function paths(db: Firestore, uid: string, projectId: string) {
  const project = db.doc(`workspaces/personal_${uid}/projects/${projectId}`);
  return { project, order: project.collection("orders").doc("current"), directories: project.collection("directorySubmissions"), jobs: project.collection("jobs"), placements: project.collection("placements") };
}

export async function loadFulfillmentState(db: Firestore, uid: string, projectId: string): Promise<FulfillmentState> {
  const { order, directories, jobs, placements } = paths(db, uid, projectId);
  const [orderSnapshot, directorySnapshot, jobSnapshot, placementSnapshot] = await Promise.all([order.get(), directories.orderBy("createdAt", "asc").get(), jobs.orderBy("createdAt", "asc").get(), placements.limit(500).get()]);
  return {
    order: orderSnapshot.exists ? orderSnapshot.data() as ProviderOrder : null,
    directories: directorySnapshot.docs.map((snapshot) => snapshot.data() as DirectorySubmission),
    jobs: jobSnapshot.docs.map((snapshot) => snapshot.data() as JobRun),
    placements: placementSnapshot.docs.map((snapshot) => snapshot.data() as Placement),
  };
}

export async function prepareFulfillment(
  db: Firestore,
  uid: string,
  projectId: string,
  campaign: CampaignDraft,
  quote: ProviderQuote,
): Promise<FulfillmentState> {
  if (campaign.status !== "approved") throw new Error("Approve the complete campaign before preparing fulfillment.");
  const { project, order, directories, jobs } = paths(db, uid, projectId);
  const approval = project.collection("campaignApprovals").doc("current");
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [projectSnapshot, orderSnapshot, approvalSnapshot] = await Promise.all([
      transaction.get(project), transaction.get(order), transaction.get(approval),
    ]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== uid) throw new Error("The project was not found.");
    assertCampaignAttestation(campaign, approvalSnapshot.data() as CampaignApprovalAttestation | undefined, uid);
    if (orderSnapshot.exists) return;
    const providerOrder: ProviderOrder = {
      id: "current", provider: quote.provider, sandbox: quote.sandbox, nonBillable: quote.nonBillable,
      providerCostCents: quote.providerCostCents, currency: quote.currency,
      campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), checkoutAttempt: 0,
      status: "awaiting_payment", billingStatus: "awaiting_payment", createdAt: now, updatedAt: now,
    };
    transaction.create(order, { ...providerOrder, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp() });
    for (const template of directoryTemplates) {
      const submission: DirectorySubmission = { ...template, status: "needs_customer", createdAt: now, updatedAt: now };
      transaction.create(directories.doc(template.id), { ...submission, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp() });
    }
    const job: JobRun = {
      id: "provider_submission_current", type: "provider_submission", status: "blocked", attempts: 0,
      idempotencyKey: createHash("sha256").update(`${uid}:${projectId}:${campaign.version}:provider-submit`).digest("hex"),
      blockedReason: "payment_required", createdAt: now, updatedAt: now,
    };
    transaction.create(jobs.doc(job.id), { ...job, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp() });
    transaction.update(project, { lifecycleStatus: "awaiting_payment", campaignStatus: "awaiting_payment", updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
  });
  return loadFulfillmentState(db, uid, projectId);
}

export async function bindCheckoutSession(db: Firestore, input: CheckoutBinding) {
  const { project, order } = paths(db, input.uid, input.projectId);
  await db.runTransaction(async (transaction) => {
    const [projectSnapshot, orderSnapshot] = await Promise.all([transaction.get(project), transaction.get(order)]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== input.uid || !orderSnapshot.exists) {
      throw new Error("The checkout order could not be matched to a project.");
    }
    const current = orderSnapshot.data() as ProviderOrder;
    if (current.status !== "awaiting_payment") throw new Error("The order is no longer awaiting payment.");
    if ((current.checkoutAttempt ?? 0) !== input.checkoutAttempt) throw new Error("A newer checkout attempt already exists.");
    if (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== input.sessionId) {
      throw new Error("A checkout session is already active for this order.");
    }
    transaction.update(order, {
      stripeCheckoutSessionId: input.sessionId,
      expectedPackageId: input.packageId,
      expectedPriceId: input.priceId,
      expectedAmountSubtotal: input.amountSubtotal,
      expectedCurrency: input.currency.toLowerCase(),
      updatedAt: new Date().toISOString(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
  });
}

export async function clearExpiredCheckoutSession(db: Firestore, uid: string, projectId: string, sessionId: string) {
  const { project, order } = paths(db, uid, projectId);
  return db.runTransaction(async (transaction) => {
    const [projectSnapshot, orderSnapshot] = await Promise.all([transaction.get(project), transaction.get(order)]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== uid || !orderSnapshot.exists) {
      throw new Error("The checkout order could not be matched to a project.");
    }
    const current = orderSnapshot.data() as ProviderOrder;
    if (current.status !== "awaiting_payment" || current.stripeCheckoutSessionId !== sessionId) {
      throw new Error("The checkout session is no longer current.");
    }
    const checkoutAttempt = (current.checkoutAttempt ?? 0) + 1;
    transaction.update(order, {
      checkoutAttempt,
      stripeCheckoutSessionId: FieldValue.delete(),
      expectedPackageId: FieldValue.delete(),
      expectedPriceId: FieldValue.delete(),
      expectedAmountSubtotal: FieldValue.delete(),
      expectedCurrency: FieldValue.delete(),
      updatedAt: new Date().toISOString(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    return checkoutAttempt;
  });
}

export function assertPaidCheckoutMatchesOrder(order: ProviderOrder, input: PaidCheckout) {
  const validPackage = input.packageId === "launch" || input.packageId === "authority" || input.packageId === "authority_plus";
  const validAmounts = Number.isSafeInteger(input.amountSubtotal) && input.amountSubtotal >= 0
    && Number.isSafeInteger(input.amountTotal) && input.amountTotal >= input.amountSubtotal;
  if (!validPackage
    || !/^price_[A-Za-z0-9]+$/.test(input.priceId)
    || !validAmounts
    || !/^[a-z]{3}$/.test(input.currency)
    || order.status !== "awaiting_payment"
    || (order.checkoutAttempt ?? 0) !== input.checkoutAttempt
    || order.stripeCheckoutSessionId !== input.sessionId
    || order.expectedPackageId !== input.packageId
    || order.expectedPriceId !== input.priceId
    || order.expectedAmountSubtotal !== input.amountSubtotal
    || order.expectedCurrency !== input.currency) {
    throw new Error("The paid checkout does not match the expected order.");
  }
}

export async function markCheckoutPaid(
  db: Firestore,
  input: PaidCheckout,
) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid) || !/^[a-f0-9]{24}$/.test(input.projectId)) throw new Error("The checkout metadata is invalid.");
  const { project, order, jobs } = paths(db, input.uid, input.projectId);
  const eventRef = db.doc(`stripeEvents/${input.eventId}`);
  const jobRef = jobs.doc("provider_submission_current");
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, projectSnapshot, orderSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(eventRef), transaction.get(project), transaction.get(order), transaction.get(jobRef),
    ]);
    if (eventSnapshot.exists) return;
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== input.uid || !orderSnapshot.exists) throw new Error("The paid order could not be matched to a project.");
    assertPaidCheckoutMatchesOrder(orderSnapshot.data() as ProviderOrder, input);
    transaction.create(eventRef, { type: "checkout.session.completed", processedAt: FieldValue.serverTimestamp() });
    transaction.update(order, {
      status: "paid", billingStatus: "paid", stripeCheckoutSessionId: input.sessionId, stripePaymentIntentId: input.paymentIntentId,
      packageId: input.packageId, amountSubtotal: input.amountSubtotal, amountTotal: input.amountTotal,
      currency: input.currency, customerEmail: input.customerEmail ?? null, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
    });
    if (jobSnapshot.exists) transaction.update(jobRef, { status: "queued", blockedReason: FieldValue.delete(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
    if (input.customerEmail) {
      const emailJob = project.collection("jobs").doc(`customer_email_payment_${input.sessionId}`);
      transaction.create(emailJob, {
        id: emailJob.id, type: "customer_email", status: isTransactionalEmailConfigured() ? "queued" : "blocked", attempts: 0,
        idempotencyKey: createHash("sha256").update(`email:${input.sessionId}`).digest("hex"), blockedReason: isTransactionalEmailConfigured() ? null : "email_provider_required",
        to: input.customerEmail, subject: "Your Launch Auth order is confirmed", text: "Your payment was confirmed. Your approved campaign is now entering the fulfillment queue. You can follow every submission and observed outcome in your workspace.",
        createdAt: now, updatedAt: now, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(project, { lifecycleStatus: "fulfillment", campaignStatus: "fulfillment", updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
  });
}

export function assertRefundMatchesOrder(order: ProviderOrder, input: RefundedPayment) {
  if (!Number.isSafeInteger(input.amount)
    || !Number.isSafeInteger(input.amountRefunded)
    || input.amount <= 0
    || input.amountRefunded <= 0
    || input.amountRefunded > input.amount
    || !/^[a-z]{3}$/.test(input.currency)
    || order.stripePaymentIntentId !== input.paymentIntentId
    || order.currency !== input.currency
    || (order.amountTotal != null && order.amountTotal !== input.amount)
    || input.fullyRefunded !== (input.amountRefunded === input.amount)) {
    throw new Error("The refund does not match the paid order.");
  }
}

export async function markPaymentIntentRefunded(db: Firestore, input: RefundedPayment) {
  const eventRef = db.doc(`stripeEvents/${input.eventId}`);
  const orders = await db.collectionGroup("orders").where("stripePaymentIntentId", "==", input.paymentIntentId).limit(1).get();
  const order = orders.docs[0];
  if (!order) throw new Error("The refunded payment could not be matched to an order.");
  const project = order.ref.parent.parent;
  if (!project) throw new Error("The refunded order has no project.");
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, orderSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(order.ref)]);
    if (eventSnapshot.exists) return;
    if (!orderSnapshot.exists) throw new Error("The refunded payment could not be matched to an order.");
    const orderData = orderSnapshot.data() as ProviderOrder;
    assertRefundMatchesOrder(orderData, input);
    const billingStatus = input.fullyRefunded ? "refunded" : "partially_refunded";
    const fulfillmentStatus = input.fullyRefunded && orderData.status === "paid" ? "refunded" : orderData.status;
    transaction.create(eventRef, { type: "charge.refunded", amountRefunded: input.amountRefunded, currency: input.currency, processedAt: FieldValue.serverTimestamp() });
    transaction.update(order.ref, {
      status: fulfillmentStatus,
      billingStatus,
      refundedAmountCents: input.amountRefunded,
      refundedAt: now,
      updatedAt: now,
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    transaction.create(project.collection("auditLogs").doc(), {
      action: input.fullyRefunded ? "billing.refunded" : "billing.partially_refunded",
      targetId: input.paymentIntentId,
      amountRefunded: input.amountRefunded,
      currency: input.currency,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

async function runProviderSubmission(db: Firestore, jobRef: FirebaseFirestore.DocumentReference, provider: DistributionProvider) {
  const project = jobRef.parent.parent;
  if (!project) throw new Error("The job has no project.");
  const order = project.collection("orders").doc("current");
  const campaign = project.collection("campaigns").doc("current");
  const claimed = await claimQueuedJob(db, jobRef);
  if (!claimed) return { processed: false };
  try {
    const [orderSnapshot, campaignSnapshot, projectSnapshot] = await Promise.all([order.get(), campaign.get(), project.get()]);
    if (!orderSnapshot.exists || orderSnapshot.data()?.status !== "paid") throw new Error("The provider job has no paid order.");
    if (!campaignSnapshot.exists || !campaignSnapshot.data()?.version) throw new Error("The provider job has no campaign version.");
    if (!projectSnapshot.exists) throw new Error("The provider job has no project.");
    const orderData = orderSnapshot.data() as ProviderOrder;
    const campaignData = campaignSnapshot.data() as CampaignDraft;
    if (campaignData.status !== "approved"
      || campaignData.version !== orderData.campaignVersion
      || campaignDigest(campaignData) !== orderData.campaignDigest) {
      throw new Error("The approved campaign changed after fulfillment was prepared.");
    }
    const submission = await provider.submit({ campaignVersion: campaignData.version, idempotencyKey: claimed.data.idempotencyKey });
    const now = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const currentJob = await transaction.get(jobRef);
      if (!currentJob.exists || currentJob.data()?.status !== "running" || currentJob.data()?.runToken !== claimed.runToken) return;
      transaction.update(jobRef, { status: "complete", failureCount: 0, lastError: FieldValue.delete(), ...clearLease(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      transaction.update(order, { status: submission.status, externalId: submission.externalId, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      transaction.update(project, { lifecycleStatus: "fulfillment", campaignStatus: "fulfillment", updatedAtIso: now, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(project.collection("auditLogs").doc(), { action: "provider.submitted", targetId: submission.externalId, jobId: jobRef.id, createdAt: FieldValue.serverTimestamp() });
      const verificationJob = project.collection("jobs").doc("placement_verification_current");
      transaction.set(verificationJob, {
        id: verificationJob.id,
        type: "placement_verification",
        status: "queued",
        attempts: 0,
        failureCount: 0,
        idempotencyKey: createHash("sha256").update(`verify:${submission.externalId}`).digest("hex"),
        createdAt: now,
        updatedAt: now,
        createdAtServer: FieldValue.serverTimestamp(),
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { processed: true, status: "complete" as const };
  } catch (error) {
    return failClaimedJob(db, jobRef, claimed.runToken, error);
  }
}

async function runCustomerEmail(db: Firestore, jobRef: FirebaseFirestore.DocumentReference, provider: TransactionalEmailProvider) {
  const claimed = await claimQueuedJob(db, jobRef);
  if (!claimed) return { processed: false };
  try {
    const email = claimed.data as JobRun & { to: string; subject: string; text: string };
    const sent = await provider.send({ to: String(email.to), subject: String(email.subject), text: String(email.text) }, String(email.idempotencyKey));
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(jobRef);
      if (!current.exists || current.data()?.status !== "running" || current.data()?.runToken !== claimed.runToken) return;
      transaction.update(jobRef, { status: "complete", externalId: sent.id, failureCount: 0, lastError: FieldValue.delete(), ...clearLease(), updatedAt: new Date().toISOString(), updatedAtServer: FieldValue.serverTimestamp() });
    });
    return { processed: true, status: "complete" as const };
  } catch (error) {
    return failClaimedJob(db, jobRef, claimed.runToken, error);
  }
}

async function runPlacementVerification(db: Firestore, jobRef: FirebaseFirestore.DocumentReference, provider: DistributionProvider) {
  const project = jobRef.parent.parent;
  if (!project) throw new Error("The verification job has no project.");
  const orderRef = project.collection("orders").doc("current");
  const placementsRef = project.collection("placements");
  const claimed = await claimQueuedJob(db, jobRef);
  if (!claimed) return { processed: false };
  try {
    const [orderSnapshot, existingSnapshot] = await Promise.all([orderRef.get(), placementsRef.limit(100).get()]);
    const order = orderSnapshot.data() as ProviderOrder | undefined;
    if (!orderSnapshot.exists || !order?.externalId) throw new Error("The verification job has no submitted provider order.");
    const [providerStatus, evidence] = await Promise.all([provider.status(order.externalId), provider.evidence(order.externalId)]);
    const existingByUrl = new Map(existingSnapshot.docs.map((snapshot) => [String(snapshot.data().url), { id: snapshot.id, data: snapshot.data() as Placement }]));
    const evidenceByUrl = new Map(evidence.slice(0, 100).map((item) => [item.url, item]));
    const urls = [...new Set([...existingByUrl.keys(), ...evidenceByUrl.keys()])];
    const checks = await Promise.all(urls.map(async (url) => {
      try {
        return { url, result: await verifyPublicPlacementUrl(url), error: undefined };
      } catch (error) {
        return { url, result: undefined, error: (error instanceof Error ? error.message : "Placement verification failed.").slice(0, 500) };
      }
    }));
    const now = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const currentJob = await transaction.get(jobRef);
      if (!currentJob.exists || currentJob.data()?.status !== "running" || currentJob.data()?.runToken !== claimed.runToken) return;
      for (const check of checks) {
        const observed = evidenceByUrl.get(check.url);
        const existing = existingByUrl.get(check.url);
        const placementId = existing?.id ?? createHash("sha256").update(check.url).digest("hex").slice(0, 24);
        let outlet = "Observed placement";
        try { outlet = new URL(check.url).hostname.replace(/^www\./, ""); } catch { /* retained as an invalid provider observation */ }
        if (check.result) {
          const priorState = existing?.data.state;
          const liveState = observed?.state ?? (priorState === "published" || priorState === "indexed" ? priorState : "accepted");
          const state: Placement["state"] = check.result.live ? liveState : (priorState === "published" || priorState === "indexed" || observed ? "removed" : "failed");
          transaction.set(placementsRef.doc(placementId), {
            id: placementId,
            outlet,
            url: check.result.url,
            state,
            providerState: observed?.state ?? existing?.data.providerState ?? null,
            lastObservedAt: observed?.observedAt ?? existing?.data.lastObservedAt ?? null,
            publishedAt: existing?.data.publishedAt ?? observed?.observedAt ?? null,
            firstVerifiedAt: existing?.data.firstVerifiedAt ?? (check.result.live ? check.result.checkedAt : null),
            lastVerifiedAt: check.result.checkedAt,
            lastHttpStatus: check.result.status,
            removedAt: state === "removed" ? check.result.checkedAt : FieldValue.delete(),
            lastVerificationError: FieldValue.delete(),
          }, { merge: true });
        } else {
          transaction.set(placementsRef.doc(placementId), {
            id: placementId,
            outlet,
            url: check.url,
            state: existing?.data.state ?? "accepted",
            providerState: observed?.state ?? existing?.data.providerState ?? null,
            lastObservedAt: observed?.observedAt ?? existing?.data.lastObservedAt ?? null,
            lastVerificationError: check.error,
          }, { merge: true });
        }
      }
      transaction.update(orderRef, { status: nextProviderOrderStatus(order.status, providerStatus.status), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      const terminal = providerStatus.status === "failed" || providerStatus.status === "canceled";
      transaction.update(jobRef, {
        status: terminal ? "complete" : "scheduled",
        failureCount: 0,
        lastError: FieldValue.delete(),
        nextAttemptAt: terminal ? FieldValue.delete() : new Date(Date.now() + VERIFICATION_POLL_MS).toISOString(),
        ...clearLease(),
        updatedAt: now,
        updatedAtServer: FieldValue.serverTimestamp(),
      });
      transaction.create(project.collection("auditLogs").doc(), {
        action: "placements.verified",
        targetId: order.externalId,
        observed: evidence.length,
        checked: checks.length,
        providerStatus: providerStatus.status,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return { processed: true, status: providerStatus.status, observed: evidence.length, checked: checks.length };
  } catch (error) {
    return failClaimedJob(db, jobRef, claimed.runToken, error);
  }
}

export async function runQueuedFulfillmentJobs(db: Firestore, provider: DistributionProvider, emailProvider: TransactionalEmailProvider, limit = 10) {
  const recovered = await recoverExpiredJobLeases(db);
  const promoted = await promoteDueScheduledJobs(db);
  const snapshot = await db.collectionGroup("jobs").where("status", "==", "queued").limit(Math.min(Math.max(limit, 1), 25)).get();
  const results = [];
  for (const job of snapshot.docs) {
    const type = job.data().type;
    if (type === "provider_submission") results.push(await runProviderSubmission(db, job.ref, provider));
    if (type === "customer_email") results.push(await runCustomerEmail(db, job.ref, emailProvider));
    if (type === "placement_verification") results.push(await runPlacementVerification(db, job.ref, provider));
  }
  return { inspected: snapshot.size, recovered, promoted, processed: results.filter((result) => result.processed).length, results };
}
