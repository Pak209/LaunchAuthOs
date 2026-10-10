import { describe, expect, it } from "vitest";
import { supportItem, validSupportReference } from "../lib/support-triage";
describe("read-only human support triage", () => {
  it("prioritizes uncertain dispatch over failed status without exposing payloads", () => {
    const item = supportItem("jobs", "reference", { status: "failed", needsHumanReview: true, lastError: "secret token", submissionInput: { content: "private" } });
    expect(item?.reason).toBe("Outcome needs human reconciliation");
    expect(JSON.stringify(item)).not.toMatch(/secret token|private|submissionInput/);
  });
  it("keeps requested refunds pending and does not invent confirmed outcomes", () => {
    for (const status of ["pending", "submitted", "needs_review"]) expect(supportItem("adminOperations", "ref", { type: "customer_refund", status })?.reason).toBe("Refund confirmation pending");
    expect(supportItem("orders", "ref", { status: "canceled" })).toBeNull();
    expect(supportItem("adminOperations", "ref", { type: "customer_refund", status: "complete" })).toBeNull();
  });
  it("identifies customer input, rejection and failed work only", () => {
    expect(supportItem("directorySubmissions", "ref", { status: "needs_customer" })?.reason).toBe("Customer input required");
    expect(supportItem("directorySubmissions", "ref", { status: "rejected" })?.reason).toBe("Directory rejected");
    expect(supportItem("intelligenceJobs", "ref", { status: "failed" })?.reason).toBe("Work failed");
    expect(supportItem("jobs", "ref", { status: "queued" })).toBeNull();
  });
  it("restricts queue pagination to the exact supported record hierarchy", () => {
    const path = `workspaces/personal_test/projects/${"a".repeat(24)}/jobs/job`;
    expect(validSupportReference("jobs", path)).toBe(true);
    expect(validSupportReference("orders", path)).toBe(false);
    expect(validSupportReference("jobs", "customerMcpLinks/secret")).toBe(false);
    expect(validSupportReference("intelligenceJobs", "workspaces/personal_test/intelligenceJobs/job")).toBe(true);
    expect(validSupportReference("jobs", path + "/nested/secret")).toBe(false);
  });
});
