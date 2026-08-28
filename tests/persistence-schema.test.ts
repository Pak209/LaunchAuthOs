import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { persistenceResponse } from "../lib/persistence";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280001_initial_workspace_auth.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("production persistence foundation", () => {
  it("keeps the unconfigured application in an explicit local mode", () => {
    expect(persistenceResponse(false, null)).toEqual({ configured: false, project: null });
  });

  it.each([
    "profiles",
    "workspaces",
    "workspace_members",
    "projects",
    "brand_profiles",
    "claims",
    "campaigns",
    "evidence_items",
  ])("enables row-level security for %s", (table) => {
    expect(migration).toContain(`alter table public.${table} enable row level security`);
  });

  it("indexes tenant membership and project access paths", () => {
    expect(migration).toContain("workspace_members_user_id_idx");
    expect(migration).toContain("projects_workspace_updated_idx");
    expect(migration).toContain("evidence_items_project_state_idx");
  });

  it("restricts workspace helpers to authenticated users", () => {
    expect(migration).toContain("grant execute on function public.ensure_personal_workspace() to authenticated");
    expect(migration).toContain("revoke all on function public.ensure_personal_workspace() from public, anon");
  });

  it("keeps viewer access read-only", () => {
    expect(migration).toContain("wm.role in ('owner', 'admin', 'member')");
    expect(migration).toContain("projects_member_delete");
    expect(migration).toContain("array['owner', 'admin']");
  });
});
