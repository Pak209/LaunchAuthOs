import { describe, expect, it } from "vitest";
import { publicEvidenceLink, summarizeFulfillment } from "../lib/fulfillment-summary";
import type { FulfillmentState, Placement } from "../lib/types";

const placement = (state: Placement["state"], url: string, extra: Partial<Placement> = {}): Placement => ({ id: url, outlet: "Example", state, url, ...extra });
const fixture = (placements: Placement[]): FulfillmentState => ({ order: null, directories: [], jobs: [], placements });
describe("evidence-derived fulfillment summary", () => {
  it("starts empty without inventing publications or monitoring", () => {
    expect(summarizeFulfillment(null)).toMatchObject({ publicationCount: 0, directoryCount: 0, monitoring: "Not started", placements: [] });
  });
  it("keeps lifecycle states separate; indexed is a subset of publications", () => {
    const result = summarizeFulfillment(fixture(["published", "indexed", "accepted", "submitted", "failed", "removed"].map((state) => placement(state as Placement["state"], `https://news.example/${state}`))));
    expect(result.publicationCount).toBe(2);
    expect(result.counts).toEqual({ published: 1, indexed: 1, accepted: 1, submitted: 1, failed: 1, removed: 1 });
  });
  it("deduplicates URLs and honors later removals", () => {
    const result = summarizeFulfillment(fixture([
      placement("published", "https://news.example/article#story", { lastVerifiedAt: "2026-01-01" }),
      placement("removed", "https://news.example/article", { lastVerifiedAt: "2026-01-02" }),
      placement("published", "https://news.example/article", { lastVerifiedAt: "2026-01-01" }),
    ]));
    expect(result.placements).toHaveLength(1); expect(result.publicationCount).toBe(0); expect(result.counts.removed).toBe(1);
  });
  it("does not mask an adverse state with a tied observation", () => {
    expect(summarizeFulfillment(fixture([placement("removed", "https://news.example/a"), placement("published", "https://news.example/a")])).counts.removed).toBe(1);
  });
  it("rejects unsafe or malformed links without losing valid observations", () => {
    for (const url of ["javascript:alert(1)", "data:text/plain,test", "bad url", "https://user:pass@news.example/"]) expect(publicEvidenceLink(url)).toBeUndefined();
    expect(summarizeFulfillment(fixture([placement("published", "javascript:alert(1)")])).publicationCount).toBe(0);
  });
  it("counts directory listings separately and only when a public listing URL exists", () => {
    const state = fixture([]);
    state.directories = ["published", "accepted", "published"].map((status, index) => ({ id: String(index), directory: "Example", status: status as "published" | "accepted", listingUrl: index === 2 ? undefined : "https://directory.example/company", mode: "manual", requiredActions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }));
    expect(summarizeFulfillment(state)).toMatchObject({ directoryCount: 1, publicationCount: 0 });
    state.directories.push({ ...state.directories[0], id: "duplicate", listingUrl: "https://directory.example/company#listing" });
    expect(summarizeFulfillment(state).directoryCount).toBe(1);
  });
  it("does not describe failed monitoring or last-check errors as healthy", () => {
    const state = fixture([placement("published", "https://news.example/a", { lastVerificationError: "timeout" })]);
    state.jobs = [{ id: "verify", type: "placement_verification", status: "failed", attempts: 3, idempotencyKey: "test", createdAt: "", updatedAt: "" }];
    expect(summarizeFulfillment(state)).toMatchObject({ monitoring: "Needs attention", verificationProblems: 1 });
  });
});
