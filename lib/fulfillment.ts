import { createHash, randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { CampaignDraft, DirectorySubmission, FulfillmentState, JobRun, Placement, ProviderOrder } from "./types";
import { providerReleaseBindingPath, ProviderSubmissionNeedsReviewError, type DistributionDetails, type DistributionProvider, type ProviderPackageId, type ProviderQuote } from "./provider";
import { isTransactionalEmailConfigured, type TransactionalEmailProvider } from "./email";
import { assertCampaignAttestation, campaignDigest, type CampaignApprovalAttestation } from "./campaign-approval";
import { verifyPublicPlacementUrl } from "./placement-verification";

type PaidPackageId = "launch" | "authority" | "authority_plus";

export type CheckoutBinding = {
  livemode: boolean;
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
  livemode: boolean;
  paymentIntentId: string;
  eventId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  fullyRefunded: boolean;
};

const JOB_LEASE_MS = 10 * 60 * 1_000;
const VERIFICATION_POLL_MS = 60 * 60 * 1_000;

export type DistributionProviderResolver = (providerId: string) => DistributionProvider;

export function assertJobCanRetry(job: Pick<JobRun, "status" | "type" | "dispatchStartedAt" | "needsHumanReview">) {
  if (job.status !== "failed") throw new Error("Only failed jobs can be retried.");
  if (job.needsHumanReview || (job.type === "provider_submission" && job.dispatchStartedAt)) {
    throw new Error("This job requires supplier reconciliation before retry. A release may already have been submitted.");
  }
}

function providerForOrder(resolveProvider: DistributionProviderResolver, order: ProviderOrder) {
  if (!order.provider) throw new Error("The order is missing its provider identity.");
  const provider = resolveProvider(order.provider);
  if (provider.id !== order.provider) throw new Error("The provider does not match the order.");
  return provider;
}

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

function plainWords(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/[#*_`>\[\]()]/g, " ").split(/\s+/).filter(Boolean);
}

export function providerReleaseFromCampaign(campaign: CampaignDraft) {
  const asset = campaign.assets.find((candidate) => candidate.type === "press_release");
  if (!asset || asset.status !== "approved") throw new Error("Approve the press release before preparing fulfillment.");
  const firstLine = asset.content.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  const title = plainWords(asset.title).length >= 5 ? asset.title.trim() : firstLine;
  if (title.length < 5 || title.length > 200 || plainWords(title).length < 5) {
    throw new Error("The press release headline must contain at least five words and no more than 200 characters.");
  }
  const words = plainWords(asset.content);
  if (words.length < 250 || words.length > 1_150) throw new Error("The approved press release must contain 250–1,150 words before fulfillment so the required media-contact block remains within the provider limit.");
  const summaryWords = plainWords(asset.content.replace(/https?:\/\/\S+/g, " ")).slice(0, 45);
  let summary = summaryWords.join(" ");
  if (summary.length > 250) summary = summary.slice(0, 250).replace(/\s+\S*$/, "").trim();
  return { title, content: asset.content, summary };
}

function clearLease() {
  return { runToken: FieldValue.delete(), leaseExpiresAt: FieldValue.delete() };
}

async function claimQueuedJob(db: Firestore, jobRef: FirebaseFirestore.DocumentReference) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data()?.status !== "queued") return null;
    const data = snapshot.data() as JobRun;
    if (data.needsHumanReview || (data.type === "provider_submission" && data.dispatchStartedAt)) return null;
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
    // A failed commit acknowledgement can hide a successfully persisted fence.
    const uncertain = current.type === "provider_submission" && Boolean(current.dispatchStartedAt);
    const project = jobRef.parent.parent;
    const orderRef = project?.collection("orders").doc("current");
    const orderSnapshot = uncertain && orderRef ? await transaction.get(orderRef) : undefined;
    const failureCount = Number(current.failureCount ?? 0) + 1;
    const failed = uncertain || failureCount >= 3;
    const now = Date.now();
    transaction.update(jobRef, {
      status: failed ? "failed" : "scheduled",
      failureCount,
      lastError,
      ...(uncertain ? { needsHumanReview: true } : {}),
      nextAttemptAt: failed ? FieldValue.delete() : new Date(now + Math.min(15 * 60_000, 30_000 * 2 ** (failureCount - 1))).toISOString(),
      ...clearLease(),
      updatedAt: new Date(now).toISOString(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    if (uncertain && orderRef && orderSnapshot?.exists) {
      transaction.update(orderRef, { providerSubmissionUncertain: true, updatedAt: new Date(now).toISOString(), updatedAtServer: FieldValue.serverTimestamp() });
      transaction.create(project!.collection("auditLogs").doc(), { action: "provider.submission_uncertain", targetId: jobRef.id, reason: "dispatch_commit_acknowledgement_lost", createdAt: FieldValue.serverTimestamp() });
    }
    return { processed: true, status: failed ? "failed" as const : "queued" as const, error: lastError };
  });
}

async function flagProviderSubmissionForReview(
  db: Firestore,
  jobRef: FirebaseFirestore.DocumentReference,
  orderRef: FirebaseFirestore.DocumentReference,
  projectRef: FirebaseFirestore.DocumentReference,
  runToken: string,
  error: ProviderSubmissionNeedsReviewError,
) {
  const lastError = error.message.slice(0, 500);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef);
    if (!current.exists || current.data()?.status !== "running" || current.data()?.runToken !== runToken) return { processed: false };
    const now = new Date().toISOString();
    transaction.update(jobRef, { status: "failed", lastError, needsHumanReview: true, ...clearLease(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
    transaction.update(orderRef, { providerSubmissionUncertain: true, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
    transaction.create(projectRef.collection("auditLogs").doc(), { action: "provider.submission_uncertain", targetId: jobRef.id, lastError, createdAt: FieldValue.serverTimestamp() });
    return { processed: true, status: "failed" as const, error: lastError, needsHumanReview: true };
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
      const uncertain = current.type === "provider_submission"
        && (Boolean(current.dispatchStartedAt) || current.dispatchProtocolVersion !== 1);
      const project = job.ref.parent.parent;
      const orderRef = project?.collection("orders").doc("current");
      const orderSnapshot = uncertain && orderRef ? await transaction.get(orderRef) : undefined;
      transaction.update(job.ref, {
        status: uncertain ? "failed" : "queued",
        needsHumanReview: uncertain,
        nextAttemptAt: uncertain ? FieldValue.delete() : new Date().toISOString(),
        lastError: uncertain ? "Worker lease expired during a possible supplier submission. Reconcile the supplier dashboard before retrying." : "Recovered after the previous worker lease expired before dispatch.",
        ...clearLease(),
        updatedAt: new Date().toISOString(),
        updatedAtServer: FieldValue.serverTimestamp(),
      });
      if (uncertain && orderRef && orderSnapshot?.exists) {
        transaction.update(orderRef, { providerSubmissionUncertain: true, updatedAt: new Date().toISOString(), updatedAtServer: FieldValue.serverTimestamp() });
        transaction.create(project!.collection("auditLogs").doc(), { action: "provider.submission_uncertain", targetId: job.id, reason: "expired_dispatch_lease", createdAt: FieldValue.serverTimestamp() });
      }
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
      if (!currentSnapshot.exists || current?.status !== "scheduled" || current.needsHumanReview) return false;
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
    directories: directorySnapshot.docs.map((snapshot) => {
      const { operatorId, operatorNote, ...customerRecord } = snapshot.data();
      return customerRecord as DirectorySubmission;
    }),
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
  distributionDetails: DistributionDetails,
  selectedPackageId: ProviderPackageId,
): Promise<FulfillmentState> {
  if (campaign.status !== "approved") throw new Error("Approve the complete campaign before preparing fulfillment.");
  const release = providerReleaseFromCampaign(campaign);
  const { project, order, directories, jobs } = paths(db, uid, projectId);
  const approval = project.collection("campaignApprovals").doc("current");
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [projectSnapshot, orderSnapshot, approvalSnapshot, currentCampaignSnapshot] = await Promise.all([
      transaction.get(project), transaction.get(order), transaction.get(approval), transaction.get(project.collection("campaigns").doc("current")),
    ]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.createdBy !== uid) throw new Error("The project was not found.");
    const currentCampaign = currentCampaignSnapshot.data() as CampaignDraft | undefined;
    if (!currentCampaign || currentCampaign.status !== "approved" || campaignDigest(currentCampaign) !== campaignDigest(campaign)) throw new Error("The campaign changed. Review and approve the current campaign before fulfillment.");
    assertCampaignAttestation(campaign, approvalSnapshot.data() as CampaignApprovalAttestation | undefined, uid);
    if (orderSnapshot.exists) return;
    const profile = projectSnapshot.data()?.profile;
    const company = String(profile?.company ?? "").trim();
    const website = String(profile?.sourceUrl ?? "").trim();
    if (!company || !/^https?:\/\//.test(website)) throw new Error("The project needs a company name and website before fulfillment.");
    if (!quote.sandbox && (!quote.providerPlan || !Number.isSafeInteger(quote.requiredCredits) || Number(quote.requiredCredits) <= 0)) throw new Error("The provider quote needs an exact plan and credit requirement.");
    const idempotencyKey = createHash("sha256").update(`${uid}:${projectId}:${campaign.version}:provider-submit`).digest("hex");
    const submissionInput = {
      ...release, ...distributionDetails, company, website, campaignVersion: campaign.version,
      packageId: selectedPackageId, idempotencyKey,
      ...(quote.providerPlan ? { providerPlan: quote.providerPlan } : {}),
    };
    const providerOrder: ProviderOrder = {
      id: "current", provider: quote.provider, sandbox: quote.sandbox, nonBillable: quote.nonBillable,
      providerCostCents: quote.providerCostCents, currency: quote.currency, distributionDetails, selectedPackageId,
      submissionInput,
      ...(quote.providerPlan ? { providerPlan: quote.providerPlan } : {}),
      ...(quote.requiredCredits != null ? { requiredCredits: quote.requiredCredits } : {}),
      campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), checkoutAttempt: 0,
      status: "awaiting_payment", billingStatus: "awaiting_payment", createdAt: now, updatedAt: now,
    };
    transaction.create(order, { ...providerOrder, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp() });
    for (const template of directoryTemplates) {
      const submission: DirectorySubmission = { ...template, status: "needs_customer", orderId: "current", campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), revision: 0, createdAt: now, updatedAt: now };
      transaction.create(directories.doc(template.id), { ...submission, createdAtServer: FieldValue.serverTimestamp(), updatedAtServer: FieldValue.serverTimestamp() });
    }
    const job: JobRun = {
      id: "provider_submission_current", type: "provider_submission", status: "blocked", attempts: 0,
      idempotencyKey, dispatchProtocolVersion: 1,
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
      expectedStripeLivemode: input.livemode,
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
      expectedStripeLivemode: FieldValue.delete(),
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
    || typeof input.livemode !== "boolean"
    || order.expectedStripeLivemode !== input.livemode
    || (input.livemode ? (order.sandbox || order.nonBillable) : (!order.sandbox || !order.nonBillable))
    || !/^[a-z]{3}$/.test(input.currency)
    || order.status !== "awaiting_payment"
    || (order.checkoutAttempt ?? 0) !== input.checkoutAttempt
    || order.stripeCheckoutSessionId !== input.sessionId
    || order.selectedPackageId !== input.packageId
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
      stripeLivemode: input.livemode,
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
    || typeof input.livemode !== "boolean"
    || order.stripeLivemode !== input.livemode
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
  const submissionJobRef = project.collection("jobs").doc("provider_submission_current");
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, orderSnapshot, jobSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(order.ref), transaction.get(submissionJobRef)]);
    if (eventSnapshot.exists) return;
    if (!orderSnapshot.exists) throw new Error("The refunded payment could not be matched to an order.");
    const orderData = orderSnapshot.data() as ProviderOrder;
    assertRefundMatchesOrder(orderData, input);
    transaction.create(eventRef, { type: "charge.refunded", amountRefunded: input.amountRefunded, currency: input.currency, processedAt: FieldValue.serverTimestamp() });
    // Stripe can deliver cumulative refund observations out of order.
    if (input.amountRefunded <= (orderData.refundedAmountCents ?? 0)) return;
    const billingStatus = input.fullyRefunded ? "refunded" : "partially_refunded";
    const fulfillmentStatus = input.fullyRefunded && orderData.status === "paid" && !orderData.providerSubmissionStartedAt ? "refunded" : orderData.status;
    const submissionJob = jobSnapshot.data() as JobRun | undefined;
    if (input.fullyRefunded && !orderData.providerSubmissionStartedAt && jobSnapshot.exists && !submissionJob?.dispatchStartedAt && !submissionJob?.needsHumanReview && submissionJob?.status !== "complete") {
      transaction.update(submissionJobRef, {
        status: "complete", lastError: "Closed before supplier dispatch after a full customer refund.",
        nextAttemptAt: FieldValue.delete(), blockedReason: FieldValue.delete(), ...clearLease(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp(),
      });
    }
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

async function runProviderSubmission(db: Firestore, jobRef: FirebaseFirestore.DocumentReference, resolveProvider: DistributionProviderResolver) {
  const project = jobRef.parent.parent;
  if (!project) throw new Error("The job has no project.");
  const order = project.collection("orders").doc("current");
  const campaign = project.collection("campaigns").doc("current");
  const claimed = await claimQueuedJob(db, jobRef);
  if (!claimed) return { processed: false };
  let dispatchStarted = false;
  try {
    const [orderSnapshot, campaignSnapshot] = await Promise.all([order.get(), campaign.get()]);
    if (!orderSnapshot.exists || orderSnapshot.data()?.status !== "paid") throw new Error("The provider job has no paid order.");
    if (!campaignSnapshot.exists || !campaignSnapshot.data()?.version) throw new Error("The provider job has no campaign version.");
    const orderData = orderSnapshot.data() as ProviderOrder;
    const provider = providerForOrder(resolveProvider, orderData);
    if ((!orderData.sandbox || !orderData.nonBillable) && orderData.stripeLivemode !== true) throw new Error("Live supplier submission requires a verified live-mode payment.");
    if ((orderData.sandbox || orderData.nonBillable) && orderData.stripeLivemode !== false) throw new Error("Sandbox fulfillment requires a verified test-mode payment.");
    const campaignData = campaignSnapshot.data() as CampaignDraft;
    if (campaignData.status !== "approved"
      || campaignData.version !== orderData.campaignVersion
      || campaignDigest(campaignData) !== orderData.campaignDigest) {
      throw new Error("The approved campaign changed after fulfillment was prepared.");
    }
    if (!orderData.distributionDetails || !orderData.selectedPackageId) throw new Error("The provider order is missing its package, distribution location, or categories.");
    const input = orderData.submissionInput;
    if (!input || input.campaignVersion !== orderData.campaignVersion || input.packageId !== orderData.selectedPackageId || input.idempotencyKey !== claimed.data.idempotencyKey || input.providerPlan !== orderData.providerPlan) {
      throw new Error("The order is missing its frozen submission details. Reconcile the order before fulfillment.");
    }
    provider.assertCanSubmit(input);
    // Persist the dispatch fence BEFORE contacting the supplier. A restarted worker
    // cannot know whether a request was accepted, so it must not resubmit it.
    const fenced = await db.runTransaction(async (transaction) => {
      const [jobSnapshot, freshOrderSnapshot] = await Promise.all([transaction.get(jobRef), transaction.get(order)]);
      const job = jobSnapshot.data() as JobRun | undefined;
      const freshOrder = freshOrderSnapshot.data() as ProviderOrder | undefined;
      if (!job || job.status !== "running" || job.runToken !== claimed.runToken) return false;
      if (job.dispatchStartedAt || job.needsHumanReview || freshOrder?.providerSubmissionStartedAt || freshOrder?.providerSubmissionUncertain || freshOrder?.externalId) {
        throw new ProviderSubmissionNeedsReviewError("A supplier submission may already exist. Reconcile the order before retrying.");
      }
      if (freshOrder?.status !== "paid" || freshOrder.billingStatus === "refunded") throw new Error("The order is no longer eligible for submission.");
      const startedAt = new Date().toISOString();
      transaction.update(jobRef, { dispatchStartedAt: startedAt, dispatchProtocolVersion: 1, updatedAt: startedAt });
      transaction.update(order, { providerSubmissionStartedAt: startedAt, updatedAt: startedAt });
      return true;
    });
    if (!fenced) return { processed: false };
    dispatchStarted = true;
    const submission = await provider.submit(input);
    const now = new Date().toISOString();
    const releaseBinding = db.doc(providerReleaseBindingPath(orderData.provider, submission.externalId));
    await db.runTransaction(async (transaction) => {
      const [currentJob, binding] = await Promise.all([transaction.get(jobRef), transaction.get(releaseBinding)]);
      if (!currentJob.exists || currentJob.data()?.status !== "running" || currentJob.data()?.runToken !== claimed.runToken) return;
      if (binding.exists && binding.data()?.orderPath !== order.path) throw new ProviderSubmissionNeedsReviewError("The supplier returned a release already bound to another order. Reconcile the provider response.");
      transaction.set(releaseBinding, { provider: orderData.provider, externalId: submission.externalId, orderPath: order.path, boundAt: now });
      transaction.update(jobRef, { status: "complete", failureCount: 0, lastError: FieldValue.delete(), ...clearLease(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      transaction.update(order, {
        status: submission.status,
        externalId: submission.externalId,
        providerStatusReason: submission.statusReason ?? null,
        providerPackageOutcomes: submission.packageOutcomes ?? [],
        providerSubmissionUncertain: false,
        updatedAt: now,
        updatedAtServer: FieldValue.serverTimestamp(),
      });
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
    if (dispatchStarted || error instanceof ProviderSubmissionNeedsReviewError) {
      const uncertain = error instanceof ProviderSubmissionNeedsReviewError ? error : new ProviderSubmissionNeedsReviewError(`Submission outcome needs reconciliation: ${error instanceof Error ? error.message : "unknown failure"}`);
      return flagProviderSubmissionForReview(db, jobRef, order, project, claimed.runToken, uncertain);
    }
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

async function runPlacementVerification(db: Firestore, jobRef: FirebaseFirestore.DocumentReference, resolveProvider: DistributionProviderResolver) {
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
    const provider = providerForOrder(resolveProvider, order);
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
      transaction.update(orderRef, {
        status: nextProviderOrderStatus(order.status, providerStatus.status),
        providerStatusReason: providerStatus.statusReason ?? null,
        providerPackageOutcomes: providerStatus.packageOutcomes ?? [],
        updatedAt: now,
        updatedAtServer: FieldValue.serverTimestamp(),
      });
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

export async function runQueuedFulfillmentJobs(db: Firestore, resolveProvider: DistributionProviderResolver, emailProvider: TransactionalEmailProvider, limit = 10) {
  const recovered = await recoverExpiredJobLeases(db);
  const promoted = await promoteDueScheduledJobs(db);
  const snapshot = await db.collectionGroup("jobs").where("status", "==", "queued").limit(Math.min(Math.max(limit, 1), 25)).get();
  const results = [];
  for (const job of snapshot.docs) {
    const type = job.data().type;
    if (type === "provider_submission") results.push(await runProviderSubmission(db, job.ref, resolveProvider));
    if (type === "customer_email") results.push(await runCustomerEmail(db, job.ref, emailProvider));
    if (type === "placement_verification") results.push(await runPlacementVerification(db, job.ref, resolveProvider));
  }
  return { inspected: snapshot.size, recovered, promoted, processed: results.filter((result) => result.processed).length, results };
}
