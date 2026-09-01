import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateIp, parsePublicHttpUrl } from "./url-security";

export type PlacementHttpOutcome = "live" | "removed" | "retry";

export function classifyPlacementHttpStatus(status: number): PlacementHttpOutcome {
  if (status >= 200 && status < 300) return "live";
  if (status === 404 || status === 410) return "removed";
  return "retry";
}

async function resolvePublicAddress(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The placement URL resolves to a private or unavailable network address.");
  }
  return addresses[0];
}

async function pinnedStatus(url: URL, address: { address: string; family: number }) {
  return new Promise<number>((resolve, reject) => {
    const lookupPinned: LookupFunction = (_hostname, _options, callback) => callback(null, address.address, address.family);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: { "user-agent": "LaunchAuthVerifier/0.1 (+placement evidence)", accept: "text/html,application/xhtml+xml" },
      lookup: lookupPinned,
      servername: url.hostname,
    }, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      response.on("end", () => resolve(status));
      response.on("error", reject);
    });
    request.setTimeout(8_000, () => request.destroy(new Error("Placement verification timed out.")));
    request.on("error", reject);
    request.end();
  });
}

export async function verifyPublicPlacementUrl(rawUrl: string) {
  const url = parsePublicHttpUrl(rawUrl);
  const address = await resolvePublicAddress(url.hostname);
  const status = await pinnedStatus(url, address);
  const outcome = classifyPlacementHttpStatus(status);
  if (outcome === "retry") {
    const reason = status >= 300 && status < 400
      ? "Placement verification does not follow unvalidated redirects."
      : `Placement verification returned HTTP ${status}.`;
    throw new Error(reason);
  }
  return { url: url.toString(), status, live: outcome === "live", checkedAt: new Date().toISOString() };
}
