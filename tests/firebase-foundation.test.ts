import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { persistenceResponse } from "../lib/persistence";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

describe("Firebase production foundation", () => {
  it("keeps the unconfigured application in explicit local mode", () => {
    expect(persistenceResponse(false, null)).toEqual({ configured: false, project: null, projects: [] });
  });

  it("defaults all unmatched Firestore documents to denied", () => {
    expect(rules).toContain("match /{document=**}");
    expect(rules).toContain("allow read, write: if false");
  });

  it("requires workspace membership for reads", () => {
    expect(rules).toContain("allow read: if isMember(workspaceId)");
  });

  it("keeps viewers read-only and project tenancy immutable", () => {
    expect(rules).toContain("memberRole(workspaceId) in ['owner', 'admin', 'member']");
    expect(rules).toContain("request.resource.data.workspaceId == resource.data.workspaceId");
    expect(rules).toContain("request.resource.data.createdBy == resource.data.createdBy");
  });

  it("isolates user profiles and normalized project records", () => {
    expect(rules).toContain("match /users/{userId}");
    expect(rules).toContain("request.auth.uid == userId");
    expect(rules).toContain("match /profiles/{profileId}");
    expect(rules).toContain("match /claims/{claimId}");
    expect(rules).toContain("match /campaigns/{campaignId}");
    expect(rules).toContain("match /versions/{versionId}");
  });

  it("keeps captured evidence immutable", () => {
    expect(rules).toContain("match /evidence/{evidenceId}");
    expect(rules).toContain("allow update: if false");
    expect(rules).toContain("!exists(/databases/$(database)/documents/workspaces/$(workspaceId)/projects/$(projectId))");
    expect(rules).toContain("request.resource.data.contentHash is string");
  });

  it("makes payment, fulfillment, job, directory, and placement state server-controlled", () => {
    for (const path of ["orders", "directorySubmissions", "jobs", "placements"]) {
      expect(rules).toContain(`match /${path}/`);
    }
    expect(rules.match(/allow write: if false/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
