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
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Stripe webhooks are not configured yet.");
  return secret;
}
