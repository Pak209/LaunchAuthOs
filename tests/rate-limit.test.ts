import { describe, expect, it } from "vitest";
import { enforceRateLimit, RateLimitError } from "../lib/rate-limit";

describe("resource rate limits", () => {
  it("enforces a local fallback limit when admin persistence is unavailable", async () => {
    const key = `test-${Date.now()}`;
    await enforceRateLimit(key, "unit", 2, 60);
    await enforceRateLimit(key, "unit", 2, 60);
    await expect(enforceRateLimit(key, "unit", 2, 60)).rejects.toBeInstanceOf(RateLimitError);
  });
});
