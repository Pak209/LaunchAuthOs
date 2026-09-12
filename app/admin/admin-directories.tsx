"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/** Deliberately serialized primitives only; server timestamps stay on the server. */
export type DirectoryCase = {
  workspaceId: string;
  projectId: string;
  projectName: string;
  directoryId: string;
  directory: string;
  mode: string;
  status: string;
  revision: number;
  requiredActions: string[];
  billingStatus: string;
  submissionUrl: string | null;
  listingUrl: string | null;
  updatedAt: string;
  operatorNote: string | null;
};

const nextStatuses: Record<string, readonly string[]> = {
  needs_customer: ["queued", "needs_customer", "failed"],
  ready_for_human: ["queued", "needs_customer", "submitted", "failed"],
  queued: ["submitted", "needs_customer", "failed"],
  submitted: ["accepted", "published", "rejected", "failed"],
  accepted: ["published", "rejected", "failed"],
  published: ["removed"],
  rejected: ["queued", "needs_customer"],
  failed: ["queued", "needs_customer"],
  removed: ["queued", "needs_customer"],
};
const statusLabels: Record<string, string> = {
  queued: "Queued for manual work", needs_customer: "Needs customer action", submitted: "Submission recorded",
  accepted: "Acceptance recorded", published: "Public listing recorded", rejected: "Rejection recorded", failed: "Work failed", removed: "Listing removal recorded",
};

