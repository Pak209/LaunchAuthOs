import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getStripeClient, getStripePriceId, getStripeWebhookSecret, isStripeLiveMode } from "../lib/stripe";
import { assertPaidCheckoutMatchesOrder, assertRefundMatchesOrder, type PaidCheckout, type RefundedPayment } from "../lib/fulfillment";
import type { ProviderOrder } from "../lib/types";

const checkoutRoute = readFileSync(new URL("../app/api/projects/[projectId]/checkout/route.ts", import.meta.url), "utf8");
const webhookRoute = readFileSync(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");

const order: ProviderOrder = {
  id: "current",
  provider: "example-provider",
  sandbox: false,
  nonBillable: false,
  providerCostCents: 2_000,
  currency: "usd",
  campaignVersion: 3,
  campaignDigest: "a".repeat(64),
  status: "awaiting_payment",
  checkoutAttempt: 2,
  stripeCheckoutSessionId: "cs_test_expected",
  expectedStripeLivemode: true,
  stripeLivemode: true,
  expectedPackageId: "authority",
  selectedPackageId: "authority",
  expectedPriceId: "price_Example123",
  expectedAmountSubtotal: 9_900,
  expectedCurrency: "usd",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const paidCheckout: PaidCheckout = {
  livemode: true,
  uid: "user_123",
  projectId: "0123456789abcdef01234567",
  eventId: "evt_test_123",
  sessionId: "cs_test_expected",
  paymentIntentId: "pi_test_123",
  packageId: "authority",
  priceId: "price_Example123",
  amountSubtotal: 9_900,
  amountTotal: 10_791,
  currency: "usd",
  checkoutAttempt: 2,
};

const refund: RefundedPayment = {
  livemode: true,
  paymentIntentId: "pi_test_123",
  eventId: "evt_refund_123",
  amount: 10_791,
  amountRefunded: 4_000,
  currency: "usd",
  fullyRefunded: false,
};

afterEach(() => vi.unstubAllEnvs());

describe("Stripe billing boundary", () => {
  it("requires server-side keys, prices, and webhook signing secrets", () => {
    expect(() => getStripeClient()).toThrow(/not configured/);
    expect(() => getStripePriceId("launch")).toThrow(/not configured/);
    expect(() => getStripeWebhookSecret()).toThrow(/not configured/);
  });

  it("distinguishes live from test mode without exposing the secret", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_example");
    expect(isStripeLiveMode()).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
    expect(isStripeLiveMode()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_example");
    expect(isStripeLiveMode()).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_example");
    expect(isStripeLiveMode()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "unknown_key");
    expect(() => isStripeLiveMode()).toThrow(/mode cannot be determined/);
  });

  it("gates checkout on campaign approval, fulfillment eligibility, and live provider billing", () => {
    expect(checkoutRoute).toContain('project.campaign.status !== "approved"');
    expect(checkoutRoute).toContain("!user.emailVerified");
    expect(checkoutRoute).toContain('fulfillment.order.status !== "awaiting_payment"');
    expect(checkoutRoute).toContain("fulfillment.order.nonBillable && isStripeLiveMode()");
    expect(checkoutRoute).toContain('price.type !== "one_time"');
    expect(checkoutRoute).toContain("automatic_tax: { enabled: true }");
    expect(checkoutRoute).toContain("bindCheckoutSession");
    expect(checkoutRoute).toContain("campaignDigest(project.campaign)");
  });

  it("verifies webhook signatures before changing paid state", () => {
    expect(webhookRoute).toContain("stripe.webhooks.constructEvent");
    expect(webhookRoute).toContain("getStripeWebhookSecret()");
    expect(webhookRoute).toContain('session.payment_status !== "paid"');
    expect(webhookRoute).toContain("markCheckoutPaid");
    expect(webhookRoute).toContain("session.amount_subtotal");
    expect(webhookRoute).toContain("charge.amount_refunded");
  });

  it("accepts only the exact server-bound checkout", () => {
    expect(() => assertPaidCheckoutMatchesOrder(order, paidCheckout)).not.toThrow();
  });

  it.each([
    ["session", { sessionId: "cs_test_other" }],
    ["package", { packageId: "launch" as const }],
    ["price", { priceId: "price_Other456" }],
    ["subtotal", { amountSubtotal: 9_901 }],
    ["currency", { currency: "eur" }],
    ["attempt", { checkoutAttempt: 3 }],
    ["mode", { livemode: false }],
  ])("rejects a paid checkout with a mismatched %s", (_label, override) => {
    expect(() => assertPaidCheckoutMatchesOrder(order, { ...paidCheckout, ...override })).toThrow(/does not match/);
  });

  it("rejects a duplicate or no-longer-payable order transition", () => {
    expect(() => assertPaidCheckoutMatchesOrder({ ...order, status: "paid" }, paidCheckout)).toThrow(/does not match/);
  });

  it("rejects payment when the prepared supplier package differs from checkout", () => {
    expect(() => assertPaidCheckoutMatchesOrder({ ...order, selectedPackageId: "launch" }, paidCheckout)).toThrow(/does not match/);
    expect(checkoutRoute).toContain("fulfillment.order.selectedPackageId !== packageId");
  });

  it("never authorizes live fulfillment with a test payment or live payment for a sandbox order", () => {
    expect(() => assertPaidCheckoutMatchesOrder({ ...order, expectedStripeLivemode: false }, { ...paidCheckout, livemode: false })).toThrow(/does not match/);
    expect(() => assertPaidCheckoutMatchesOrder({ ...order, sandbox: true, nonBillable: true }, paidCheckout)).toThrow(/does not match/);
    expect(() => assertPaidCheckoutMatchesOrder({ ...order, sandbox: true, nonBillable: true, expectedStripeLivemode: false }, { ...paidCheckout, livemode: false })).not.toThrow();
  });

  it("reconciles cumulative partial and full refunds with the original charge", () => {
    const paidOrder = { ...order, status: "submitted" as const, stripePaymentIntentId: refund.paymentIntentId, amountTotal: refund.amount };
    expect(() => assertRefundMatchesOrder(paidOrder, refund)).not.toThrow();
    expect(() => assertRefundMatchesOrder(paidOrder, { ...refund, amountRefunded: refund.amount, fullyRefunded: true })).not.toThrow();
    expect(() => assertRefundMatchesOrder(paidOrder, { ...refund, currency: "eur" })).toThrow(/does not match/);
    expect(() => assertRefundMatchesOrder(paidOrder, { ...refund, amountRefunded: refund.amount, fullyRefunded: false })).toThrow(/does not match/);
    expect(() => assertRefundMatchesOrder(paidOrder, { ...refund, amount: refund.amount + 1 })).toThrow(/does not match/);
  });
});
