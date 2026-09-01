import { describe, expect, it } from "vitest";
import { assertCampaignAttestation, campaignDigest } from "../lib/campaign-approval";
import type { CampaignDraft } from "../lib/types";

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
});
