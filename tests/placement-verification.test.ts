import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyPlacementHttpStatus } from "../lib/placement-verification";

const verifier = readFileSync(new URL("../lib/placement-verification.ts", import.meta.url), "utf8");
const fulfillment = readFileSync(new URL("../lib/fulfillment.ts", import.meta.url), "utf8");

describe("placement evidence verification", () => {
  it("distinguishes live, removed, and transient HTTP outcomes", () => {
    expect(classifyPlacementHttpStatus(200)).toBe("live");
    expect(classifyPlacementHttpStatus(204)).toBe("live");
    expect(classifyPlacementHttpStatus(404)).toBe("removed");
    expect(classifyPlacementHttpStatus(410)).toBe("removed");
    expect(classifyPlacementHttpStatus(301)).toBe("retry");
    expect(classifyPlacementHttpStatus(429)).toBe("retry");
    expect(classifyPlacementHttpStatus(503)).toBe("retry");
  });

  it("pins the verification request to a validated public address", () => {
    expect(verifier).toContain("addresses.some(({ address }) => isPrivateIp(address))");
    expect(verifier).toContain("lookup: lookupPinned");
    expect(verifier).toContain("servername: url.hostname");
    expect(verifier).toContain("does not follow unvalidated redirects");
  });

  it("persists observed URLs and schedules repeat checks", () => {
    expect(fulfillment).toContain('type: "placement_verification"');
    expect(fulfillment).toContain("provider.evidence(order.externalId)");
    expect(fulfillment).toContain("verifyPublicPlacementUrl(url)");
    expect(fulfillment).toContain("VERIFICATION_POLL_MS");
  });
});
