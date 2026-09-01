import { NextResponse } from "next/server";
import { getStripeClient, getStripePriceId, type PackageId } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const packageIds: PackageId[] = ["launch", "authority", "authority_plus"];

export async function GET() {
  try {
    const stripe = getStripeClient();
    const prices = await Promise.all(packageIds.map((packageId) => stripe.prices.retrieve(getStripePriceId(packageId))));
    return NextResponse.json({
      configured: true,
      offers: prices.map((price, index) => ({ packageId: packageIds[index], amount: price.unit_amount, currency: price.currency, active: price.active, type: price.type })),
    }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing packages are unavailable.";
    return NextResponse.json({ configured: false, offers: [], error: message }, { status: 503 });
  }
}
