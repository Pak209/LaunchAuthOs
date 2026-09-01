import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCampaignAssets } from "../lib/campaign";
import type { BrandProfile, CampaignAssetType, Claim } from "../lib/types";

const claim: Claim = { id: "claim-1", text: "Acme helps small teams launch products.", sourceUrl: "https://acme.example", state: "VERIFIED", approved: true };
const profile: BrandProfile = {
  company: "Acme", product: "Acme Launch", audience: "small teams", positioning: claim.text,
  sourceUrl: "https://acme.example", claims: [claim],
  findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] },
};
const types: CampaignAssetType[] = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"];

function modelPayload(claimId = claim.id) {
  return { output_text: JSON.stringify({ assets: types.map((type) => ({ type, title: type.replaceAll("_", " "), content: `${type} content`, claimIds: [claimId] })) }) };
}

afterEach(() => vi.unstubAllEnvs());

describe("evidence-bounded campaign generation", () => {
  it("refuses generation before all evidence is approved", async () => {
    await expect(generateCampaignAssets(profile, [{ ...claim, approved: false }], "user-1", vi.fn() as never)).rejects.toThrow(/approved/);
  });

  it("requests strict structured output and returns every campaign asset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "test-model");
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.store).toBe(false);
      expect(request.text.format.type).toBe("json_schema");
      expect(request.text.format.strict).toBe(true);
      expect(request.input).toContain(claim.text);
      return Response.json(modelPayload());
    });

    const result = await generateCampaignAssets(profile, [claim], "user-1", fetcher as typeof fetch);

    expect(result.model).toBe("test-model");
    expect(result.assets).toHaveLength(8);
    expect(result.assets.every((asset) => asset.status === "draft" && asset.claimIds[0] === claim.id)).toBe(true);
  });

  it("rejects model output that references unapproved evidence IDs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetcher = vi.fn(async () => Response.json(modelPayload("unknown-claim")));

    await expect(generateCampaignAssets(profile, [claim], "user-1", fetcher as typeof fetch)).rejects.toThrow(/not approved/);
  });
});
