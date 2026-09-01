import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { markCheckoutPaid, markPaymentIntentRefunded } from "@/lib/fulfillment";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(await request.text(), signature, getStripeWebhookSecret());
    const adminDb = getFirebaseAdminDb();
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const packageId = session.metadata?.packageId;
      const checkoutAttempt = Number(session.metadata?.checkoutAttempt);
      if (session.payment_status !== "paid"
        || !session.metadata?.uid
        || !session.metadata.projectId
        || !session.metadata.priceId
        || (packageId !== "launch" && packageId !== "authority" && packageId !== "authority_plus")
        || !Number.isSafeInteger(checkoutAttempt)
        || checkoutAttempt < 0) {
        throw new Error("The completed checkout is missing paid project metadata.");
      }
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!paymentIntentId) throw new Error("The completed checkout has no payment intent.");
      await markCheckoutPaid(adminDb, {
        uid: session.metadata.uid, projectId: session.metadata.projectId, packageId,
        priceId: session.metadata.priceId, checkoutAttempt,
        eventId: event.id, sessionId: session.id, paymentIntentId,
        amountSubtotal: session.amount_subtotal ?? -1, amountTotal: session.amount_total ?? -1,
        currency: session.currency?.toLowerCase() ?? "", customerEmail: session.customer_details?.email ?? session.customer_email ?? undefined,
      });
    }
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId) await markPaymentIntentRefunded(adminDb, {
        paymentIntentId,
        eventId: event.id,
        amount: charge.amount,
        amountRefunded: charge.amount_refunded,
        currency: charge.currency.toLowerCase(),
        fullyRefunded: charge.refunded,
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
