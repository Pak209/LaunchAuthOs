"use client";

import { useEffect, useRef, useState } from "react";
import type { SiteDiagnosticJob, SiteDiagnosticState } from "@/lib/site-diagnostic-jobs";
import type { SiteDiagnosticReport, SiteDiagnosticResult } from "@/lib/site-diagnostic-types";
import styles from "./site-diagnostics.module.css";

const pending = (job: SiteDiagnosticJob | null) => Boolean(job && ["queued", "scheduled", "running"].includes(job.status));
const resultLabels: Record<SiteDiagnosticResult, string> = { pass: "Observed pass", issue: "Needs review", not_checked: "Not checked", not_applicable: "Not applicable" };
const readable = (text: string) => text.replaceAll("_", " ");
const date = (text: string) => new Date(text).toLocaleString();

function download(report: SiteDiagnosticReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `launch-auth-site-diagnostics-${report.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function SavedSiteDiagnostics({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SiteDiagnosticState>({ job: null, report: null });
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<"all" | "issue" | "not_checked">("all");
  const requestId = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const activeWrite = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transientFailures = useRef(0);
  const endpoint = `/api/projects/${projectId}/diagnostics`;

  useEffect(() => () => { requestId.current++; activeRead.current?.abort(); activeWrite.current?.abort(); clearTimeout(pollTimer.current); }, []);
  useEffect(() => {
    const controller = new AbortController();
    activeRead.current = controller;
    const sequence = ++requestId.current;
    let retryable = true;
    function schedule(delay: number) {
      clearTimeout(pollTimer.current);
      pollTimer.current = setTimeout(() => {
        if (!controller.signal.aborted && sequence === requestId.current) setRefresh((value) => value + 1);
      }, delay);
    }
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load site diagnostics.");
        if (controller.signal.aborted || sequence !== requestId.current) return;
        setState(payload as SiteDiagnosticState);
        setHasLoaded(true);
        setError("");
        transientFailures.current = 0;
        if (pending(payload.job)) schedule(3_000);
      } catch (problem) {
        if (!controller.signal.aborted && sequence === requestId.current) {
          const canRetry = retryable && transientFailures.current < 3;
          setError(`${problem instanceof Error ? problem.message : "Unable to load site diagnostics."} ${canRetry ? "Status will retry automatically." : "Use Refresh status to try again."}`);
          if (canRetry) schedule(3_000 * 2 ** transientFailures.current++);
        }
      } finally {
        if (!controller.signal.aborted && sequence === requestId.current) setLoading(false);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(pollTimer.current); };
  }, [endpoint, refresh]);

  async function start() {
    if (!authorized || submitting || pending(state.job)) return;
    const controller = new AbortController();
    activeWrite.current = controller;
    clearTimeout(pollTimer.current);
    activeRead.current?.abort();
    const sequence = ++requestId.current;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authorized: true }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to queue site diagnostics.");
      if (controller.signal.aborted || sequence !== requestId.current) return;
      setState((current) => ({ ...current, job: payload.job }));
      setAuthorized(false);
      setRefresh((value) => value + 1);
    } catch (problem) {
      if (!controller.signal.aborted && sequence === requestId.current) setError(problem instanceof Error ? problem.message : "Unable to queue site diagnostics.");
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  const { job, report } = state;
  const findings = report?.findings.filter((finding) => filter === "all" || finding.result === filter) ?? [];
  return <section className={`surface ${styles.panel}`} aria-label="Customer-site diagnostics">
    <div className="surface-heading"><div><span>Customer-site diagnostics</span><small>Public-site observations, separate from campaign approval and search-index evidence</small></div></div>
    <div className={styles.body}>
      <p>Inspect the saved company URL and up to three linked pages on the same origin. We check crawl rules, HTTP responses, indexing directives, declared canonicals, and bounded sitemap evidence. We do not execute JavaScript or confirm search-engine indexing.</p>
      <label className={styles.consent}><input type="checkbox" checked={authorized} disabled={submitting || pending(job)} onChange={(event) => setAuthorized(event.target.checked)} /><span>I own this company site or am authorized to request a bounded public-site diagnostic.</span></label>
      <div className={styles.actions}>
        <button className="primary-button" disabled={!authorized || loading || submitting || pending(job)} onClick={() => void start()}>{submitting ? "Queueing…" : pending(job) ? "Diagnostic in progress" : "Run site diagnostic"}</button>
        <button className="secondary-button" disabled={loading || submitting} onClick={() => { transientFailures.current = 0; setLoading(true); setRefresh((value) => value + 1); }}>{loading ? "Loading…" : "Refresh status"}</button>
        {report && <button className="secondary-button" onClick={() => download(report)}>Download diagnostic evidence</button>}
      </div>
      {error && <p role="alert" className={styles.error}>{error} Existing saved evidence is not changed.</p>}
      {job && <div className={styles.notice} role="status"><strong>Latest diagnostic: {readable(job.status)}</strong><span>{job.message || (pending(job) ? "Background processing requires the configured job scheduler. You can leave this page and return later." : "This status describes the diagnostic job, not search indexing.")}</span><code>{job.url}</code></div>}
      {!hasLoaded && !loading && <div className={styles.empty}><strong>Diagnostic history unavailable</strong><p>We could not determine whether a saved report exists. Refresh to check again.</p></div>}
      {hasLoaded && !report && !loading && <div className={styles.empty}><strong>No completed diagnostic yet</strong><p>{pending(job) ? "Your report will appear after the worker completes the inspection." : "Run an authorized inspection to begin collecting real evidence. Unchecked data is not treated as zero or success."}</p></div>}
      {report && <>
        <div className={styles.reportHeading}><div><h3>Latest saved report</h3><code>{report.targetUrl}</code><p>Completed {date(report.completedAt)}{pending(job) ? " · Previous report retained while the next run processes" : ""}</p></div><span className={styles.indexStatus}>Index inclusion: not checked</span></div>
        <dl className={styles.scope}><div><dt>Pages retrieved</dt><dd>{report.scope.retrievedPageCount} of {report.scope.attemptedPageCount} attempted</dd></div><div><dt>Page limit</dt><dd>{report.scope.maxPages}, same origin</dd></div><div><dt>JavaScript rendering</dt><dd>Not checked</dd></div><div><dt>Robots policy</dt><dd>{readable(report.robots.state)}</dd></div></dl>
        <div className={styles.filters} role="group" aria-label="Filter diagnostic findings">{(["all", "issue", "not_checked"] as const).map((value) => <button key={value} className="secondary-button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All findings" : value === "issue" ? "Needs review" : "Not checked"}</button>)}</div>
        <div className={styles.findings}>{findings.length ? findings.map((finding) => <article key={finding.id} className={styles.finding}>
          <div className={styles.findingTitle}><strong>{readable(finding.check)}{finding.agent ? ` · ${finding.agent}` : ""}</strong><span data-result={finding.result}>{resultLabels[finding.result]}</span></div>
          <code>{finding.url}</code><p>{finding.reason}</p><small>{date(finding.capturedAt)} · {finding.checkedScope}</small>
          <details><summary>Supporting evidence ({finding.evidenceIds.length})</summary>{finding.evidenceIds.length ? finding.evidenceIds.map((id) => { const snapshot = report.snapshots.find((item) => item.id === id); return snapshot ? <div className={styles.snapshot} key={id}><code>{snapshot.url}</code><p>HTTP {snapshot.httpStatus} · Captured {date(snapshot.capturedAt)} · {snapshot.bodyComplete ? "Response complete" : "Response incomplete"} · Stored excerpts are limited</p>{snapshot.rawEvidenceTruncated ? <p>Raw evidence was omitted at the retention limit. The retained hash does not replace the missing response content.</p> : <pre>{JSON.stringify(snapshot.headers, null, 2)}{"\n"}{snapshot.relevantTags.join("\n")}{"\n"}{snapshot.rawExcerpt}</pre>}<small>SHA-256: {snapshot.contentHash}</small></div> : <p key={id}>Snapshot unavailable. Do not treat this finding as verified.</p>; }) : <p>No response snapshot is available for this observation. Read the stated limitation.</p>}</details>
        </article>) : <p>No findings in this category. This does not establish site-wide health or index inclusion.</p>}</div>
        <details className={styles.limitations}><summary>Inspection scope and limitations</summary><ul>{report.scope.limitations.map((item) => <li key={item}>{item}</li>)}</ul>{report.errors.map((item, index) => <p key={index}><code>{item.url}</code> — {item.message}</p>)}{report.scope.skippedUrls.length > 0 && <p>{report.scope.skippedUrls.length} URL(s) were skipped. The evidence download includes their reasons.</p>}</details>
      </>}
    </div>
  </section>;
}

export default function SiteDiagnostics({ projectId }: { projectId?: string }) {
  if (!projectId) return <section className={`surface ${styles.panel}`}><div className="surface-heading"><div><span>Customer-site diagnostics</span><small>Available for saved projects</small></div></div><p className={styles.body}>Save your company analysis first, then run an authorized public-site inspection. No diagnostic or indexing data has been collected yet.</p></section>;
  return <SavedSiteDiagnostics key={projectId} projectId={projectId} />;
}
