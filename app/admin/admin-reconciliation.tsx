"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type ReconciliationCase = {
  workspaceId: string;
  projectId: string;
  projectName: string;
  provider: string;
  headline: string;
  packageName: string;
  billingStatus: string;
  attempts: number;
  revision: number;
  dispatchedAt: string | null;
  lastError: string;
};

function ReconciliationForm({ item }: { item: ReconciliationCase }) {
  const router = useRouter();
  const [action, setAction] = useState("attach_release");
  const [externalId, setExternalId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const requestId = useRef("");
  const isRetry = action === "authorize_retry";
  const prefix = `reconcile-${item.workspaceId}-${item.projectId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || complete) return;
    setBusy(true); setMessage("");
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/reconciliation", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: item.workspaceId, projectId: item.projectId, requestId: requestId.current,
          expectedAttempt: item.attempts, expectedRevision: item.revision, action,
          ...(isRetry ? {} : { externalId: externalId.trim() }),
          evidenceReference: reference, note, confirmed,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to reconcile this order.");
      setComplete(true);
      setMessage(isRetry ? "One retry authorized. The worker will use the original approved release and package." : "Existing release linked. Status and placement verification are queued; no new release was submitted.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reconcile this order.");
    } finally { setBusy(false); }
  }

  return <details className="admin-reconciliation-case" id={prefix}>
    <summary><strong>{item.projectName}</strong><span>{item.provider} · attempt {item.attempts} · needs review</span></summary>
    <div className="admin-reconciliation-context">
      <p><strong>Approved headline:</strong> {item.headline || "Legacy order — inspect the approved campaign"}</p>
      <p><strong>Supplier package:</strong> {item.packageName} · <strong>Billing:</strong> {item.billingStatus}</p>
      <p><strong>Dispatch recorded:</strong> {item.dispatchedAt ?? "Unknown (legacy worker)"}</p>
      <p>{item.lastError}</p>
    </div>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || complete}>
        <legend>Record the supplier outcome</legend>
        <label htmlFor={`${prefix}-action`}>Resolution</label>
        <select id={`${prefix}-action`} value={action} onChange={(event) => { setAction(event.target.value); setConfirmed(false); }}>
          <option value="attach_release">Link an existing supplier release</option>
          <option value="authorize_retry" disabled={item.billingStatus !== "paid"}>Supplier confirmed no submission — authorize one retry</option>
        </select>
        {!isRetry ? <><label htmlFor={`${prefix}-release`}>Supplier release ID</label><input id={`${prefix}-release`} value={externalId} onChange={(event) => setExternalId(event.target.value)} required maxLength={160} pattern={"[A-Za-z0-9_\\-]+"} autoComplete="off" /></> : <p className="admin-reconciliation-warning">This authorizes another supplier request, which may spend credits. A missing search result or timeout is not proof that the first request was rejected. Obtain confirmation from the supplier.</p>}
        <label htmlFor={`${prefix}-reference`}>Evidence reference</label>
        <input id={`${prefix}-reference`} value={reference} onChange={(event) => setReference(event.target.value)} required minLength={5} maxLength={500} placeholder="Supplier dashboard URL or support ticket ID" />
        <label htmlFor={`${prefix}-note`}>What did you verify?</label>
        <textarea id={`${prefix}-note`} value={note} onChange={(event) => setNote(event.target.value)} required minLength={20} maxLength={2000} rows={3} placeholder="Record the company, headline, package, and supplier response. Do not include passwords or API keys." />
        <label className="admin-reconciliation-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /> <span>{isRetry ? "The supplier confirmed that the prior request was not accepted and cannot publish later. I authorize one retry of the unchanged order." : "I matched this supplier release to this customer's company, approved headline, and package. Linking it does not refund or charge the customer."}</span></label>
        <button type="submit" disabled={!confirmed || busy || complete}>{busy ? "Recording…" : isRetry ? "Authorize one retry" : "Link existing release"}</button>
      </fieldset>
    </form>
    {message ? <p role={complete ? "status" : "alert"} className={complete ? "admin-reconciliation-success" : "admin-error"}>{message}</p> : null}
  </details>;
}

export default function AdminReconciliation({ cases }: { cases: ReconciliationCase[] }) {
  return <section className="admin-reconciliation" aria-labelledby="reconciliation-heading">
    <div className="admin-section-title"><span>Supplier exceptions</span><h2 id="reconciliation-heading">Reconcile uncertain submissions</h2><p>Check the supplier dashboard or contact support before resolving a stopped submission. Every decision keeps an audit record.</p></div>
    {cases.length ? cases.map((item) => <ReconciliationForm key={`${item.workspaceId}:${item.projectId}:${item.attempts}:${item.revision}`} item={item} />) : <p className="admin-empty">No uncertain supplier submissions need review.</p>}
  </section>;
}
