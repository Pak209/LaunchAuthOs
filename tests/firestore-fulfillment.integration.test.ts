import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { prepareFulfillment, runQueuedFulfillmentJobs, markPaymentIntentRefunded } from "../lib/fulfillment";
import { verifyPublicPlacementUrl } from "../lib/placement-verification";
import { campaignDigest } from "../lib/campaign-approval";
import { SandboxDistributionProvider, type ProviderSubmission } from "../lib/provider";
import type { CampaignDraft } from "../lib/types";

// All transport is synthetic. No supplier, payment API, customer URL or live Firebase access.
vi.mock("../lib/placement-verification", () => ({ verifyPublicPlacementUrl: vi.fn(async (url: string) => ({ url, status: 200, live: true, checkedAt: new Date().toISOString() })) }));
let app: App, db: Firestore, uid: string, id: string;
let provider: SandboxDistributionProvider;
let observation: ProviderSubmission;
const root = () => db.doc(`workspaces/personal_${uid}`);
const project = () => root().collection("projects").doc(id);
const order = () => project().collection("orders").doc("current");
const submissionJob = () => project().collection("jobs").doc("provider_submission_current");
const pollJob = () => project().collection("jobs").doc("placement_verification_current");
const run = () => runQueuedFulfillmentJobs(db, () => provider, { send: vi.fn() });
beforeAll(() => {
  if (process.env.RUN_FIRESTORE_ORDER_LOCK !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:18891" || process.env.GCLOUD_PROJECT !== "demo-launch-order-lock") throw new Error("Use the isolated emulator launcher; refusing live data.");
  app = initializeApp({ projectId: "demo-launch-order-lock" }, "fulfillment-emulator"); db = getFirestore(app);
});
beforeEach(async () => {
  uid = `delivery_${randomUUID().replaceAll("-", "")}`; id = randomUUID().replaceAll("-", "").slice(0, 24);
  const now = new Date().toISOString();
  const campaign: CampaignDraft = { version: 1, status: "approved", model: "synthetic", generatedAt: now, updatedAt: now,
    assets: [{ id: "release", type: "press_release", title: "Synthetic Product Introduces A New Test", content: "word ".repeat(300), claimIds: ["fact"], status: "approved" }] };
  await root().set({ synthetic: true });
  await project().set({ createdBy: uid, profile: { company: "Synthetic", sourceUrl: "https://synthetic.example" } });
  await project().collection("campaigns").doc("current").set(campaign);
  await project().collection("campaignApprovals").doc("current").set({ approvedBy: uid, campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
  provider = new SandboxDistributionProvider();
  observation = { externalId: `sandbox_${id}`, status: "processing" };
  vi.spyOn(provider, "submit").mockImplementation(async () => ({ externalId: observation.externalId, status: "submitted" }));
  vi.spyOn(provider, "status").mockImplementation(async () => observation);
  await prepareFulfillment(db, uid, id, campaign, await provider.quote("launch"), { country: "United States", city: "Test", categories: ["Technology"], contactName: "Test", contactEmail: "test@example.invalid" }, "launch");
  await order().update({ status: "paid", billingStatus: "paid", stripeLivemode: false, stripePaymentIntentId: `pi_${id}`, amountTotal: 100 });
  await submissionJob().update({ status: "queued" });
});
afterEach(async () => {
  vi.restoreAllMocks(); await db.recursiveDelete(root());
  // Synthetic global receipts created only by this test identity.
  for (const suffix of ["partial", "full"]) await db.doc(`stripeEvents/${id}_${suffix}`).delete();
});
afterAll(async () => { await deleteApp(app); });
it("submits once under concurrent workers and records verified synthetic publication", async () => {
  await Promise.all([run(), run()]); expect(provider.submit).toHaveBeenCalledTimes(1);
  observation = { ...observation, status: "published", packageOutcomes: [{ package: "synthetic", state: "live", liveUrl: "https://synthetic.example/placement" }] };
  // A competing worker may already have polled during the first run.
  await pollJob().update({ status: "queued" }); await run();
  expect((await order().get()).data()?.status).toBe("published");
  const placements = await project().collection("placements").get();
  expect(placements.size).toBe(1); expect(placements.docs[0].data()).toMatchObject({ state: "published", lastHttpStatus: 200 });
});
it("keeps partial rejection credits and early live placement despite a closed report endpoint", async () => {
  await run(); observation = { ...observation, status: "processing", packageOutcomes: [
    { package: "one", state: "live", liveUrl: "https://synthetic.example/early" },
    { package: "two", state: "rejected", creditsRefunded: 3, reason: "Synthetic rejection" },
  ] };
  vi.spyOn(provider, "evidence").mockRejectedValue(new Error("report unavailable until all outlets finish"));
  await run();
  expect((await order().get()).data()).toMatchObject({ status: "processing", billingStatus: "paid", providerPackageOutcomes: observation.packageOutcomes });
  expect((await project().collection("placements").get()).docs[0].data().state).toBe("published");
  expect((await pollJob().get()).data()).toMatchObject({ status: "scheduled", failureCount: 1 });
});
it("persists terminal rejection through evidence failure then recovers polling without resubmission", async () => {
  await run(); observation = { ...observation, status: "failed", packageOutcomes: [{ package: "one", state: "rejected", creditsRefunded: 10 }] };
  const evidence = vi.spyOn(provider, "evidence").mockRejectedValue(new Error("synthetic outage"));
  await run(); expect((await order().get()).data()).toMatchObject({ status: "failed", billingStatus: "paid" });
  evidence.mockResolvedValue([]); await pollJob().update({ nextAttemptAt: new Date(0).toISOString() }); await run();
  expect((await pollJob().get()).data()?.status).toBe("complete"); expect(provider.submit).toHaveBeenCalledTimes(1);
});
it("deduplicates customer refunds and keeps them separate from supplier credit outcomes", async () => {
  const refund = { livemode: false, paymentIntentId: `pi_${id}`, eventId: `${id}_partial`, amount: 100, amountRefunded: 40, currency: "usd", fullyRefunded: false };
  await Promise.all([markPaymentIntentRefunded(db, refund), markPaymentIntentRefunded(db, refund)]);
  expect((await order().get()).data()).toMatchObject({ billingStatus: "partially_refunded", refundedAmountCents: 40 });
  await markPaymentIntentRefunded(db, { ...refund, eventId: `${id}_full`, amountRefunded: 100, fullyRefunded: true });
  await run(); expect(provider.submit).not.toHaveBeenCalled();
  expect((await order().get()).data()).toMatchObject({ status: "refunded", billingStatus: "refunded", refundedAmountCents: 100 });
});
it("recovers a pre-dispatch expired lease but fences uncertain dispatched work", async () => {
  await submissionJob().update({ status: "running", leaseExpiresAt: new Date(0).toISOString(), runToken: "dead" });
  await run(); expect(provider.submit).toHaveBeenCalledTimes(1);
  // Simulate lost acknowledgement after an external call, with no durable release ID.
  await order().update({ externalId: null, status: "paid", providerSubmissionStartedAt: new Date().toISOString() });
  await submissionJob().update({ status: "running", leaseExpiresAt: new Date(0).toISOString(), dispatchStartedAt: new Date().toISOString(), runToken: "dead-again" });
  await run(); expect(provider.submit).toHaveBeenCalledTimes(1);
  expect((await submissionJob().get()).data()).toMatchObject({ status: "failed", needsHumanReview: true });
  expect((await order().get()).data()?.providerSubmissionUncertain).toBe(true);
});
it("preserves a concurrent administrative cancellation while the supplier status is in flight", async () => {
  await run(); vi.mocked(provider.status).mockImplementation(async () => { await order().update({ status: "canceled" }); return { ...observation, status: "published" }; });
  await run(); expect((await order().get()).data()?.status).toBe("canceled");
});

it("retries terminal URL errors, stops after three failures, and supports operator retry", async () => {
  await run(); observation = { ...observation, status: "failed", packageOutcomes: [{ package: "one", state: "live", liveUrl: "https://synthetic.example/transient" }] };
  const verify = vi.mocked(verifyPublicPlacementUrl); verify.mockRejectedValue(new Error("synthetic timeout"));
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await pollJob().update({ nextAttemptAt: new Date(0).toISOString() });
    await run(); expect((await pollJob().get()).data()).toMatchObject({ status: attempt === 3 ? "failed" : "scheduled", failureCount: attempt });
  }
  verify.mockImplementation(async url => ({ url, status: 200, live: true, checkedAt: new Date().toISOString() }));
  // Same state transition as the explicit internal retry action.
  await pollJob().update({ status: "queued", failureCount: 0 }); await run();
  expect((await pollJob().get()).data()?.status).toBe("complete");
  expect((await project().collection("placements").get()).docs[0].data().state).toBe("published");
});
