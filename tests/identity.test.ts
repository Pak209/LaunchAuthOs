import { validateHeaderValue } from "node:http";
import { checkoutIdempotencyKey } from "../lib/stripe";
import { expect, it, vi, afterEach } from "vitest";
import { isSafeUid, isSafeWorkspaceId } from "../lib/identity";
import { assertDeploymentAccess } from "../lib/deployment-access";
import { CompanionService } from "../lib/companion/service";
import { emptyBrief } from "../lib/companion/model";
import { markCheckoutPaid, loadFulfillmentState } from "../lib/fulfillment";
import { directoryOperationSchema } from "../lib/directory-fulfillment";
import { reconciliationSchema } from "../lib/provider-reconciliation";
import { validSupportReference } from "../lib/support-triage";
import { MemoryFirestore } from "./helpers/memory-firestore";
const projectId = "b".repeat(24);
afterEach(() => vi.unstubAllEnvs());
it.each(["customer.example", "客户.é", "a".repeat(128)])("preserves safe custom UID %s through creation, payment, and operator schemas", async uid => {
  const db = new MemoryFirestore(), path = `workspaces/personal_${uid}/projects/${projectId}`;
  vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "standard");
  await expect(assertDeploymentAccess(uid)).resolves.toBeUndefined();
  await new CompanionService(db.asFirestore()).saveBrief(uid, projectId, { expectedRevision: 0, brief: { ...emptyBrief, company: "Synthetic customer" } }, true);
  db.seed(`${path}/orders/current`, { status: "awaiting_payment", sandbox: true, nonBillable: true, checkoutAttempt: 0, stripeCheckoutSessionId: "cs_custom", expectedStripeLivemode: false, selectedPackageId: "launch", expectedPackageId: "launch", expectedPriceId: "price_Test", expectedAmountSubtotal: 1000, expectedCurrency: "usd" });
  db.seed(`${path}/jobs/provider_submission_current`, { status: "blocked" });
  await markCheckoutPaid(db.asFirestore(), { uid, projectId, sessionId: "cs_custom", paymentIntentId: "pi_custom", eventId: "evt_custom", checkoutAttempt: 0, livemode: false, packageId: "launch", priceId: "price_Test", amountSubtotal: 1000, amountTotal: 1000, currency: "usd" });
  expect(db.read(`${path}/orders/current`).status).toBe("paid");
  expect(db.read(`${path}/jobs/provider_submission_current`).status).toBe("queued");
  expect(directoryOperationSchema.shape.workspaceId.parse(`personal_${uid}`)).toBe(`personal_${uid}`);
  expect(reconciliationSchema.shape.workspaceId.parse(`personal_${uid}`)).toBe(`personal_${uid}`);
  expect(validSupportReference("orders", `${path}/orders/current`)).toBe(true);
});
it.each(["", "bad/id", "bad\u0000id", "bad\u007fid", "bad\u0085id", ".", "..", "__reserved__", "a".repeat(129)])("rejects unsafe UID before onboarding or payment storage: %j", async uid => {
  expect(isSafeUid(uid)).toBe(false); expect(isSafeWorkspaceId(`personal_${uid}`)).toBe(false);
  vi.stubEnv("DEPLOYMENT_ACCESS_MODE", "standard");
  await expect(assertDeploymentAccess(uid)).rejects.toThrow("Authentication required");
  const db = new MemoryFirestore();
  await expect(new CompanionService(db.asFirestore()).saveBrief(uid, projectId, { expectedRevision: 0, brief: emptyBrief }, true)).rejects.toThrow();
  await expect(markCheckoutPaid(db.asFirestore(), { uid, projectId } as any)).rejects.toThrow("checkout metadata");
  await expect(loadFulfillmentState(db.asFirestore(), uid, projectId)).rejects.toThrow("Invalid project identifier");
  expect(directoryOperationSchema.shape.workspaceId.safeParse(`personal_${uid}`).success).toBe(false);
  expect(reconciliationSchema.shape.workspaceId.safeParse(`personal_${uid}`).success).toBe(false);
  expect(db.rows.size).toBe(0);
});

it("encodes Unicode checkout identity for HTTP without changing existing ASCII idempotency keys", () => {
  const key = checkoutIdempotencyKey("客户.é", projectId, 0, "launch");
  expect(() => validateHeaderValue("Idempotency-Key", key)).not.toThrow();
  expect(key).toBe(checkoutIdempotencyKey("客户.é", projectId, 0, "launch"));
  expect(key).not.toBe(checkoutIdempotencyKey("客户.é", projectId, 1, "launch"));
  expect(key).not.toBe(checkoutIdempotencyKey("客户.e", projectId, 0, "launch"));
  expect(checkoutIdempotencyKey("customer.example", projectId, 0, "launch")).toBe(`checkout_customer.example_${projectId}_0_launch`);
});
