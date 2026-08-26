"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AnalysisResult, Claim } from "@/lib/types";

const navItems = ["Overview", "Brand Profile", "Readiness", "Campaign", "Distribution", "Evidence"] as const;

function Mark() {
  return <span className="mark" aria-hidden="true"><i /><i /><i /></span>;
}

function NavIcon({ name }: { name: typeof navItems[number] }) {
  const paths = {
    Overview: <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" /></>,
    "Brand Profile": <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2.2" /><path d="M8.5 16c.8-2 2-3 3.5-3s2.7 1 3.5 3" /></>,
    Readiness: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2M17.5 4.5 20 7" /></>,
    Campaign: <><path d="m4 13 3-2 9-5v12l-9-5-3-2v2Z" /><path d="M8 14.5 9.5 20h3L11 16M18.5 8.5l2-1M18.5 15.5l2 1" /></>,
    Distribution: <><path d="m3 11 18-8-7 18-3.5-7.5L3 11Z" /><path d="m10.5 13.5 4-4" /></>,
    Evidence: <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M15 3v5h4M9 12h6M9 16h6" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<span aria-hidden="true">↗</span></a>;
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-score">—</div>
      <p>Analyze a public company URL to create a source-backed profile and readiness assessment.</p>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("https://example.com");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "approved" | "campaign">("idle");
  const [error, setError] = useState("");

  const approvable = useMemo(() => claims.length > 0 && claims.every((claim) => claim.approved), [claims]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
      setResult(payload);
      setClaims(payload.profile.claims);
      setStatus("ready");
    } catch (caught) {
      setResult(null);
      setClaims([]);
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
      setStatus("idle");
    }
  }

  function toggleClaim(id: string) {
    setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, approved: !claim.approved } : claim));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Mark /><strong>Launch Auth</strong></div>
        <nav aria-label="Primary navigation">
          {navItems.map((item, index) => <button className={index === 0 ? "active" : ""} key={item}><NavIcon name={item} /><span>{item}</span></button>)}
        </nav>
        <div className="workspace"><span>LA</span><div><strong>Launch workspace</strong><small>Local V0.1</small></div></div>
      </aside>

      <section className="workspace-main">
        <header>
          <h1>Find your strongest launch story.</h1>
          <p>Enter your company URL. Launch Auth builds a source-backed brand profile, scores launch readiness, and recommends the next campaign.</p>
        </header>

        <form className="url-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="company-url">Company URL</label>
          <input id="company-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />
          <button type="submit" disabled={status === "loading"}>{status === "loading" ? "Analyzing…" : "Analyze company"}</button>
        </form>
        {error ? <p className="error" role="alert">{error}</p> : null}

        <ol className="progress" aria-label="Campaign progress">
          {["Brand profile", "Readiness", "Campaign"].map((item, index) => {
            const reached = Boolean(result) && (index < 2 || status === "campaign");
            return <li className={reached ? "reached" : ""} key={item}><span>{index + 1}</span><div><strong>{item}</strong><small>{index === 0 ? "Source-backed profile" : index === 1 ? "Score your readiness" : "Generate approved assets"}</small></div></li>;
          })}
        </ol>

        <div className="summary-grid">
          <section className="panel profile-panel">
            <h2>Brand Profile <span>(source-backed)</span></h2>
            {result ? (
              <dl>
                <div><dt>Company</dt><dd>{result.profile.company}</dd><ExternalLink href={result.profile.sourceUrl}>Source</ExternalLink></div>
                <div><dt>Product</dt><dd>{result.profile.product}</dd><ExternalLink href={result.profile.sourceUrl}>Source</ExternalLink></div>
                <div><dt>Audience</dt><dd>{result.profile.audience}</dd><span className="state unknown">UNKNOWN</span></div>
                <div><dt>Positioning</dt><dd>{result.profile.positioning}</dd><ExternalLink href={result.profile.sourceUrl}>Source</ExternalLink></div>
                <div><dt>Factual claims</dt><dd>{claims.length} observed</dd><span className="state verified">EVIDENCED</span></div>
              </dl>
            ) : <EmptyState />}
          </section>

          <section className="panel readiness-panel">
            <h2>Launch Readiness</h2>
            {result ? <div className="readiness-content">
              <div className="score"><strong>{result.readiness.score}</strong><span>/100</span><small>{result.readiness.label}</small></div>
              <div className="readiness-notes">
                <h3>Rationale</h3><ul>{result.readiness.rationale.map((item) => <li key={item}>{item}</li>)}</ul>
                <h3>Missing information</h3><ul>{result.readiness.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
                <h3>Strongest story angle</h3><p>{result.readiness.strongestStoryAngle}</p>
              </div>
            </div> : <EmptyState />}
          </section>
        </div>

        <div className="detail-grid">
          <section className="panel claims-panel">
            <h2>Factual Claims <span>(review and approve)</span></h2>
            {claims.length ? <>
              <div className="claims-head"><span>Approve</span><span>Claim</span><span>Source / Evidence</span><span>Status</span></div>
              {claims.map((claim) => <label className="claim-row" key={claim.id}>
                <input type="checkbox" checked={claim.approved} onChange={() => toggleClaim(claim.id)} />
                <span>{claim.text}</span>
                <ExternalLink href={claim.sourceUrl}>{new URL(claim.sourceUrl).hostname}</ExternalLink>
                <span className={`state ${claim.state.toLowerCase()}`}>{claim.state}</span>
              </label>)}
              <div className="claim-actions">
                <button disabled={!approvable || status === "approved" || status === "campaign"} onClick={() => setStatus("approved")}>Approve claims</button>
                <small>{approvable ? "Claims are ready for approval." : "Review every factual claim before campaign generation."}</small>
              </div>
            </> : <EmptyState />}
          </section>

          <section className="panel evidence-panel">
            <h2>Evidence / Status</h2>
            <div className="evidence-table" role="table" aria-label="Distribution evidence">
              <div role="row"><strong>Result</strong><strong>State</strong><strong>Evidence</strong></div>
              <div role="row"><span>Homepage crawl</span><span className={result ? "dot published" : "dot pending"}>{result ? "Published source" : "Pending"}</span><span>{result ? <ExternalLink href={result.profile.sourceUrl}>Observed page</ExternalLink> : "Not analyzed"}</span></div>
              <div role="row"><span>PR distribution</span><span className="dot pending">Not submitted</span><span>Provider not connected</span></div>
              <div role="row"><span>Directory submissions</span><span className="dot pending">Not submitted</span><span>Human review required</span></div>
            </div>
            <div className="campaign-action">
              <button disabled={status !== "approved"} onClick={() => setStatus("campaign")}>Generate campaign</button>
              {status === "campaign" ? <p role="status"><strong>Campaign draft ready.</strong> Paid distribution remains disabled until a provider is connected and the customer approves the final release.</p> : <p>Approve claims to create a campaign draft.</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
