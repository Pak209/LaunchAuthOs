import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { MemoryFirestore } from "./helpers/memory-firestore";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: () => state.db }));
vi.mock("@/lib/stripe", async () => {
  const { default: StripeClient } = await import("stripe");
  return { getStripeClient: () => new StripeClient("sk_test_synthetic"), getStripeWebhookSecret: () => "whsec_synthetic_local_only", isStripeLiveMode: () => false };
});
vi.mock("@/lib/fulfillment", () => import("../lib/fulfillment"));
import { POST } from "../app/api/stripe/webhook/route";
const stripe = new Stripe("sk_test_synthetic");
const projectId = "a".repeat(24), path = `workspaces/personal_owner/projects/${projectId}`;
let db: MemoryFirestore;
const session = { id: "cs_delayed", mode: "payment", livemode: false, payment_status: "paid", payment_intent: "pi_delayed", amount_subtotal: 1000, amount_total: 1100, currency: "usd", metadata: { uid: "owner", projectId, packageId: "launch", priceId: "price_Test", checkoutAttempt: "0" } };
async function send(type: string, id: string, changes: Record<string, unknown> = {}, eventChanges = {}, signed = true) {
  const payload = JSON.stringify({ id, type, livemode: false, data: { object: { ...session, ...changes } }, ...eventChanges });
  return POST(new Request("https://example.test/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signed ? stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_synthetic_local_only" }) : "invalid" } }));
}
beforeEach(() => {
  db = new MemoryFirestore(); state.db = db.asFirestore();
  db.seed(path, { createdBy: "owner" });
  db.seed(`${path}/orders/current`, { id: "current", status: "awaiting_payment", sandbox: true, nonBillable: true, checkoutAttempt: 0, stripeCheckoutSessionId: "cs_delayed", expectedStripeLivemode: false, selectedPackageId: "launch", expectedPackageId: "launch", expectedPriceId: "price_Test", expectedAmountSubtotal: 1000, expectedCurrency: "usd" });
  db.seed(`${path}/jobs/provider_submission_current`, { status: "blocked", blockedReason: "payment_required" });
});
describe("signed delayed Checkout sequences with real payment transaction", () => {
  it("acknowledges pending completion without queuing, then confirms delayed success", async () => {
    expect((await send("checkout.session.completed", "evt_pending", { payment_status: "unpaid" })).status).toBe(200);
    expect(db.read(`${path}/orders/current`).status).toBe("awaiting_payment");
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("blocked");
    expect((await send("checkout.session.async_payment_succeeded", "evt_success")).status).toBe(200);
    expect(db.read(`${path}/orders/current`).status).toBe("paid");
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("queued");
  });
  it("handles repeated event IDs and late pending/failure events without downgrading payment", async () => {
    expect((await send("checkout.session.async_payment_succeeded", "evt_success")).status).toBe(200);
    db.seed(`${path}/jobs/provider_submission_current`, { status: "running" });
    for (const [type, id, payment_status] of [["checkout.session.async_payment_succeeded", "evt_success", "paid"], ["checkout.session.completed", "evt_pending", "unpaid"], ["checkout.session.async_payment_failed", "evt_failed", "unpaid"]]) {
      expect((await send(type, id, { payment_status })).status).toBe(200);
    }
    expect(db.read(`${path}/orders/current`).status).toBe("paid");
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("running");
  });
  it.each(["paid", "published", "failed", "canceled", "refunded"])("preserves %s order and active/terminal job on distinct-event settlement replay", async status => {
    expect((await send("checkout.session.async_payment_succeeded", "evt_first")).status).toBe(200);
    const order = { ...db.read(`${path}/orders/current`), status, billingStatus: status === "refunded" ? "refunded" : "partially_refunded", refundedAmountCents: status === "refunded" ? 1100 : 100 };
    db.seed(`${path}/orders/current`, order);
    const job = { status: status === "refunded" ? "complete" : "running", runToken: "preserve" };
    db.seed(`${path}/jobs/provider_submission_current`, job);
    expect((await send("checkout.session.completed", "evt_distinct")).status).toBe(200);
    expect(db.read(`${path}/orders/current`)).toEqual(order);
    expect(db.read(`${path}/jobs/provider_submission_current`)).toEqual(job);
    expect(db.read("stripeEvents/evt_distinct").duplicateSettlement).toBe(true);
  });
  it("accepts async success after already-paid completion without queuing twice", async () => {
    expect((await send("checkout.session.completed", "evt_first")).status).toBe(200);
    db.seed(`${path}/jobs/provider_submission_current`, { status: "complete" });
    expect((await send("checkout.session.async_payment_succeeded", "evt_second")).status).toBe(200);
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("complete");
  });
  it.each([
    { payment_intent: "pi_other" }, { amount_total: 1200 }, { amount_subtotal: 900 },
    { metadata: { ...session.metadata, priceId: "price_Other" } },
    { metadata: { ...session.metadata, packageId: "authority" } },
    { metadata: { ...session.metadata, checkoutAttempt: "1" } },
    { id: "cs_other" }, { currency: "eur" },
  ])("denies mismatched repeated settlement %#", async changes => {
    expect((await send("checkout.session.async_payment_succeeded", "evt_first")).status).toBe(200);
    const before = db.read(`${path}/orders/current`);
    expect((await send("checkout.session.completed", "evt_changed", changes)).status).toBe(400);
    expect(db.read(`${path}/orders/current`)).toEqual(before);
    expect(db.rows.has("stripeEvents/evt_changed")).toBe(false);
  });
  it("keeps failure bound to its intent and clears customer failure status after valid success", async () => {
    expect((await send("checkout.session.async_payment_failed", "evt_failed", { payment_status: "unpaid" })).status).toBe(200);
    expect(db.read(`${path}/orders/current`)).toMatchObject({ paymentFailureObserved: true, paymentFailureIntentId: "pi_delayed" });
    expect((await send("checkout.session.async_payment_failed", "evt_other_failure", { payment_status: "unpaid", payment_intent: "pi_other" })).status).toBe(400);
    expect((await send("checkout.session.async_payment_succeeded", "evt_wrong_success", { payment_intent: "pi_other" })).status).toBe(400);
    expect((await send("checkout.session.async_payment_succeeded", "evt_success")).status).toBe(200);
    expect(db.read(`${path}/orders/current`).paymentFailureObserved).toBeUndefined();
    expect(db.read(`${path}/orders/current`).paymentFailureIntentId).toBeUndefined();
  });
  it("never queues failed delayed payment", async () => {
    expect((await send("checkout.session.async_payment_failed", "evt_failed", { payment_status: "unpaid" })).status).toBe(200);
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("blocked");
  });
  it.each([
    [{ payment_status: "unpaid" }, {}], [{ livemode: true }, {}], [{}, { livemode: true }],
    [{ metadata: { ...session.metadata, uid: "other" } }, {}], [{ metadata: { ...session.metadata, priceId: "price_Wrong" } }, {}],
    [{ metadata: { ...session.metadata, checkoutAttempt: undefined } }, {}], [{ amount_total: 999 }, {}], [{ mode: "subscription" }, {}],
  ])("rejects invalid success without fulfillment %#", async (changes, eventChanges) => {
    expect((await send("checkout.session.async_payment_succeeded", "evt_bad", changes, eventChanges)).status).toBe(400);
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("blocked");
  });
  it("rejects tampered signatures", async () => {
    expect((await send("checkout.session.async_payment_succeeded", "evt_bad", {}, {}, false)).status).toBe(400);
    expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("blocked");
  });
});

it("rejects contradictory failure snapshots before recording any failure", async () => {
  expect((await send("checkout.session.async_payment_failed", "evt_contradiction")).status).toBe(400);
  expect(db.rows.has("stripeEvents/evt_contradiction")).toBe(false);
  expect(db.read(`${path}/orders/current`).paymentFailureObserved).toBeUndefined();
});
