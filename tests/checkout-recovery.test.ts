import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { assertTerminalCheckout } from "../lib/checkout-recovery";
import { clearExpiredCheckoutSession, markCheckoutPaid, markCheckoutFailed, bindCheckoutSession } from "../lib/fulfillment";
import type { ProviderOrder } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";
const uid = "owner", projectId = "a".repeat(24), path = `workspaces/personal_${uid}/projects/${projectId}`;
const metadata = { uid, projectId, packageId: "launch", priceId: "price_Test", checkoutAttempt: "0" };
const order = { status: "awaiting_payment", sandbox: true, nonBillable: true, stripeCheckoutSessionId: "cs_old", expectedStripeLivemode: false, checkoutAttempt: 0, selectedPackageId: "launch", expectedPackageId: "launch", expectedPriceId: "price_Test", expectedAmountSubtotal: 100, expectedCurrency: "usd" } as ProviderOrder;
const session = { id: "cs_old", status: "expired", mode: "payment", payment_status: "unpaid", livemode: false, metadata, amount_subtotal: 100, amount_total: 100, currency: "usd", payment_intent: null } as unknown as Stripe.Checkout.Session;
const pi = { id: "pi_old", status: "canceled", amount_received: 0, amount: 100, currency: "usd", livemode: false, metadata };
const payment = { uid, projectId, packageId: "launch" as const, sessionId: "cs_old", paymentIntentId: "pi_old", checkoutAttempt: 0, priceId: "price_Test", amountSubtotal: 100, amountTotal: 100, currency: "usd", livemode: false, eventId: "evt_success" };
function fixture() {
  const db = new MemoryFirestore(); db.seed(path, { createdBy: uid }); db.seed(`${path}/orders/current`, order); db.seed(`${path}/jobs/provider_submission_current`, { status: "blocked" }); return db;
}
describe("terminal-only Checkout recovery", () => {
  it("accepts expired unpaid with no intent, and canceled zero-received intent", () => {
    expect(assertTerminalCheckout(session, order, uid, projectId).reason).toBe("expired");
    expect(assertTerminalCheckout({ ...session, status: "complete", payment_intent: pi } as unknown as Stripe.Checkout.Session, order, uid, projectId).reason).toBe("canceled_payment");
  });
  it.each([
    { ...pi, status: "requires_payment_method", last_payment_error: { code: "failure" } },
    { ...pi, status: "processing" }, { ...pi, amount_received: 1 }, { ...pi, livemode: true },
    { ...pi, metadata: { ...metadata, uid: "other" } }, { ...pi, amount: 200 }, "pi_unexpanded", null,
  ])("rejects nonterminal or mismatched completed intents %#", payment_intent => {
    expect(() => assertTerminalCheckout({ ...session, status: "complete", payment_intent } as unknown as Stripe.Checkout.Session, order, uid, projectId)).toThrow();
  });
  it("retains original binding and advances once even when retry is repeated", async () => {
    const db = fixture();
    expect(await clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", session)).toBe(1);
    expect(db.read(`${path}/checkoutAttempts/0`)).toMatchObject({ stripeCheckoutSessionId: "cs_old", expectedPriceId: "price_Test", reason: "expired" });
    await expect(clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", session)).rejects.toThrow();
    expect(db.read(`${path}/orders/current`).checkoutAttempt).toBe(1);
  });
  it("records signed failure, requires it for canceled completed retry, and never treats failure alone as terminal", async () => {
    const db = fixture(); const complete = { ...session, status: "complete", payment_intent: pi } as unknown as Stripe.Checkout.Session;
    await expect(clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", complete)).rejects.toThrow(/failed-payment/);
    await markCheckoutFailed(db.asFirestore(), { ...payment, eventId: "evt_failed" });
    expect(db.read(`${path}/orders/current`).paymentFailureObserved).toBe(true);
    await expect(clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", { ...complete, payment_intent: { ...pi, status: "requires_payment_method" } } as unknown as Stripe.Checkout.Session)).rejects.toThrow(/terminal/);
    expect(await clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", complete)).toBe(1);
  });
  it("puts contradictory superseded success on durable hold instead of fulfilling", async () => {
    const db = fixture(); await clearExpiredCheckoutSession(db.asFirestore(), uid, projectId, "cs_old", session);
    await markCheckoutPaid(db.asFirestore(), payment);
    expect(db.read(`${path}/orders/current`)).toMatchObject({ status: "awaiting_payment", paymentReviewHold: true });
    expect(db.read(`${path}/jobs/provider_submission_current`)).toMatchObject({ status: "blocked", needsHumanReview: true });
    await markCheckoutPaid(db.asFirestore(), payment);
    expect(db.read(`${path}/orders/current`).checkoutAttempt).toBe(1);
  });
  it("rejects rollover after settlement and rejects binding once held", async () => {
    const paid = fixture(); await markCheckoutPaid(paid.asFirestore(), payment);
    await expect(clearExpiredCheckoutSession(paid.asFirestore(), uid, projectId, "cs_old", session)).rejects.toThrow(/no longer current/);
    const held = fixture(); await clearExpiredCheckoutSession(held.asFirestore(), uid, projectId, "cs_old", session);
    await markCheckoutPaid(held.asFirestore(), payment);
    await expect(bindCheckoutSession(held.asFirestore(), { ...payment, sessionId: "cs_new", checkoutAttempt: 1 })).rejects.toThrow(/reconciliation/);
  });
  it("does not record failures belonging to another customer or mode", async () => {
    const db = fixture();
    await expect(markCheckoutFailed(db.asFirestore(), { ...payment, uid: "other" })).rejects.toThrow();
    await expect(markCheckoutFailed(db.asFirestore(), { ...payment, livemode: true })).rejects.toThrow();
    expect(db.read(`${path}/orders/current`).paymentFailureObserved).toBeUndefined();
  });
});
