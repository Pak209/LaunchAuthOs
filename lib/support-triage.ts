import { isSafeWorkspaceId } from "./identity";
export const supportCollections = ["jobs", "intelligenceJobs", "directorySubmissions", "orders", "adminOperations"] as const;
export type SupportCollection = typeof supportCollections[number];
export type SupportItem = { reference: string; reason: string; nextStep: string };
// Whitelist metadata only. Never copy lastError, source text, tokens or provider payloads.
export function supportItem(collection: SupportCollection, reference: string, data: Record<string, unknown>): SupportItem | null {
  const item = (reason: string, nextStep: string) => ({ reference, reason, nextStep });
  if (data.paymentReviewHold === true || data.paymentFailureObserved === true)
    return item("Payment needs reconciliation", "Verify the saved Checkout attempt and current Stripe payment state before retry. Do not initiate a refund or a second payment without reconciliation.");
  if (data.needsHumanReview === true || data.providerSubmissionUncertain === true)
    return item("Outcome needs human reconciliation", "Inspect the existing reconciliation workflow. Confirm supplier acceptance before authorizing a retry.");
  if (collection === "directorySubmissions" && data.status === "needs_customer")
    return item("Customer input required", "Review the directory task and its required actions with the customer through an approved support channel.");
  if (collection === "directorySubmissions" && data.status === "rejected")
    return item("Directory rejected", "Review recorded evidence; do not promise resubmission or a refund.");
  if (collection === "adminOperations" && data.type === "customer_refund" && ["pending", "submitted", "needs_review"].includes(String(data.status)))
    return item("Refund confirmation pending", "Reconcile Stripe webhook/payment state. A requested refund is not a confirmed refund.");
  if (data.status === "failed") return item("Work failed", "Review the authenticated operations record. Check dispatch and payment state before retrying.");
  return null;
}
export function validSupportReference(collection: SupportCollection, path: string) {
  const parts = path.split("/");
  if (parts[0] !== "workspaces" || !isSafeWorkspaceId(parts[1])) return false;
  const segment = /^[A-Za-z0-9_-]{1,160}$/;
  return collection === "intelligenceJobs"
    ? parts.length === 4 && parts[2] === collection && segment.test(parts[3])
    : parts.length === 6 && parts[2] === "projects" && /^[a-f0-9]{24}$/.test(parts[3]) && parts[4] === collection && segment.test(parts[5]);
}
