import { createHash } from "node:crypto";
import { isSafeUid } from "./identity";
import Stripe from "stripe";

export type PackageId = "launch" | "authority" | "authority_plus";

const packagePriceEnv: Record<PackageId, string> = {
  launch: "STRIPE_PRICE_LAUNCH",
  authority: "STRIPE_PRICE_AUTHORITY",
  authority_plus: "STRIPE_PRICE_AUTHORITY_PLUS",
};

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe is not configured yet.");
  return new Stripe(secretKey, { appInfo: { name: "Launch Auth", version: "0.1.0" } });
}

export function getStripePriceId(packageId: PackageId) {
  const priceId = process.env[packagePriceEnv[packageId]];
  if (!priceId) throw new Error(`Stripe price for ${packageId} is not configured yet.`);
  return priceId;
}

export function isStripeLiveMode() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured yet.");
  if (/^(sk|rk)_live_/.test(key)) return true;
  if (/^(sk|rk)_test_/.test(key)) return false;
  throw new Error("Stripe key mode cannot be determined. Configure a live or test server key.");
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Stripe webhooks are not configured yet.");
  return secret;
}

/** Preserve deployed ASCII keys; encode custom identities safely for HTTP headers. */
export function checkoutIdempotencyKey(uid: string, projectId: string, attempt: number, packageId: PackageId) {
  if (!isSafeUid(uid) || !/^[a-f0-9]{24}$/.test(projectId) || !Number.isSafeInteger(attempt) || attempt < 0
    || !["launch", "authority", "authority_plus"].includes(packageId)) throw new Error("Invalid checkout identity.");
  const legacy = `checkout_${uid}_${projectId}_${attempt}_${packageId}`;
  return /^[\x20-\x7e]+$/.test(legacy) ? legacy
    : `checkout_unicode_${createHash("sha256").update(JSON.stringify([uid, projectId, attempt, packageId])).digest("hex")}`;
}
