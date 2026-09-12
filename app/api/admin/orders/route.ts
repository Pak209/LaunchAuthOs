import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getDistributionProvider } from "@/lib/provider";
import { assertSameOrigin } from "@/lib/request-security";
import { getStripeClient } from "@/lib/stripe";
import type { ProviderOrder } from "@/lib/types";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
    projectId: z.string().regex(/^[a-f0-9]{24}$/),
    action: z.literal("cancel_provider"),
  }),
  z.object({
    workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
    projectId: z.string().regex(/^[a-f0-9]{24}$/),
    action: z.literal("refund_customer"),
    amountCents: z.number().int().positive().optional(),
  }),
]);

export const runtime = "nodejs";

function operationId(prefix: string, order: ProviderOrder, amountCents?: number) {
  return createHash("sha256").update(`${prefix}:${order.stripePaymentIntentId ?? order.externalId}:${order.refundedAmountCents ?? 0}:${amountCents ?? "full"}`).digest("hex").slice(0, 32);
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await requireInternalAdmin();
    if (!isFirebaseAdminExplicitlyConfigured()) throw new Error("Admin operations are not configured.");
    const body = bodySchema.parse(await request.json());
    const db = getFirebaseAdminDb();
    const project = db.doc(`workspaces/${body.workspaceId}/projects/${body.projectId}`);
    const orderRef = project.collection("orders").doc("current");
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const order = orderSnapshot.data() as ProviderOrder;
    const now = new Date().toISOString();

    if (body.action === "cancel_provider") {
      if (!order.externalId || (order.status !== "submitted" && order.status !== "processing")) throw new Error("Only a submitted or processing provider order can be canceled.");
      const operation = project.collection("adminOperations").doc(operationId("provider-cancel", order));
      const existingOperation = await operation.get();
      if (existingOperation.exists) {
        if (existingOperation.data()?.status === "complete") return NextResponse.json({ order: { ...order, status: "canceled" } });
        throw new Error("A prior supplier-cancellation attempt needs manual reconciliation before any retry.");
      }
      await operation.create({ type: "provider_cancel", status: "pending", actorId: user.uid, orderId: order.id, externalId: order.externalId, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
      try {
        const result = await getDistributionProvider(order.provider).cancel(order.externalId);
        if (!result.canceled) throw new Error("The provider did not confirm cancellation. Review the provider dashboard before retrying.");
        const batch = db.batch();
        batch.update(orderRef, { status: "canceled", providerStatusReason: "Canceled by an internal administrator.", updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() });
        batch.set(project.collection("jobs").doc("placement_verification_current"), { status: "complete", lastError: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
        batch.set(operation, { status: "complete", updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
        batch.create(project.collection("auditLogs").doc(), { actorId: user.uid, action: "provider.canceled", targetId: order.externalId, createdAt: FieldValue.serverTimestamp() });
        await batch.commit();
        return NextResponse.json({ order: { ...order, status: "canceled", updatedAt: now } });
      } catch (error) {
        await operation.set({ status: "needs_review", lastError: (error instanceof Error ? error.message : "Provider cancellation failed.").slice(0, 500), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
        throw error;
      }
    }

    if (!order.stripePaymentIntentId || order.billingStatus === "refunded") throw new Error("Only a paid, unrefunded order can be refunded.");
    const alreadyRefunded = order.refundedAmountCents ?? 0;
    const paidAmount = order.amountTotal ?? 0;
    const remaining = paidAmount - alreadyRefunded;
    const amountCents = body.amountCents ?? remaining;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > remaining) throw new Error("The refund amount exceeds the remaining paid balance.");
    const operationKey = operationId("customer-refund", order, body.amountCents);
    const operation = project.collection("adminOperations").doc(operationKey);
    const existingRefund = await operation.get();
    if (existingRefund.exists && (existingRefund.data()?.status === "submitted" || existingRefund.data()?.status === "complete")) {
      return NextResponse.json({ refund: { id: existingRefund.data()?.stripeRefundId, status: existingRefund.data()?.stripeStatus, amount: amountCents }, message: "This refund was already requested. The signed Stripe webhook will finalize billing state." });
    }
    await operation.set({ type: "customer_refund", status: "pending", actorId: user.uid, orderId: order.id, paymentIntentId: order.stripePaymentIntentId, amountCents, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
    try {
      const refund = await getStripeClient().refunds.create({ payment_intent: order.stripePaymentIntentId, amount: amountCents }, { idempotencyKey: `launch-auth-${operationKey}` });
      await operation.set({ status: refund.status === "failed" || refund.status === "canceled" ? "needs_review" : "submitted", stripeRefundId: refund.id, stripeStatus: refund.status, updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
      await project.collection("auditLogs").add({ actorId: user.uid, action: "billing.refund_requested", targetId: order.stripePaymentIntentId, stripeRefundId: refund.id, amountCents, createdAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ refund: { id: refund.id, status: refund.status, amount: refund.amount }, message: "Refund requested. The signed Stripe webhook will finalize billing state." });
    } catch (error) {
      await operation.set({ status: "needs_review", lastError: (error instanceof Error ? error.message : "Customer refund failed.").slice(0, 500), updatedAt: now, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the order.";
    const conflict = message.includes("Only") || message.includes("exceeds") || message.includes("did not confirm") || message.includes("manual reconciliation");
    const status = error instanceof z.ZodError ? 400 : message === "Order not found." || message === "Not found." ? 404 : message.includes("Authentication") ? 401 : conflict ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
