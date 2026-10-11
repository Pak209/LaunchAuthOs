import { beforeEach, expect, it, vi } from "vitest";
import { MemoryFirestore } from "./helpers/memory-firestore";
import { campaignDigest } from "../lib/campaign-approval";
import { resolvePackageContract } from "../lib/package-contract";
import type { CampaignDraft } from "../lib/types";
const mocks = vi.hoisted(() => ({ db: undefined as unknown, project: undefined as unknown, retrieve: vi.fn(), create: vi.fn(), price: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminDb: () => mocks.db, isFirebaseAdminExplicitlyConfigured: () => true }));
vi.mock("@/lib/firebase/server", () => ({ getAuthenticatedFirebaseContext: async () => ({ db: {}, user: { uid: "owner", emailVerified: true } }) }));
vi.mock("@/lib/persistence", () => ({ loadProject: async () => mocks.project }));
vi.mock("@/lib/fulfillment", () => import("../lib/fulfillment"));
vi.mock("@/lib/campaign-approval", () => import("../lib/campaign-approval"));
vi.mock("@/lib/package-contract", () => import("../lib/package-contract"));
vi.mock("@/lib/checkout-recovery", () => import("../lib/checkout-recovery"));
vi.mock("@/lib/request-security", () => ({ assertSameOrigin: () => {} }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => {}, RateLimitError: class extends Error {} }));
vi.mock("@/lib/readiness", () => ({ assertCheckoutReadiness: () => {} }));
vi.mock("@/lib/identity", () => import("../lib/identity"));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ checkout: { sessions: { retrieve: mocks.retrieve, create: mocks.create } }, prices: { retrieve: mocks.price } }), checkoutIdempotencyKey: () => "synthetic_key", getStripePriceId: () => "price_Test", isStripeLiveMode: () => false }));
import { POST } from "../app/api/projects/[projectId]/checkout/route";
const id = "a".repeat(24), path = `workspaces/personal_owner/projects/${id}`;
const metadata = { uid: "owner", projectId: id, packageId: "launch", priceId: "price_Test", checkoutAttempt: "0" };
const expired = { id: "cs_old", status: "expired", payment_status: "unpaid", mode: "payment", livemode: false, metadata, payment_intent: null, amount_subtotal: 100, amount_total: 100, currency: "usd" };
let db: MemoryFirestore;
beforeEach(() => {
  vi.clearAllMocks(); db = new MemoryFirestore(); mocks.db = db.asFirestore();
  const campaign = { version: 1, status: "approved", assets: [] } as unknown as CampaignDraft;
  mocks.project = { campaign }; db.seed(path, { createdBy: "owner" });
  db.seed(`${path}/orders/current`, { id: "current", status: "awaiting_payment", sandbox: true, nonBillable: true, currency: "usd", campaignVersion: 1, campaignDigest: campaignDigest(campaign), packageContract: resolvePackageContract("launch", { sandbox: true, nonBillable: true }), selectedPackageId: "launch", expectedPackageId: "launch", expectedPriceId: "price_Test", checkoutAttempt: 0, stripeCheckoutSessionId: "cs_old", expectedStripeLivemode: false, expectedAmountSubtotal: 100, expectedCurrency: "usd" });
  db.seed(`${path}/jobs/provider_submission_current`, { status: "blocked" });
  mocks.retrieve.mockResolvedValue(expired);
  mocks.price.mockResolvedValue({ id: "price_Test", active: true, type: "one_time", unit_amount: 100, currency: "usd", livemode: false });
  mocks.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/new", livemode: false });
});
const request = () => POST(new Request("https://app.test/api/checkout", { method: "POST", body: JSON.stringify({ packageId: "launch" }) }), { params: Promise.resolve({ projectId: id }) });
it("freshly retrieves and safely replaces an expired unpaid checkout", async () => {
  const response = await request(); expect(response.status, JSON.stringify(await response.json())).toBe(200);
  expect(mocks.retrieve).toHaveBeenCalledWith("cs_old", { expand: ["payment_intent"] });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(db.read(`${path}/orders/current`)).toMatchObject({ checkoutAttempt: 1, stripeCheckoutSessionId: "cs_new" });
  expect(db.read(`${path}/checkoutAttempts/0`).stripeCheckoutSessionId).toBe("cs_old");
});
it.each(["processing", "requires_payment_method"])("returns 409 without second checkout for %s", async status => {
  mocks.retrieve.mockResolvedValue({ ...expired, status: "complete", payment_intent: { id: "pi_old", status, last_payment_error: { code: "failed" }, amount_received: 0, amount: 100, currency: "usd", livemode: false, metadata } });
  expect((await request()).status).toBe(409); expect(mocks.create).not.toHaveBeenCalled();
  expect(db.read(`${path}/orders/current`).checkoutAttempt).toBe(0);
});
it("rejects retrieved foreign metadata and mode", async () => {
  mocks.retrieve.mockResolvedValue({ ...expired, metadata: { ...metadata, uid: "other" } });
  expect((await request()).status).toBe(409); expect(mocks.create).not.toHaveBeenCalled();
});
it("blocks retries before Stripe calls while reconciliation hold exists", async () => {
  db.seed(`${path}/orders/current`, { ...db.read(`${path}/orders/current`), paymentReviewHold: true });
  expect((await request()).status).toBe(409); expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});

it("rechecks hold after retrieving an open checkout before exposing its URL", async () => {
  mocks.retrieve.mockImplementation(async () => {
    db.seed(`${path}/orders/current`, { ...db.read(`${path}/orders/current`), paymentReviewHold: true });
    return { ...expired, status: "open", url: "https://checkout.stripe.test/old" };
  });
  const response = await request(); expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty("url"); expect(mocks.create).not.toHaveBeenCalled();
});
