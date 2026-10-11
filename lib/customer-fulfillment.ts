import { assertFrozenPackageContract } from "./package-contract";
import type { FulfillmentState } from "./types";

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as Pick<T, K>;
}
function publicUrl(value: string | undefined) {
  if (!value) return undefined;
  try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    url.search = ""; url.hash = ""; return url.toString(); } catch { return undefined; }
}
/** Deliberate boundary projection: never serialize storage documents to customers. */
export function customerFulfillment(state: FulfillmentState) {
  const order = state.order;
  let contract: NonNullable<typeof order>["packageContract"];
  if (order) {
    try {
      assertFrozenPackageContract(order.packageContract, order.selectedPackageId);
      const mode = order.sandbox === true && order.nonBillable === true ? "sandbox"
        : order.sandbox === false && order.nonBillable === false ? "live" : null;
      if (order.packageContract.environment === mode) contract = order.packageContract;
    } catch { /* Unverified historical entitlement data must never become an agreed package. */ }
  }
  return {
    order: order ? {
      ...pick(order, ["id", "provider", "sandbox", "nonBillable", "currency", "selectedPackageId", "campaignVersion", "status", "billingStatus", "paymentReviewHold", "paymentFailureObserved", "amountSubtotal", "amountTotal", "refundedAmountCents", "refundedAt", "createdAt", "updatedAt"]),
      ...(contract ? { packageContract: pick(contract, ["schemaVersion", "revision", "packageId", "environment", "providerSubmission", "directoryIds"]) } : {}),
    } : null,
    directories: state.directories.map(item => ({
      ...pick(item, ["id", "directory", "mode", "status", "requiredActions", "evidenceSource", "createdAt", "updatedAt", "lastObservedAt", "submittedAt", "acceptedAt", "publishedAt", "rejectedAt", "failedAt", "removedAt"]),
      submissionUrl: publicUrl(item.submissionUrl), listingUrl: publicUrl(item.listingUrl),
    })),
    jobs: state.jobs.map(job => pick(job, ["id", "type", "status", "createdAt", "updatedAt"])),
    placements: (state.placements ?? []).map(item => ({
      ...pick(item, ["id", "outlet", "state", "submittedAt", "publishedAt", "firstVerifiedAt", "lastVerifiedAt", "lastObservedAt", "removedAt"]), url: publicUrl(item.url),
    })),
  };
}
export const customerPrivateHeaders = { "cache-control": "private, no-store" };
export function customerFulfillmentError(status: number) {
  return status === 401 ? "Authentication required." : status === 404 ? "Project not found." : status === 400 ? "Check the supplied project and fulfillment details." : status === 409 ? "Review and approve the current campaign before fulfillment." : status === 429 ? "Too many requests. Please try again later." : status === 503 ? "Fulfillment is not available yet. Contact support for setup status." : "Unable to complete this request. Please retry or contact support.";
}
