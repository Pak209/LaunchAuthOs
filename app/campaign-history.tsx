"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CampaignDraft } from "@/lib/types";
import type { CampaignHistoryPage, CampaignVersionPreview } from "@/lib/campaign-history";

export type CampaignHistoryProps = {
  projectId: string;
  currentVersion: number;
  disabled?: boolean;
  onRestored: (campaign: CampaignDraft) => void;
  onRestoreBusy?: (busy: boolean) => void;
};

// Changing project/version discards all previews and confirmation state. The
// server independently verifies the version and project-content digest.
export function CampaignHistory(props: CampaignHistoryProps) {
  return <CampaignHistoryPanel key={`${props.projectId}:${props.currentVersion}`} {...props} />;
}

function CampaignHistoryPanel({ projectId, currentVersion, disabled = false, onRestored, onRestoreBusy }: CampaignHistoryProps) {
  const headingId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<CampaignHistoryPage | null>(null);
  const [preview, setPreview] = useState<CampaignVersionPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"list" | "preview" | "restore" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/campaign/versions`;

  async function loadHistory(beforeVersion?: number) {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy("list"); setError(""); setPreview(null); setConfirmed(false);
    try {
      const response = await fetch(`${endpoint}${beforeVersion ? `?beforeVersion=${beforeVersion}` : ""}`, { cache: "no-store", signal: pending.signal });
      const data = await response.json() as CampaignHistoryPage & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load saved versions.");
      if (pending.signal.aborted || !mounted.current) return;
      setPage((previous) => beforeVersion && previous ? { ...data, versions: [...previous.versions, ...data.versions] } : data);
    } catch (caught) {
      if (!pending.signal.aborted && mounted.current) setError(caught instanceof Error ? caught.message : "Unable to load saved versions.");
    } finally { if (!pending.signal.aborted && mounted.current) setBusy(null); }
  }

  async function loadPreview(version: number) {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy("preview"); setError(""); setPreview(null); setConfirmed(false);
    try {
      const response = await fetch(`${endpoint}?version=${version}`, { cache: "no-store", signal: pending.signal });
      const data = await response.json() as CampaignVersionPreview & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load this saved version.");
      if (!pending.signal.aborted && mounted.current) setPreview(data);
    } catch (caught) {
      if (!pending.signal.aborted && mounted.current) setError(caught instanceof Error ? caught.message : "Unable to load this saved version.");
    } finally { if (!pending.signal.aborted && mounted.current) setBusy(null); }
  }

  async function restore() {
    if (!preview || !confirmed || disabled || busy || preview.currentVersion !== currentVersion || preview.campaign.version === currentVersion) return;
    setBusy("restore"); setError("");
    onRestoreBusy?.(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: preview.campaign.version, expectedVersion: preview.currentVersion, expectedDigest: preview.currentDigest, confirmed: true }),
      });
      const data = await response.json() as { campaign?: CampaignDraft; error?: string };
      if (!response.ok || !data.campaign) throw new Error(data.error || "Unable to restore this saved version.");
      if (mounted.current) { setConfirmed(false); setPreview(null); onRestored(data.campaign); }
    } catch (caught) {
      if (mounted.current) {
        setConfirmed(false);
        setError(caught instanceof Error ? caught.message : "Unable to restore this saved version. Reload history before retrying.");
      }
    } finally { onRestoreBusy?.(false); if (mounted.current) setBusy(null); }
  }

  const stale = (preview?.currentVersion ?? page?.currentVersion ?? currentVersion) !== currentVersion;
  return <section className="surface campaign-history" aria-labelledby={headingId}>
    <div className="surface-heading">
      <div><span id={headingId}>Saved campaign versions</span><small>Preview earlier work. Restoring always creates a new draft requiring approval.</small></div>
      <button type="button" className="mode-button" aria-expanded={open} aria-controls={bodyId} disabled={busy === "restore"} onClick={() => {
        const expanded = !open;
        setOpen(expanded);
        if (expanded && !page && !busy) void loadHistory();
      }}>{open ? "Hide history" : "Version history"}</button>
    </div>
    {open ? <div id={bodyId} className="campaign-history-body" aria-busy={busy !== null}>
      <div className="campaign-editor-actions"><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void loadHistory()}>Refresh history</button></div>
      {error ? <p className="input-error" role="alert">{error}</p> : null}
      {busy ? <p role="status">{busy === "restore" ? "Restoring a new draft…" : busy === "preview" ? "Loading version preview…" : "Loading saved versions…"}</p> : null}
      {stale ? <p role="alert">The saved campaign changed in another session. Reload the project before restoring a version.</p> : null}
      {page && !page.versions.length ? <p>No saved versions are available on this page.</p> : null}
      {page?.versions.length ? <ol className="campaign-history-list" aria-label="Saved campaign versions">
        {page.versions.map((item) => <li key={item.version}>
          <div><strong>Version {item.version}{item.version === currentVersion ? " · Current" : ""}</strong><p>{new Date(item.updatedAt).toLocaleString()} · {item.status === "approved" ? "Approved at the time" : "Draft"} · {item.assetCount} assets{item.restoredFromVersion ? ` · Restored from v${item.restoredFromVersion}` : ""}</p></div>
          <button type="button" className="secondary-button" disabled={busy !== null} aria-pressed={preview?.campaign.version === item.version} onClick={() => void loadPreview(item.version)}>Preview version {item.version}</button>
        </li>)}
      </ol> : null}
      {page?.nextBeforeVersion ? <div className="campaign-editor-actions"><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void loadHistory(page.nextBeforeVersion!)}>Load older versions</button></div> : null}
      {preview ? <section className="campaign-history-preview" aria-label={`Preview of version ${preview.campaign.version}`}>
        <h3>Version {preview.campaign.version} preview</h3>
        <p>Saved {new Date(preview.campaign.updatedAt).toLocaleString()}. This preview does not change your current campaign.</p>
        {preview.campaign.assets.map((asset) => <details key={asset.id}><summary>{asset.title} · {asset.type.replaceAll("_", " ")}</summary><p>Claim references: {asset.claimIds.join(", ")}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}>{asset.content}</pre></details>)}
        {preview.campaign.version !== currentVersion ? <>
          <p>Restoring creates version {preview.currentVersion + 1} as a draft. Every asset must be reviewed and approved again. Saved history is preserved.</p>
          {disabled ? <p>Restoration is unavailable while another campaign action is in progress or fulfillment has started.</p> : null}
          <fieldset className="campaign-history-confirm" disabled={disabled || busy !== null || stale}>
            <legend>Confirm restoration</legend>
            <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand this replaces any unsaved edits with a new draft and clears campaign approval.</label>
            <div className="campaign-editor-actions"><button type="button" className="primary-button" disabled={!confirmed || disabled || busy !== null || stale} onClick={() => void restore()}>Restore version {preview.campaign.version} as new draft</button><button type="button" className="secondary-button" onClick={() => { setPreview(null); setConfirmed(false); }}>Cancel</button></div>
          </fieldset>
        </> : <p>This is the current saved version. Select an earlier version to restore.</p>}
      </section> : null}
    </div> : null}
  </section>;
}