function safeLink(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

function DirectoryForm({ item }: { item: DirectoryCase }) {
  const router = useRouter();
  const options = nextStatuses[item.status] ?? [];
  const [targetStatus, setTargetStatus] = useState(options[0] ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [customerActions, setCustomerActions] = useState(item.requiredActions.join("\n"));
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<{ signature: string; body: string } | null>(null);
  const prefix = `directory-${item.workspaceId}-${item.projectId}-${item.directoryId}`;
  const requiresPaidOrder = targetStatus === "queued" || targetStatus === "submitted";
  const needsEvidence = targetStatus === "submitted" || targetStatus === "published";
  const evidenceLink = safeLink(item.listingUrl) ?? safeLink(item.submissionUrl);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || complete) return;
    setBusy(true); setMessage("");
    try {
      const fields = {
        workspaceId: item.workspaceId, projectId: item.projectId, directoryId: item.directoryId,
        expectedRevision: item.revision, targetStatus,
        ...(evidenceUrl.trim() ? { evidenceUrl: evidenceUrl.trim() } : {}),
        ...(targetStatus === "needs_customer" ? { requiredActions: customerActions.split("\n").map((value) => value.trim()).filter(Boolean) } : {}),
        note: note.trim(), confirmed,
      };
      const signature = JSON.stringify({ ...fields, observedAt });
      // A lost response must retry the exact UUID, observation time, and body.
      // Editing any detail creates a new operation; the revision fence still
      // prevents a second decision after an acknowledged-late first commit.
      if (request.current?.signature !== signature) {
        request.current = { signature, body: JSON.stringify({ ...fields, requestId: crypto.randomUUID(), observedAt: observedAt ? new Date(observedAt).toISOString() : new Date().toISOString() }) };
      }
      const response = await fetch("/api/admin/directories", { method: "POST", headers: { "content-type": "application/json" }, body: request.current.body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to record this directory outcome.");
      setComplete(true);
      setMessage("Manual directory record saved with an operator audit trail. No listing was submitted, verified, or indexed by this action.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to record this directory outcome. Retry unchanged details if the response was lost.");
    } finally { setBusy(false); }
  }

  return <details className="admin-reconciliation-case admin-directory-case" id={prefix}>
    <summary><strong>{item.projectName} · {item.directory}</strong><span>{item.status.replaceAll("_", " ")} · {item.mode}</span></summary>
    <div className="admin-reconciliation-context">
      <p><strong>Customer billing:</strong> {item.billingStatus} · <strong>Record revision:</strong> {item.revision}</p>
      <p><strong>Last update:</strong> {item.updatedAt}</p>
      {item.requiredActions.length ? <><p><strong>Outstanding customer actions</strong></p><ul>{item.requiredActions.map((action, index) => <li key={`${index}:${action}`}>{action}</li>)}</ul></> : null}
      {evidenceLink ? <p><a href={evidenceLink} target="_blank" rel="noopener noreferrer">Open operator-recorded evidence</a> — not independently verified or indexed.</p> : null}
      {item.operatorNote ? <p><strong>Previous internal note:</strong> {item.operatorNote}</p> : null}
    </div>
    {options.length ? <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || complete}>
        <legend>Manually record a directory outcome</legend>
        <p className="admin-reconciliation-warning">Complete any authorized work in the directory’s own interface first. This form only records what you observed. Queueing does not trigger an automatic submission, spend directory credits, issue a refund, or change payment status.</p>
        <label htmlFor={`${prefix}-status`}>Next status</label>
        <select id={`${prefix}-status`} value={targetStatus} onChange={(event) => { setTargetStatus(event.target.value); setConfirmed(false); }}>
          {options.map((status) => <option key={status} value={status} disabled={item.billingStatus !== "paid" && (status === "queued" || status === "submitted")}>{statusLabels[status]}</option>)}
        </select>
        {targetStatus === "queued" ? <p>Confirm customer authorization, approved listing copy, and every outstanding requirement before queueing. Rejected or removed listings require a fresh manual attempt.</p> : null}
        {targetStatus === "removed" ? <p>The earlier publication evidence stays in the audit history. This records removal only; it does not remove a listing from the directory.</p> : null}
        {requiresPaidOrder && item.billingStatus !== "paid" ? <p role="note" className="admin-error">New manual work requires an unrefunded, paid order. Historical outcomes can still be recorded after payment changes.</p> : null}
        {targetStatus === "needs_customer" ? <><label htmlFor={`${prefix}-actions`}>Customer actions (one per line; visible to the customer)</label><textarea id={`${prefix}-actions`} value={customerActions} onChange={(event) => { setCustomerActions(event.target.value); setConfirmed(false); }} required rows={3} maxLength={3_600} placeholder="Confirm category and approve the final listing copy" /></> : null}
        <label htmlFor={`${prefix}-url`}>{targetStatus === "published" ? "Public listing URL" : "Public evidence URL"}{needsEvidence ? " (required)" : " (optional)"}</label>
        <input id={`${prefix}-url`} type="url" value={evidenceUrl} onChange={(event) => { setEvidenceUrl(event.target.value); setConfirmed(false); }} required={needsEvidence} maxLength={2048} placeholder={targetStatus === "published" ? "https://directory.example/products/company" : "https://directory.example/submissions/company"} aria-describedby={`${prefix}-url-help`} />
        <p id={`${prefix}-url-help`}>Use a public http(s) URL without credentials, access tokens, or private customer data. A submission URL can be the directory page supported by your internal evidence note; publication requires the actual public listing.</p>
        <label htmlFor={`${prefix}-observed`}>Observed at (your local time; optional)</label>
        <input id={`${prefix}-observed`} type="datetime-local" step="1" value={observedAt} onChange={(event) => { setObservedAt(event.target.value); setConfirmed(false); }} aria-describedby={`${prefix}-time-help`} />
        <p id={`${prefix}-time-help`}>Leave blank to use the current time. This must follow the task’s previous recorded event.</p>
        <label htmlFor={`${prefix}-note`}>Internal evidence note</label>
        <textarea id={`${prefix}-note`} value={note} onChange={(event) => { setNote(event.target.value); setConfirmed(false); }} minLength={20} maxLength={2000} rows={3} required placeholder="Identify the customer, approved copy, authorization, directory response or support reference, and what you observed. Never include secrets." />
        <label className="admin-reconciliation-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>{targetStatus === "queued" ? "I matched this task to the customer and approved campaign, confirmed customer authorization, and resolved all outstanding requirements. This queues manual work only." : targetStatus === "published" ? "I opened this public listing and matched its company and content to this customer’s approved campaign. This is my recorded observation, not independent verification or proof of indexing." : "I matched this outcome and evidence to this customer, directory, and approved campaign. Any submission was authorized by the customer. I am recording a manual observation only."}</span></label>
        <button type="submit" disabled={!confirmed || busy || complete || (requiresPaidOrder && item.billingStatus !== "paid")}>{busy ? "Recording…" : "Save manual directory record"}</button>
      </fieldset>
    </form> : <p className="admin-error">This legacy status needs an internal review before it can be changed.</p>}
    {message ? <p role={complete ? "status" : "alert"} className={complete ? "admin-reconciliation-success" : "admin-error"}>{message}</p> : null}
  </details>;
}

export default function AdminDirectories({ cases }: { cases: DirectoryCase[] }) {
  return <section className="admin-reconciliation admin-directories" aria-labelledby="directories-heading">
    <div className="admin-section-title"><span>Assisted directory operations</span><h2 id="directories-heading">Manual work, recorded evidence</h2><p>Track customer requirements, submissions, editorial decisions, and listing removals. Human-recorded outcomes are separate from independently verified placements and customer billing.</p></div>
    {cases.length ? cases.map((item) => <DirectoryForm key={`${item.workspaceId}:${item.projectId}:${item.directoryId}:${item.revision}`} item={item} />) : <p className="admin-empty">No provisioned directory tasks are available.</p>}
  </section>;
}
