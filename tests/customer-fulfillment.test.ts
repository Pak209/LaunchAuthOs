import { resolvePackageContract } from "../lib/package-contract";
import { describe, expect, it } from "vitest";
import { customerFulfillment, customerFulfillmentError, customerPrivateHeaders } from "../lib/customer-fulfillment";
import type { FulfillmentState } from "../lib/types";
describe("customer fulfillment boundary", () => {
  it("allowlists storage fields and removes provider internals, raw errors and credential URL data", () => {
    const secret = "PRIVATE_TOKEN";
    const result = customerFulfillment({ order: { id: "current", status: "paid", amountTotal: 1234, providerCostCents: secret, submissionInput: secret, providerStatusReason: secret, externalId: secret, stripePaymentIntentId: secret, packageContract: { revision: "v1", directoryIds: ["uneed"], priceId: secret, digest: secret } }, jobs: [{ id: "job", status: "failed", runToken: secret, lastError: secret, idempotencyKey: secret }], directories: [{ id: "uneed", status: "published", operatorNote: secret, listingUrl: `https://example.com/listing?token=${secret}#${secret}` }], placements: [{ id: "one", url: `https://user:${secret}@example.com/`, state: "failed", lastVerificationError: secret }] } as unknown as FulfillmentState);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.order).toMatchObject({ status: "paid", amountTotal: 1234 });
    expect(result.directories[0].listingUrl).toBe("https://example.com/listing");
    expect(result.placements[0].url).toBeUndefined();
    expect(result.jobs[0]).toEqual({ id: "job", status: "failed" });
  });
  it("marks customer responses noncacheable and uses fixed errors", () => {
    expect(customerPrivateHeaders["cache-control"]).toBe("private, no-store");
    expect(customerFulfillmentError(500)).toContain("contact support");
  });
});


describe("customer frozen contract truth", () => {
  const valid = resolvePackageContract("launch", { sandbox: true, nonBillable: true });
  const state = (contract: unknown, extra = {}) => ({ order: { selectedPackageId: "launch", sandbox: true, nonBillable: true, packageContract: contract, ...extra }, jobs: [], directories: [] }) as unknown as FulfillmentState;
  it("projects only a verified matching contract", () => {
    expect(customerFulfillment(state(valid)).order?.packageContract).toMatchObject({ packageId: "launch", environment: "sandbox" });
  });
  it.each([
    [{ ...valid, digest: "0".repeat(64) }, {}],
    [valid, { selectedPackageId: "authority" }],
    [valid, { sandbox: false, nonBillable: false }],
    [valid, { sandbox: true, nonBillable: false }],
    [{ ...valid, directoryIds: "uneed" }, {}],
    [{ environment: "sandbox" }, {}],
  ])("omits invalid contract without throwing", (contract, extra) => {
    expect(customerFulfillment(state(contract, extra)).order?.packageContract).toBeUndefined();
  });
});
