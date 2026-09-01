import { createHash } from "node:crypto";
import { z } from "zod";
import type { BrandProfile, CampaignAssetType, Claim, GeneratedCampaignAsset } from "./types";

const assetTypes = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"] as const;
const generatedAssetSchema = z.object({
  type: z.enum(assetTypes),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(30_000),
  claimIds: z.array(z.string().min(1).max(160)).min(1).max(100),
});
const generatedResponseSchema = z.object({ assets: z.array(generatedAssetSchema).length(assetTypes.length) });

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      minItems: assetTypes.length,
      maxItems: assetTypes.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "content", "claimIds"],
        properties: {
          type: { type: "string", enum: assetTypes },
          title: { type: "string" },
          content: { type: "string" },
          claimIds: { type: "array", minItems: 1, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("The model returned an unreadable campaign response.");
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string" && response.output_text) return response.output_text;
  const text = response.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("The model returned no campaign content.");
  return text;
}

function assertEvidenceBounded(assets: Array<z.infer<typeof generatedAssetSchema>>, claims: Claim[]) {
  const approvedIds = new Set(claims.filter((claim) => claim.approved).map((claim) => claim.id));
  const returnedTypes = new Set<CampaignAssetType>();
  for (const asset of assets) {
    if (returnedTypes.has(asset.type)) throw new Error(`The model returned duplicate ${asset.type} assets.`);
    returnedTypes.add(asset.type);
    if (asset.claimIds.some((claimId) => !approvedIds.has(claimId))) {
      throw new Error("The model referenced evidence that was not approved.");
    }
  }
  if (assetTypes.some((type) => !returnedTypes.has(type))) throw new Error("The model did not return every required campaign asset.");
}

export async function generateCampaignAssets(
  profile: BrandProfile,
  claims: Claim[],
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ assets: GeneratedCampaignAsset[]; model: string }> {
  if (!claims.length || claims.some((claim) => !claim.approved)) {
    throw new Error("Every evidence claim must be approved before campaign generation.");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Campaign generation is not configured yet. Add OPENAI_API_KEY on the server.");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const approvedEvidence = claims.map(({ id, text, sourceUrl, state, confidence }) => ({ id, text, sourceUrl, state, confidence }));
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 12_000,
      reasoning: { effort: "low" },
      safety_identifier: createHash("sha256").update(userId).digest("hex").slice(0, 32),
      instructions: [
        "You create conservative launch campaign assets for a company.",
        "Use only facts explicitly present in APPROVED_EVIDENCE. Never add metrics, dates, customers, awards, partnerships, founder biography, market position, or guarantees.",
        "Every asset must cite the approved claim IDs it relies on. Do not cite any other IDs.",
        "Founder quotes must be labeled as suggested draft language and must not imply the founder already said them.",
        "Structured data must be valid JSON-LD but may contain only approved facts.",
        "Return exactly one asset of each required type.",
      ].join("\n"),
      input: JSON.stringify({
        company: profile.company,
        product: profile.product,
        audience: profile.audience,
        positioning: profile.positioning,
        APPROVED_EVIDENCE: approvedEvidence,
      }),
      text: { format: { type: "json_schema", name: "launch_campaign_assets", strict: true, schema: outputSchema } },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
      ? (payload as { error: { message: string } }).error.message.slice(0, 300)
      : `HTTP ${response.status}`;
    throw new Error(`Campaign generation failed: ${providerMessage}`);
  }
  const parsed = generatedResponseSchema.parse(JSON.parse(responseText(payload)));
  assertEvidenceBounded(parsed.assets, claims);
  return {
    model,
    assets: parsed.assets.map((asset) => ({
      ...asset,
      id: createHash("sha256").update(`${asset.type}:${asset.title}:${asset.content}`).digest("hex").slice(0, 20),
      status: "draft" as const,
    })),
  };
}
