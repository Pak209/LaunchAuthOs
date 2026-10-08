import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as patchProject } from "../app/api/projects/[projectId]/route";
import { PATCH as patchCampaign } from "../app/api/projects/[projectId]/campaign/route";
import { ProjectMutationConflictError } from "../lib/persistence";
import type { CampaignAssetType, CampaignDraft } from "../lib/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), configured: vi.fn(), adminConfigured: vi.fn(), adminDb: vi.fn(),
  updateProjectCampaign: vi.fn(), saveCampaignRevision: vi.fn(), attestCampaignApproval: vi.fn(),
}));

// Mock service boundaries, not HTTP handlers: response construction, validation,
// and error classification below execute the actual route code. The persistence
// error uses its real class so instanceof tests cover the production contract.
vi.mock("@/lib/persistence", async () => ({
  ProjectMutationConflictError: (await import("../lib/persistence")).ProjectMutationConflictError,
  updateProjectCampaign: mocks.updateProjectCampaign,
  saveCampaignRevision: mocks.saveCampaignRevision,
  loadProject: vi.fn(),
}));
vi.mock("@/lib/firebase/config", () => ({ isFirebaseConfigured: mocks.configured }));
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: mocks.auth }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: mocks.adminDb, isFirebaseAdminExplicitlyConfigured: mocks.adminConfigured }));
vi.mock("@/lib/campaign-approval", () => ({ attestCampaignApproval: mocks.attestCampaignApproval }));
vi.mock("@/lib/request-security", () => import("../lib/request-security"));

const projectId = "a".repeat(24);
const db = { identity: "customer-db" };
const adminDb = { identity: "admin-db" };
const user = { uid: "owner" };
const claim = { id: "claim", text: "Acme makes software.", sourceUrl: "https://acme.example", state: "VERIFIED", approved: true };
const profile = {
  company: "Acme", product: "Software", audience: "Teams", positioning: "Simple workflows", sourceUrl: "https://acme.example", claims: [claim],
  findings: { product: [], audience: [], positioning: [], founder: [], milestone: [], proof_point: [], competitor: [] },
};
const assetTypes: CampaignAssetType[] = ["press_release", "headlines", "founder_quotes", "boilerplate", "social_posts", "directory_copy", "faq", "structured_data"];
const assets = assetTypes.map((type) => ({ id: type, type, title: "Campaign asset", content: "Approved product facts.", claimIds: [claim.id], status: "approved" as const }));
const campaign: CampaignDraft = { version: 2, status: "approved", model: "test-model", generatedAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T01:00:00.000Z", assets };
const savedEvidence = { profile, campaign: { ...campaign, status: "draft" }, campaignStatus: "draft_ready", updatedAt: "2026-10-03T00:00:00.000Z" };

const request = (body: unknown) => new Request(`https://app.example/api/projects/${projectId}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const context = (id = projectId) => ({ params: Promise.resolve({ projectId: id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.adminConfigured.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ db, user });
  mocks.adminDb.mockReturnValue(adminDb);
  mocks.updateProjectCampaign.mockResolvedValue(savedEvidence);
  mocks.saveCampaignRevision.mockResolvedValue(campaign);
  mocks.attestCampaignApproval.mockResolvedValue(undefined);
});

const routes = [
  { name: "project PATCH", patch: patchProject, body: { profile, claims: [claim], status: "campaign" }, mutation: mocks.updateProjectCampaign },
  { name: "campaign PATCH", patch: patchCampaign, body: { assets, status: "approved" }, mutation: mocks.saveCampaignRevision },
];

describe.each(routes)("$name response contract", ({ patch, body, mutation }) => {
  it.each([
    "This project has a fulfillment order. Its evidence and campaign are locked.",
    "A newer saved version already exists. Reload the project.",
    "This campaign has reached its version limit.",
  ])("maps a typed persistence conflict to 409: %s", async (message) => {
    mutation.mockRejectedValue(new ProjectMutationConflictError(message));
    const response = await patch(request(body), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: message });
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
    expect(mocks.adminDb).not.toHaveBeenCalled();
  });

  it("returns 401 for missing authentication without mutating or attesting", async () => {
    mocks.auth.mockRejectedValue(new Error("Authentication required."));
    const response = await patch(request(body), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
    expect(mutation).not.toHaveBeenCalled();
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
  });

  it("returns 400 for schema-invalid input before calling persistence", async () => {
    const response = await patch(request({}), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(mutation).not.toHaveBeenCalled();
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid project identifier before calling persistence", async () => {
    const response = await patch(request(body), context("invalid-project"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid project identifier." });
    expect(mutation).not.toHaveBeenCalled();
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
  });

  it("does not misclassify an unexpected storage error as a conflict", async () => {
    mutation.mockRejectedValue(new Error("Storage temporarily unavailable."));
    const response = await patch(request(body), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Storage temporarily unavailable." });
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
  });
});

describe("unlocked mutation route success", () => {
  it("persists profile review under the authenticated user and normalizes campaign status", async () => {
    const response = await patchProject(request({ profile, claims: [claim], status: "campaign" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persistence: "saved", status: "draft_ready", saved: savedEvidence });
    expect(mocks.updateProjectCampaign).toHaveBeenCalledExactlyOnceWith(db, user, projectId, profile, [claim], "campaign");
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
  });

  it("attests only the approved campaign returned from a successful persistence write", async () => {
    const response = await patchCampaign(request({ assets, status: "approved" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ campaign });
    expect(mocks.saveCampaignRevision).toHaveBeenCalledExactlyOnceWith(db, user, projectId, assets, "approved");
    expect(mocks.attestCampaignApproval).toHaveBeenCalledExactlyOnceWith(adminDb, user.uid, projectId, campaign);
    expect(mocks.saveCampaignRevision.mock.invocationCallOrder[0]).toBeLessThan(mocks.attestCampaignApproval.mock.invocationCallOrder[0]);
  });

  it("saves drafts without creating an approval attestation", async () => {
    const draft = { ...campaign, status: "draft" as const };
    mocks.saveCampaignRevision.mockResolvedValue(draft);
    const response = await patchCampaign(request({ assets, status: "draft" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ campaign: draft });
    expect(mocks.saveCampaignRevision).toHaveBeenCalledExactlyOnceWith(db, user, projectId, assets, "draft");
    expect(mocks.attestCampaignApproval).not.toHaveBeenCalled();
    expect(mocks.adminDb).not.toHaveBeenCalled();
  });

  it("returns 409 when checkout fences the separate approval-attestation step", async () => {
    mocks.attestCampaignApproval.mockRejectedValue(new Error("This project has a fulfillment order. Campaign approval is locked."));
    const response = await patchCampaign(request({ assets, status: "approved" }), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This project has a fulfillment order. Campaign approval is locked." });
    expect(mocks.saveCampaignRevision).toHaveBeenCalledTimes(1);
    expect(mocks.attestCampaignApproval).toHaveBeenCalledTimes(1);
  });
});
