import { NextResponse } from "next/server";
import { getStripeClient, getStripePriceId, isStripeLiveMode, type PackageId } from "@/lib/stripe";

import { resolvePackageContract } from "@/lib/package-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const packageIds: PackageId[] = ["launch", "authority", "authority_plus"];

export async function GET() {
  try {
    const stripe = getStripeClient();
    const live = isStripeLiveMode();
    const contracts = packageIds.map((id) => resolvePackageContract(id, { sandbox: !live, nonBillable: !live }));
    const prices = await Promise.all(packageIds.map((packageId) => stripe.prices.retrieve(getStripePriceId(packageId))));
    if (live && prices.some((price, index) => price.id !== contracts[index].priceId)) throw new Error("Configured prices do not match approved package contracts.");
    return NextResponse.json({
      configured: true,
      offers: prices.map((price, index) => ({ packageId: packageIds[index], contract: contracts[index], amount: price.unit_amount, currency: price.currency, active: price.active, type: price.type })),
    }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing packages are unavailable.";
    return NextResponse.json({ configured: false, offers: [], error: message }, { status: 503 });
  }
}
