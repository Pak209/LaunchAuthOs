import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const analyzer = readFileSync(new URL("../lib/analyze.ts", import.meta.url), "utf8");

describe("crawler connection pinning", () => {
  it("connects through a lookup callback pinned to the validated public address", () => {
    expect(analyzer).toContain("resolvePublicAddress(url.hostname, resolver)");
    expect(analyzer).toContain("lookup: lookupPinned");
    expect(analyzer).toContain("callback(null, target.address, target.family)");
    expect(analyzer).toContain("servername: url.hostname");
  });

  it("does not follow redirects onto an unvalidated address", () => {
    expect(analyzer).toContain("Redirects are not followed during secure analysis.");
  });
});
