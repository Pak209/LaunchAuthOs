import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignDigest } from "../lib/campaign-approval";
import { directoryOperationSchema, DirectoryOperationConflict, recordDirectoryOperation, type DirectoryOperationInput } from "../lib/directory-fulfillment";
import { prepareFulfillment } from "../lib/fulfillment";
import type { CampaignDraft } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const projectId = "a".repeat(24);
const workspaceId = "personal_owner";
const projectPath = `workspaces/${workspaceId}/projects/${projectId}`;
const orderPath = `${projectPath}/orders/current`;
const directoryPath = `${projectPath}/directorySubmissions/uneed`;
const now = "2026-09-11T12:00:00.000Z";
const publicUrl = "https://www.uneed.best/tool/acme";
const campaign: CampaignDraft = {
  version: 1, status: "approved", model: "test", generatedAt: now, updatedAt: now,
  assets: [{ id: "release", type: "press_release", title: "Acme Introduces A New Product Today", content: "word ".repeat(300), claimIds: ["approved"], status: "approved" }],
};

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const db = new MemoryFirestore();
  db.seed(projectPath, { createdBy: "owner", profile: { company: "Acme", sourceUrl: "https://acme.example" } });
  db.seed(`${projectPath}/campaigns/current`, campaign);
  db.seed(`${projectPath}/campaignApprovals/current`, { approvedBy: "owner", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
  await prepareFulfillment(db.asFirestore(), "owner", projectId, campaign,
    { provider: "prnow", sandbox: false, nonBillable: false, currency: "usd", providerCostCents: 2175, providerPlan: "standard", requiredCredits: 10 },
    { country: "United States", city: "Boston", categories: ["Technology"], contactName: "Founder", contactEmail: "press@example.com" }, "launch");
  db.seed(orderPath, { ...db.read(orderPath), status: "paid", billingStatus: "paid", stripeLivemode: true });
  let sequence = 0;
  const input = (targetStatus: DirectoryOperationInput["targetStatus"], overrides: Partial<DirectoryOperationInput> = {}): DirectoryOperationInput => ({
    workspaceId, projectId, directoryId: "uneed", requestId: `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`,
    expectedRevision: Number(db.read(directoryPath).revision ?? 0), targetStatus, observedAt: now,
    ...(targetStatus === "submitted" || targetStatus === "published" ? { evidenceUrl: publicUrl } : {}),
    ...(targetStatus === "needs_customer" ? { requiredActions: ["Approve the revised listing copy"] } : {}),
    note: "I matched the directory outcome and customer-authorized approved campaign.", confirmed: true, ...overrides,
  });
  const record = (status: DirectoryOperationInput["targetStatus"], overrides: Partial<DirectoryOperationInput> = {}) => recordDirectoryOperation(db.asFirestore(), "operator", input(status, overrides));
  return { db, input, record };
}

afterEach(() => vi.useRealTimers());

describe("assisted directory operator workflow", () => {
  it("records the queued, submitted, accepted, published lifecycle without creating a verified placement or charging", async () => {
    const f = await fixture();
    const originalOrder = f.db.read(orderPath);
    const originalJob = f.db.read(`${projectPath}/jobs/provider_submission_current`);
    await f.record("queued");
    await f.record("submitted");
    await f.record("accepted");
    expect(await f.record("published")).toMatchObject({ status: "published", revision: 4, recordedAt: now });
    expect(f.db.read(directoryPath)).toMatchObject({
      status: "published", revision: 4, attempt: 1, orderId: "current", campaignDigest: campaignDigest(campaign),
      submissionUrl: publicUrl, listingUrl: publicUrl, evidenceSource: "operator_recorded",
      submittedAt: now, acceptedAt: now, publishedAt: now, operatorRecordedAt: now, requiredActions: [],
    });
    expect(f.db.read(directoryPath).firstVerifiedAt).toBeUndefined();
    expect(f.db.read(directoryPath).indexedAt).toBeUndefined();
    expect(f.db.read(directoryPath).operatorNote).toBeUndefined();
    expect(f.db.read(directoryPath).operatorId).toBeUndefined();
    expect([...f.db.rows.keys()].some((key) => key.includes("/placements/"))).toBe(false);
    expect(f.db.read(orderPath)).toEqual(originalOrder);
    expect(f.db.read(`${projectPath}/jobs/provider_submission_current`)).toEqual(originalJob);
    const audits = [...f.db.rows.values()].filter((row) => row.type === "directory_operation");
    expect(audits).toHaveLength(8); // Immutable receipt + audit log per decision.
    expect(audits.at(-1)).toMatchObject({ actorId: "operator", priorStatus: "accepted", priorRevision: 3, evidenceUrl: publicUrl, observedAt: now, confirmed: true });
  });

  it("allows customer requirements to be clarified without authorizing new paid work", async () => {
    const f = await fixture();
    f.db.seed(orderPath, { ...f.db.read(orderPath), status: "awaiting_payment", billingStatus: "awaiting_payment" });
    await f.record("needs_customer");
    expect(f.db.read(directoryPath)).toMatchObject({ status: "needs_customer", revision: 1, requiredActions: ["Approve the revised listing copy"] });
    await expect(f.record("queued")).rejects.toThrow(/paid order/);
  });

  it("retries rejected work only through a fresh paid queue and keeps old evidence in the audit", async () => {
    const f = await fixture();
    await f.record("queued"); await f.record("submitted"); await f.record("rejected");
    await expect(f.record("submitted")).rejects.toThrow(/Cannot change/);
    await f.record("queued");
    expect(f.db.read(directoryPath).submissionUrl).toBeUndefined();
    expect(f.db.read(directoryPath).rejectedAt).toBeUndefined();
    await f.record("submitted", { evidenceUrl: "https://www.uneed.best/tool/acme-revised" });
    expect(f.db.read(directoryPath)).toMatchObject({ status: "submitted", attempt: 2 });
    expect([...f.db.rows.values()].find((row) => row.type === "directory_operation" && row.priorStatus === "rejected" && row.action === "directory.queued")).toMatchObject({ priorSubmissionUrl: publicUrl, priorAttempt: 1 });
  });

  it("records removal only after publication and retains the prior public listing evidence", async () => {
    const f = await fixture();
    await f.record("queued"); await f.record("submitted");
    await expect(f.record("removed")).rejects.toThrow(/Cannot change/);
    await f.record("published"); await f.record("removed");
    expect(f.db.read(directoryPath)).toMatchObject({ status: "removed", listingUrl: publicUrl, publishedAt: now, removedAt: now });
    await f.record("queued");
    expect(f.db.read(directoryPath).listingUrl).toBeUndefined();
    expect([...f.db.rows.values()].find((row) => row.priorStatus === "removed" && row.action === "directory.queued")).toMatchObject({ priorListingUrl: publicUrl, priorPublishedAt: now, priorRemovedAt: now });
  });

  it("does not let a forged published status bypass the requirement for earlier publication evidence before removal", async () => {
    const f = await fixture();
    f.db.seed(directoryPath, { ...f.db.read(directoryPath), status: "published" });
    await expect(f.record("removed")).rejects.toThrow(/previously published/);
  });

  it.each([
    { status: "awaiting_payment", billingStatus: "awaiting_payment" },
    { status: "canceled" }, { status: "failed" },
    { status: "refunded", billingStatus: "refunded", refundedAmountCents: 9900 },
    { billingStatus: "partially_refunded", refundedAmountCents: 2000 },
    { stripeLivemode: false }, { sandbox: true, nonBillable: false },
  ])("blocks new directory work for ineligible payment state %j", async (change) => {
    const f = await fixture();
    f.db.seed(orderPath, { ...f.db.read(orderPath), ...change });
    await expect(f.record("queued")).rejects.toThrow(DirectoryOperationConflict);
    expect(f.db.read(directoryPath).status).toBe("needs_customer");
  });

  it("requires matching explicit payment mode for sandbox work", async () => {
    const f = await fixture();
    f.db.seed(orderPath, { ...f.db.read(orderPath), sandbox: true, nonBillable: true, stripeLivemode: false });
    await expect(f.record("queued")).resolves.toMatchObject({ status: "queued" });
  });

  it("rechecks payment before recording a submission, even when it was previously queued", async () => {
    const f = await fixture();
    await f.record("queued");
    f.db.seed(orderPath, { ...f.db.read(orderPath), billingStatus: "refunded", refundedAmountCents: 9900 });
    await expect(f.record("submitted")).rejects.toThrow(/paid order/);
  });

  it("preserves historical outcomes and customer billing independently after a refund", async () => {
    const f = await fixture();
    await f.record("queued"); await f.record("submitted");
    f.db.seed(orderPath, { ...f.db.read(orderPath), billingStatus: "refunded", refundedAmountCents: 9900 });
    const refundedOrder = f.db.read(orderPath);
    await f.record("published"); await f.record("removed");
    expect(f.db.read(orderPath)).toEqual(refundedOrder);
    await expect(f.record("queued")).rejects.toThrow(/paid order/);
  });

  it("requires the unchanged owner-attested campaign before manual work can advance", async () => {
    for (const change of ["campaign", "approval"]) {
      const f = await fixture();
      if (change === "campaign") f.db.seed(`${projectPath}/campaigns/current`, { ...campaign, version: 2 });
      else f.db.seed(`${projectPath}/campaignApprovals/current`, { approvedBy: "different-owner", campaignVersion: 1, campaignDigest: campaignDigest(campaign) });
      await expect(f.record("queued")).rejects.toThrow(/campaign|approval/i);
    }
  });

  it("matches workspace ownership, the existing directory, and the bound order", async () => {
    for (const change of ["owner", "missing", "directory", "order"]) {
      const f = await fixture();
      if (change === "owner") f.db.seed(projectPath, { ...f.db.read(projectPath), createdBy: "someone_else" });
      if (change === "missing") f.db.rows.delete(directoryPath);
      if (change === "directory") f.db.seed(directoryPath, { ...f.db.read(directoryPath), directory: "Different directory" });
      if (change === "order") f.db.seed(directoryPath, { ...f.db.read(directoryPath), orderId: "current", campaignDigest: "b".repeat(64), campaignVersion: 1 });
      const input = { workspaceId, projectId, directoryId: "uneed", requestId: "11111111-1111-4111-8111-111111111111", targetStatus: "queued", expectedRevision: 0, observedAt: now, note: "I matched this customer-authorized campaign.", confirmed: true } as DirectoryOperationInput;
      await expect(recordDirectoryOperation(f.db.asFirestore(), "operator", input)).rejects.toThrow(DirectoryOperationConflict);
    }
  });

  it("binds a legacy provisioned record only when its creation time matches the current order", async () => {
    const f = await fixture();
    const legacy = f.db.read(directoryPath);
    delete legacy.orderId; delete legacy.campaignVersion; delete legacy.campaignDigest;
    f.db.seed(directoryPath, { ...legacy, createdAt: "2025-01-01T00:00:00.000Z" });
    await expect(f.record("queued")).rejects.toThrow(/legacy directory task/);
    f.db.seed(directoryPath, legacy);
    await f.record("queued");
    expect(f.db.read(directoryPath)).toMatchObject({ orderId: "current", campaignDigest: campaignDigest(campaign), revision: 1 });
  });

  it("is idempotent and rejects request UUID reuse for different data or another operator", async () => {
    const f = await fixture();
    const input = f.input("queued");
    const first = await recordDirectoryOperation(f.db.asFirestore(), "operator", input);
    await expect(recordDirectoryOperation(f.db.asFirestore(), "operator", input)).resolves.toEqual(first);
    await expect(recordDirectoryOperation(f.db.asFirestore(), "operator", { ...input, note: `${input.note} Changed.` })).rejects.toThrow(/request identifier/);
    await expect(recordDirectoryOperation(f.db.asFirestore(), "other_operator", input)).rejects.toThrow(/another operator/);
    expect(f.db.read(directoryPath).revision).toBe(1);
  });

  it("safely retries a response lost after the transaction committed", async () => {
    const f = await fixture();
    const input = f.input("queued");
    f.db.afterCommit = () => { f.db.afterCommit = undefined; throw new Error("commit response lost"); };
    await expect(recordDirectoryOperation(f.db.asFirestore(), "operator", input)).rejects.toThrow(/response lost/);
    await expect(recordDirectoryOperation(f.db.asFirestore(), "operator", input)).resolves.toMatchObject({ status: "queued", revision: 1 });
    expect([...f.db.rows.keys()].filter((path) => path.includes("/adminOperations/directory_"))).toHaveLength(1);
  });

  it("atomically fences two operators making different decisions at the same revision", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      recordDirectoryOperation(f.db.asFirestore(), "operator_one", f.input("queued", { expectedRevision: 0 })),
      recordDirectoryOperation(f.db.asFirestore(), "operator_two", f.input("failed", { expectedRevision: 0 })),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(f.db.read(directoryPath).revision).toBe(1);
    expect([...f.db.rows.keys()].filter((path) => path.includes("/adminOperations/directory_"))).toHaveLength(1);
  });

  it("does not partly update state when audit persistence fails", async () => {
    const f = await fixture();
    f.db.beforeCommit = () => { throw new Error("database unavailable"); };
    await expect(f.record("queued")).rejects.toThrow(/database unavailable/);
    expect(f.db.read(directoryPath).status).toBe("needs_customer");
    expect([...f.db.rows.keys()].filter((path) => path.includes("/adminOperations/directory_"))).toHaveLength(0);
  });

  it("rejects stale revisions, impossible transitions, and invalid chronology", async () => {
    const f = await fixture();
    await expect(f.record("queued", { expectedRevision: 2 })).rejects.toThrow(/changed/);
    await expect(f.record("published")).rejects.toThrow(/Cannot change/);
    await expect(f.record("queued", { observedAt: "2026-09-11T11:59:00.000Z" })).rejects.toThrow(/observation time/);
    await expect(f.record("queued", { observedAt: "2026-09-12T12:00:00.000Z" })).rejects.toThrow(/observation time/);
    await f.record("queued");
    vi.advanceTimersByTime(60_000);
    await f.record("submitted", { observedAt: "2026-09-11T12:01:00.000Z" });
    await expect(f.record("accepted", { observedAt: now })).rejects.toThrow(/observation time/);
  });

  it("requires explicit attestation, a valid UUID, and public http(s) submission/publication evidence", async () => {
    const f = await fixture();
    const input = f.input("submitted");
    for (const invalid of [
      { confirmed: false }, { note: "short" }, { requestId: "not-a-uuid" }, { evidenceUrl: undefined },
      { evidenceUrl: "javascript:alert(1)" }, { evidenceUrl: "file:///tmp/evidence" }, { evidenceUrl: "https://localhost/a" },
      { evidenceUrl: "http://127.0.0.1/a" }, { evidenceUrl: "http://169.254.169.254/a" },
      { evidenceUrl: "http://[::1]/a" }, { evidenceUrl: "https://example.com@127.0.0.1/a" },
      { evidenceUrl: "https://admin:password@example.com/a" }, { evidenceUrl: "http://service.internal/a" },
      { directoryId: "arbitrary_directory" }, { workspaceId: "../another-project" }, { billingStatus: "paid" },
    ]) expect(directoryOperationSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
    expect(directoryOperationSchema.safeParse({ ...input, targetStatus: "published", evidenceUrl: undefined }).success).toBe(false);
    expect(directoryOperationSchema.safeParse(f.input("needs_customer", { requiredActions: [] })).success).toBe(false);
  });
});

describe("directory operator route boundary", () => {
  it("keeps the write admin-only, same-origin, rate-limited, and independent from billing/submission APIs", () => {
    const route = readFileSync(new URL("../app/api/admin/directories/route.ts", import.meta.url), "utf8");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("requireInternalAdmin()");
    expect(route).toContain("enforceRateLimit(user.uid");
    expect(route).toContain("directoryOperationSchema.parse");
    expect(route).toContain("recordDirectoryOperation(getFirebaseAdminDb(), user.uid, input)");
    expect(route).not.toContain("getStripeClient");
    expect(route).not.toContain(".submit(");
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    expect(rules).toMatch(/match \/directorySubmissions\/\{[^}]+\}\s*\{[^}]*allow write: if false/s);
  });
});
