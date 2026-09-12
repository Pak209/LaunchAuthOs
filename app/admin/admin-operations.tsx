"use client";

import { useState } from "react";

type PackageId = "launch" | "authority" | "authority_plus";
type Preflight = { provider: string; packageId: PackageId; providerCostCents: number; currency: string; availableCredits: number | null; requiredCredits: number | null; submissionEnabled: boolean };

export type AdminOrder = {
  workspaceId: string;
  projectId: string;
  projectName: string;
  status: string;
  billingStatus: string;
  packageId?: PackageId;
  externalId?: string;
  paymentIntentId?: string;
  amountTotal?: number;
  refundedAmountCents?: number;
  refundPending?: boolean;
};

export function ProviderPreflightPanel() {
  const [packageId, setPackageId] = useState<PackageId>("launch");
  const [result, setResult] = useState<Preflight | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function testProvider() {
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await fetch(`/api/admin/provider?packageId=${encodeURIComponent(packageId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to test the provider.");
      setResult(payload.result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to test the provider."); }
    finally { setBusy(false); }
  }
  return <section className="admin-provider"><div><span>Distribution provider</span><h2>Preflight check</h2><p>Verifies the account, package mapping, available credits, and submission gate without publishing anything.</p></div><div className="admin-provider-actions"><select value={packageId} onChange={(event) => setPackageId(event.target.value as PackageId)}><option value="launch">Launch</option><option value="authority">Authority</option><option value="authority_plus">Authority Plus</option></select><button disabled={busy} onClick={() => void testProvider()}>{busy ? "Checking…" : "Test provider"}</button></div>{result ? <dl><div><dt>Provider</dt><dd>{result.provider}</dd></div><div><dt>Supplier cost</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: result.currency }).format(result.providerCostCents / 100)}</dd></div><div><dt>Credits</dt><dd>{result.availableCredits ?? "—"} / {result.requiredCredits ?? "—"}</dd></div><div><dt>Live submit</dt><dd data-ready={result.submissionEnabled}>{result.submissionEnabled ? "Enabled" : "Locked"}</dd></div></dl> : null}{message ? <p className="admin-error">{message}</p> : null}</section>;
}

export function AdminOrders({ initialOrders }: { initialOrders: AdminOrder[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function update(order: AdminOrder, action: "cancel_provider" | "refund_customer") {
    const verb = action === "cancel_provider" ? "cancel this supplier submission" : "refund the customer’s remaining paid balance";
    if (!window.confirm(`Are you sure you want to ${verb}?`)) return;
    setBusy(`${order.projectId}:${action}`); setError("");
    try {
      const response = await fetch("/api/admin/orders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: order.workspaceId, projectId: order.projectId, action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the order.");
      setOrders((current) => current.map((item) => item.projectId !== order.projectId ? item : action === "cancel_provider" ? { ...item, status: "canceled" } : { ...item, refundPending: true }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update the order."); }
    finally { setBusy(""); }
  }
  return <section className="admin-orders"><div className="admin-section-title"><span>Customer orders</span><h2>Billing and supplier actions</h2><p>Supplier cancellation and customer refunds are separate, journaled operations.</p></div><div className="admin-table"><div className="admin-table-head admin-order-grid"><span>Project</span><span>Package</span><span>Fulfillment</span><span>Billing</span><span>Paid</span><span>Actions</span></div>{orders.length ? orders.map((order) => { const remaining = Math.max(0, (order.amountTotal ?? 0) - (order.refundedAmountCents ?? 0)); const canCancel = Boolean(order.externalId && (order.status === "submitted" || order.status === "processing")); const canRefund = Boolean(order.paymentIntentId && order.billingStatus !== "refunded" && remaining > 0 && !order.refundPending); return <div className="admin-table-row admin-order-grid" key={`${order.workspaceId}:${order.projectId}`}><span><strong>{order.projectName}</strong><small>{order.projectId}</small></span><span>{order.packageId?.replaceAll("_", " ") ?? "—"}</span><span data-status={order.status}>{order.status}</span><span data-status={order.billingStatus}>{order.refundPending ? "refund pending" : order.billingStatus}</span><span>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(remaining / 100)}</span><span className="admin-order-actions"><button disabled={busy !== "" || !canCancel} onClick={() => void update(order, "cancel_provider")}>Cancel supplier</button><button disabled={busy !== "" || !canRefund} onClick={() => void update(order, "refund_customer")}>Refund customer</button></span></div>; }) : <p className="admin-empty">No paid orders yet.</p>}{error ? <p className="admin-error">{error}</p> : null}</div></section>;
}
