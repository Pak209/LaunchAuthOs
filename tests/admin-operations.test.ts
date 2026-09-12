import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const providerRoute = readFileSync(new URL("../app/api/admin/provider/route.ts", import.meta.url), "utf8");
const orderRoute = readFileSync(new URL("../app/api/admin/orders/route.ts", import.meta.url), "utf8");

describe("internal paid-MVP operations", () => {
  it("keeps the provider preflight internal and non-publishing", () => {
    expect(providerRoute).toContain("requireInternalAdmin()");
    expect(providerRoute).toContain(".preflight(packageId)");
    expect(providerRoute).not.toContain(".submit(");
  });

  it("protects supplier cancellation and customer refunds independently", () => {
    expect(orderRoute).toContain("assertSameOrigin(request)");
    expect(orderRoute).toContain("requireInternalAdmin()");
    expect(orderRoute).toContain('action: z.literal("cancel_provider")');
    expect(orderRoute).toContain('action: z.literal("refund_customer")');
    expect(orderRoute).toContain("getDistributionProvider(order.provider).cancel");
    expect(orderRoute).toContain("getStripeClient().refunds.create");
  });

  it("journals external mutations, uses Stripe idempotency, and leaves final billing to the signed webhook", () => {
    expect(orderRoute).toContain('collection("adminOperations")');
    expect(orderRoute).toContain("prior supplier-cancellation attempt needs manual reconciliation");
    expect(orderRoute).toContain("idempotencyKey: `launch-auth-${operationKey}`");
    expect(orderRoute).toContain("signed Stripe webhook will finalize billing state");
    expect(orderRoute).not.toContain('billingStatus: "refunded"');
  });
});
