import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { persistenceResponse } from "../lib/persistence";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

describe("Firebase production foundation", () => {
  it("keeps the unconfigured application in explicit local mode", () => {
    expect(persistenceResponse(false, null)).toEqual({ configured: false, project: null });
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
});

