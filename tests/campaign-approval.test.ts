import { describe, expect, it } from "vitest";
import { assertCampaignAttestation, attestCampaignApproval, campaignDigest } from "../lib/campaign-approval";
import type { CampaignDraft } from "../lib/types";
import { MemoryFirestore } from "./helpers/memory-firestore";

const campaign: CampaignDraft = {
  version: 4,
  status: "approved",
  model: "test-model",
  generatedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:01:00.000Z",
  assets: [{
    id: "press-release",
    type: "press_release",
    title: "Acme launches",
    content: "Acme launches a source-backed product.",
    claimIds: ["claim-1"],
    status: "approved",
  }],
};

describe("server-owned campaign approval", () => {
  it("produces a deterministic digest of fulfillment-relevant content", () => {
    expect(campaignDigest(campaign)).toBe(campaignDigest({ ...campaign, updatedAt: "later" }));
    expect(campaignDigest({ ...campaign, version: 5 })).not.toBe(campaignDigest(campaign));
    expect(campaignDigest({
      ...campaign,
      assets: campaign.assets.map((asset) => ({ ...asset, content: `${asset.content} Updated.` })),
    })).not.toBe(campaignDigest(campaign));
  });

  it("accepts only an approval attestation for the same owner, version, and content", () => {
    const approval = { campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), approvedBy: "user-1" };
    expect(() => assertCampaignAttestation(campaign, approval, "user-1")).not.toThrow();
    expect(() => assertCampaignAttestation(campaign, { ...approval, approvedBy: "user-2" }, "user-1")).toThrow(/missing|matches/);
    expect(() => assertCampaignAttestation(campaign, { ...approval, campaignVersion: 3 }, "user-1")).toThrow(/missing|matches/);
    expect(() => assertCampaignAttestation(campaign, { ...approval, campaignDigest: "0".repeat(64) }, "user-1")).toThrow(/missing|matches/);
  });

  it("refuses draft campaigns even if an attestation-shaped object exists", () => {
    const draft = { ...campaign, status: "draft" as const };
    const approval = { campaignVersion: draft.version, campaignDigest: campaignDigest(draft), approvedBy: "user-1" };
    expect(() => assertCampaignAttestation(draft, approval, "user-1")).toThrow(/Approve/);
  });

  it("attests the exact saved approved version inside a transaction", async () => {
    const db = new MemoryFirestore();
    const projectPath = `workspaces/personal_user-1/projects/${"a".repeat(24)}`;
    db.seed(projectPath, { createdBy: "user-1" });
    db.seed(`${projectPath}/campaigns/current`, campaign);
    const result = await attestCampaignApproval(db.asFirestore(), "user-1", "a".repeat(24), campaign);
    expect(result).toEqual({ campaignVersion: campaign.version, campaignDigest: campaignDigest(campaign), approvedBy: "user-1" });
    expect(db.read(`${projectPath}/campaignApprovals/current`)).toMatchObject(result);
    expect([...db.rows.keys()].filter((path) => path.includes("/auditLogs/"))).toHaveLength(1);
  });

  it.each(["restored-draft", "new-version", "changed-content", "draft-asset", "missing-current"])("does not re-attest stale approval after %s", async (scenario) => {
    const db = new MemoryFirestore();
    const projectPath = `workspaces/personal_user-1/projects/${"a".repeat(24)}`;
    db.seed(projectPath, { createdBy: "user-1" });
    if (scenario !== "missing-current") db.seed(`${projectPath}/campaigns/current`, {
      ...campaign,
      ...(scenario === "restored-draft" ? { version: 5, status: "draft" } : {}),
      ...(scenario === "new-version" ? { version: 5 } : {}),
      ...(scenario === "changed-content" ? { assets: campaign.assets.map((asset) => ({ ...asset, content: "A subsequent customer edit" })) } : {}),
      ...(scenario === "draft-asset" ? { assets: campaign.assets.map((asset) => ({ ...asset, status: "draft" })) } : {}),
    });
    const revoked = { status: "revoked", reason: "campaign_restored" };
    db.seed(`${projectPath}/campaignApprovals/current`, revoked);
    await expect(attestCampaignApproval(db.asFirestore(), "user-1", "a".repeat(24), campaign)).rejects.toThrow("no longer matches");
    expect(db.read(`${projectPath}/campaignApprovals/current`)).toEqual(revoked);
    expect([...db.rows.keys()].filter((path) => path.includes("/auditLogs/"))).toHaveLength(0);
  });

  it("does not attest another customer's project", async () => {
    const db = new MemoryFirestore();
    const projectPath = `workspaces/personal_user-1/projects/${"a".repeat(24)}`;
    db.seed(projectPath, { createdBy: "someone-else" });
    db.seed(`${projectPath}/campaigns/current`, campaign);
    await expect(attestCampaignApproval(db.asFirestore(), "user-1", "a".repeat(24), campaign)).rejects.toThrow("not found");
    expect(db.rows.has(`${projectPath}/campaignApprovals/current`)).toBe(false);
  });

  it.each(["awaiting_payment", "paid", "submitted", "published", "canceled", "refunded"])("does not replace approval or audit after an order exists: %s", async (status) => {
    const db = new MemoryFirestore();
    const projectPath = `workspaces/personal_user-1/projects/${"a".repeat(24)}`;
    const approval = { campaignVersion: 4, campaignDigest: campaignDigest(campaign), approvedBy: "user-1", approvedAt: "original" };
    db.seed(projectPath, { createdBy: "user-1" });
    db.seed(`${projectPath}/campaigns/current`, campaign);
    db.seed(`${projectPath}/orders/current`, { status });
    db.seed(`${projectPath}/campaignApprovals/current`, approval);
    await expect(attestCampaignApproval(db.asFirestore(), "user-1", "a".repeat(24), campaign)).rejects.toThrow("fulfillment order");
    expect(db.read(`${projectPath}/campaignApprovals/current`)).toEqual(approval);
    expect([...db.rows.keys()].filter((path) => path.includes("/auditLogs/"))).toHaveLength(0);
  });

  it.each(["campaignStatus", "lifecycleStatus"])("respects a legacy %s fulfillment lock even without an order", async (field) => {
    const db = new MemoryFirestore();
    const projectPath = `workspaces/personal_user-1/projects/${"a".repeat(24)}`;
    db.seed(projectPath, { createdBy: "user-1", [field]: "fulfillment" });
    db.seed(`${projectPath}/campaigns/current`, campaign);
    await expect(attestCampaignApproval(db.asFirestore(), "user-1", "a".repeat(24), campaign)).rejects.toThrow("fulfillment order");
    expect(db.rows.has(`${projectPath}/campaignApprovals/current`)).toBe(false);
  });
});
