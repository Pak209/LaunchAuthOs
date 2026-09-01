import { NextResponse } from "next/server";
import { z } from "zod";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { getAuthenticatedFirebaseContext } from "@/lib/firebase/server";
import { bindCheckoutSession, clearExpiredCheckoutSession, loadFulfillmentState } from "@/lib/fulfillment";
import { loadProject } from "@/lib/persistence";
import { campaignDigest } from "@/lib/campaign-approval";
import { getStripeClient, getStripePriceId, isStripeLiveMode } from "@/lib/stripe";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

const bodySchema = z.object({ packageId: z.enum(["launch", "authority", "authority_plus"]) });

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(projectId)) return NextResponse.json({ error: "Invalid project identifier." }, { status: 400 });
    const { packageId } = bodySchema.parse(await request.json());
    const { db, user } = await getAuthenticatedFirebaseContext();
    await enforceRateLimit(user.uid, "checkout", 5, 3_600);
    if (!user.emailVerified) throw new Error("Verify your email address before checkout.");
    const project = await loadProject(db, user, projectId);
    if (!project?.campaign || project.campaign.status !== "approved") throw new Error("Approve the complete campaign before checkout.");
    if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Server-controlled billing is not configured yet.");
    const adminDb = getFirebaseAdminDb();
    const fulfillment = await loadFulfillmentState(adminDb, user.uid, projectId);
    if (!fulfillment.order || fulfillment.order.status !== "awaiting_payment") throw new Error("Prepare an eligible fulfillment order before checkout.");
    if (fulfillment.order.nonBillable && isStripeLiveMode()) throw new Error("Live checkout is disabled while the provider order is non-billable sandbox fulfillment.");
    if (project.campaign.version !== fulfillment.order.campaignVersion
      || campaignDigest(project.campaign) !== fulfillment.order.campaignDigest) {
      throw new Error("The campaign changed after fulfillment was prepared. Prepare a new approved order before checkout.");
    }
    const stripe = getStripeClient();
    let checkoutAttempt = fulfillment.order.checkoutAttempt ?? 0;
    if (fulfillment.order.stripeCheckoutSessionId) {
      if (fulfillment.order.expectedPackageId !== packageId) throw new Error("A checkout session for another package is already active.");
      const existing = await stripe.checkout.sessions.retrieve(fulfillment.order.stripeCheckoutSessionId);
      if (existing.status === "open" && existing.url) return NextResponse.json({ url: existing.url });
      if (existing.status === "complete") throw new Error("Payment is already being processed for this order.");
      checkoutAttempt = await clearExpiredCheckoutSession(adminDb, user.uid, projectId, existing.id);
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const priceId = getStripePriceId(packageId);
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.type !== "one_time" || price.unit_amount == null) throw new Error("The selected Stripe price is not an active one-time package.");
    if (price.currency !== fulfillment.order.currency) throw new Error("The selected Stripe price currency does not match the fulfillment order.");
    const metadata = { uid: user.uid, projectId, packageId, priceId, checkoutAttempt: String(checkoutAttempt) };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      customer_creation: "always",
      customer_email: user.email ?? undefined,
      client_reference_id: `${user.uid}:${projectId}`,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/?checkout=success&project=${projectId}`,
      cancel_url: `${origin}/?checkout=canceled&project=${projectId}`,
    }, { idempotencyKey: `checkout_${user.uid}_${projectId}_${checkoutAttempt}_${packageId}` });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    await bindCheckoutSession(adminDb, {
      uid: user.uid,
      projectId,
      sessionId: session.id,
      packageId,
      priceId,
      amountSubtotal: price.unit_amount,
      currency: price.currency,
      checkoutAttempt,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start checkout.";
    const status = error instanceof RateLimitError ? 429 : error instanceof z.ZodError ? 400 : message.includes("Authentication") ? 401 : message.includes("configured") ? 503 : message.includes("Approve") || message.includes("eligible") || message.includes("disabled") || message.includes("Verify") ? 409 : 500;
    return NextResponse.json({ error: message }, { status, headers: error instanceof RateLimitError ? { "retry-after": String(error.retryAfterSeconds) } : undefined });
  }
}
