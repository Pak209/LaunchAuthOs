import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

export function isPrivateIp(address: string): boolean {
  const unwrapped = address.replace(/^\[|\]$/g, "");
  if (unwrapped === "::1" || unwrapped === "::") return true;

  const normalized = unwrapped.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (mapped.includes(".")) return isPrivateIp(mapped);
    const words = mapped.split(":");
    if (words.length === 2) {
      const high = Number.parseInt(words[0], 16);
      const low = Number.parseInt(words[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isPrivateIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return true;
  }

  if (isIP(unwrapped) !== 4) return false;
  const [a, b] = unwrapped.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function parsePublicHttpUrl(value: string): URL {
  const candidate = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(candidate.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  if (candidate.username || candidate.password) {
    throw new Error("URLs containing credentials are not supported.");
  }
  const hostname = candidate.hostname.toLowerCase().replace(/\.$/, "");
  if (blockedHostnames.has(hostname) || isPrivateIp(hostname)) {
    throw new Error("Private or local network addresses are not supported.");
  }
  candidate.hash = "";
  return candidate;
}
