import { describe, expect, it } from "vitest";
import { isPrivateIp, parsePublicHttpUrl } from "../lib/url-security";

describe("URL security", () => {
  it("accepts public HTTP URLs", () => {
    expect(parsePublicHttpUrl("https://example.com/path#fragment").toString()).toBe("https://example.com/path");
  });

  it.each(["127.0.0.1", "10.0.0.1", "172.16.1.2", "192.168.1.2", "169.254.1.1", "100.64.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "recognizes %s as private",
    (address) => expect(isPrivateIp(address)).toBe(true),
  );

  it("blocks local and credentialed URLs", () => {
    expect(() => parsePublicHttpUrl("http://localhost:3000")).toThrow(/Private|local/);
    expect(() => parsePublicHttpUrl("https://user:pass@example.com")).toThrow(/credentials/);
  });
});
