import type Stripe from "stripe";
import type { ProviderOrder } from "./types";
export class CheckoutRecoveryConflict extends Error { readonly status = 409; }
/** Fresh server-retrieved Stripe state, never a browser-supplied recovery assertion. */
export function assertTerminalCheckout(session: Stripe.Checkout.Session, order: ProviderOrder, uid: string, projectId: string) {
  const metadata = session.metadata;
  if (session.id !== order.stripeCheckoutSessionId || session.livemode !== order.expectedStripeLivemode
    || session.mode !== "payment" || session.payment_status !== "unpaid"
    || metadata?.uid !== uid || metadata.projectId !== projectId
    || metadata.packageId !== order.expectedPackageId || metadata.priceId !== order.expectedPriceId
    || metadata.checkoutAttempt !== String(order.checkoutAttempt ?? 0)
    || session.amount_subtotal !== order.expectedAmountSubtotal || session.currency !== order.expectedCurrency) {
    throw new CheckoutRecoveryConflict("The retrieved checkout does not match this unpaid order. Contact support.");
  }
  const pi = session.payment_intent;
  if (pi && typeof pi !== "string") {
    if (pi.livemode !== session.livemode || pi.amount_received !== 0 || pi.currency !== session.currency
      || pi.amount !== session.amount_total || pi.metadata?.uid !== uid || pi.metadata.projectId !== projectId
      || pi.metadata.checkoutAttempt !== metadata.checkoutAttempt || pi.metadata.packageId !== metadata.packageId
      || pi.metadata.priceId !== metadata.priceId) throw new CheckoutRecoveryConflict("Payment state requires support reconciliation.");
    if (pi.status !== "canceled") throw new CheckoutRecoveryConflict("Payment has not reached a terminal closed state. Contact support before trying another payment.");
  } else if (pi || session.status !== "expired") {
    throw new CheckoutRecoveryConflict("Payment closure could not be verified. Contact support before trying another payment.");
  }
  if (session.status !== "expired" && session.status !== "complete") throw new CheckoutRecoveryConflict("This checkout is still open. Resume the existing checkout.");
  return { paymentIntentId: typeof pi === "object" && pi ? pi.id : null, reason: session.status === "expired" ? "expired" : "canceled_payment" };
}
export function checkoutBindingSnapshot(order: ProviderOrder) {
  return { status: "awaiting_payment" as const, sandbox: order.sandbox, nonBillable: order.nonBillable,
    checkoutAttempt: order.checkoutAttempt ?? 0, stripeCheckoutSessionId: order.stripeCheckoutSessionId,
    expectedStripeLivemode: order.expectedStripeLivemode, selectedPackageId: order.selectedPackageId,
    expectedPackageId: order.expectedPackageId, expectedPriceId: order.expectedPriceId,
    expectedAmountSubtotal: order.expectedAmountSubtotal, expectedCurrency: order.expectedCurrency };
}
