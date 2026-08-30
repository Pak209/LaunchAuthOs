"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Brain, Briefcase, Buildings, ChartLineUp, Check, CheckCircle, CirclesFour,
  Compass, FileText, GlobeHemisphereWest, LinkSimple, ListChecks, MagnifyingGlass,
  Megaphone, Package, PaperPlaneTilt, RocketLaunch, ShieldCheck, Sparkle, SquaresFour,
  SignOut, Target, UserFocus,
} from "@phosphor-icons/react";
import type { AnalysisResult, Claim, PersistedAnalysisResult } from "@/lib/types";
import {
  AuthorityGraph, AuthorityScore, BrandIntelligenceCard, CampaignAsset, CampaignTimeline,
  DistributionProgress, EvidenceBadge, MetricCard, OpportunityCard, PackageCard, PlacementCard,
  type TimelineStep,
} from "./components";

type View = "Command Center" | "Brand Intelligence" | "Campaign Studio" | "Distribution Center" | "Authority Graph" | "Packages";

const navItems: Array<{ label: View; icon: typeof SquaresFour }> = [
  { label: "Command Center", icon: SquaresFour },
  { label: "Brand Intelligence", icon: Briefcase },
  { label: "Campaign Studio", icon: Megaphone },
  { label: "Distribution Center", icon: GlobeHemisphereWest },
  { label: "Authority Graph", icon: CirclesFour },
  { label: "Packages", icon: Package },
];

function ProductMark() {
  return <span className="product-mark"><CirclesFour weight="duotone" size={23} /></span>;
}

function AppShell({ activeView, setActiveView, hasIntelligence, children }: { activeView: View; setActiveView: (view: View) => void; hasIntelligence: boolean; children: React.ReactNode }) {
  return (
    <main className="signal-shell">
      <aside className="signal-sidebar">
        <div className="signal-brand"><ProductMark /><div><strong>Launch Auth</strong><span>AI launch & authority engine</span></div></div>
        <nav aria-label="Product navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={activeView === label ? "active" : ""} onClick={() => setActiveView(label)} aria-label={label} title={label}>
              <Icon size={18} weight={activeView === label ? "duotone" : "regular"} />
              <span>{label}</span>
              {activeView !== label ? <ArrowRight size={12} /> : null}
            </button>
          ))}
        </nav>
        <div className="side-spacer" />
        <div className="client-card">
          <span className="client-monogram">LA</span>
          <div><strong>{hasIntelligence ? "Launch workspace" : "New workspace"}</strong><small>{hasIntelligence ? "Evidence-first V0.1" : "Setup not started"}</small></div>
          <EvidenceBadge state={hasIntelligence ? "ACTIVE" : "SETUP"} tone={hasIntelligence ? "positive" : "neutral"} />
        </div>
        <div className="advisor-card">
          <Sparkle size={17} weight="duotone" />
          <strong>Your Launch Advisor</strong>
          <p>{hasIntelligence ? "Authority opportunities will appear as your evidence grows." : "Start with your public company website. Your workspace will grow from verified evidence."}</p>
        </div>
      </aside>
      <section className="signal-main">{children}</section>
    </main>
  );
}

function TopBar({ activeView, hasIntelligence, persistence, canSignOut }: { activeView: View; hasIntelligence: boolean; persistence?: "local" | "saved"; canSignOut: boolean }) {
  return (
    <header className="topbar">
      <div><h1>{activeView}</h1><p>{activeView === "Command Center" ? "Outcome-first overview. Understand momentum at a glance." : "Launch intelligence grounded in verified evidence."}</p></div>
      <div className="topbar-actions">
        <EvidenceBadge state={hasIntelligence ? (persistence === "saved" ? "SAVED WORKSPACE" : "LOCAL ANALYSIS") : "GETTING STARTED"} tone={hasIntelligence && persistence === "saved" ? "positive" : "neutral"} />
        <button className="mode-button intelligence"><Brain size={15} /> Intelligence</button>
        <button className="mode-button authority"><ShieldCheck size={15} /> Authority</button>
        {canSignOut ? <form action="/auth/signout" method="post"><button className="profile-avatar" title="Sign out" aria-label="Sign out"><SignOut size={17} /></button></form> : null}
      </div>
    </header>
  );
}

function IntelligenceInput({ url, setUrl, submit, status, error }: { url: string; setUrl: (url: string) => void; submit: (event: FormEvent) => void; status: string; error: string }) {
  return (
    <section className="intelligence-input">
      <div className="input-copy"><Target size={19} weight="duotone" /><div><strong>Analyze company intelligence</strong><span>Start with a public URL. Every result must retain its source.</span></div></div>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="company-url">Company URL</label>
        <MagnifyingGlass size={17} />
        <input id="company-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://yourcompany.com" autoComplete="url" spellCheck={false} required />
        <button type="submit" disabled={status === "loading"}>{status === "loading" ? "Analyzing…" : "Run intelligence"}<ArrowRight size={14} /></button>
      </form>
      {error ? <p className="input-error" role="alert">{error}</p> : null}
    </section>
  );
}

const setupSteps = [
  { title: "Analyze your company", body: "Add your public website. Launch Auth reads a bounded set of pages and preserves every source it uses.", state: "Start here" },
  { title: "Review your intelligence", body: "Confirm the company profile, edit assumptions, and inspect the source behind every claim.", state: "After analysis" },
  { title: "Approve a campaign", body: "Select defensible claims, approve them, and generate a campaign draft grounded in that evidence.", state: "After review" },
  { title: "Track real outcomes", body: "Distribution and authority views stay empty until submissions, placements, or indexing are actually observed.", state: "After launch" },
] as const;

function SetupGuide() {
  function focusCompanyUrl() {
    document.getElementById("company-url")?.focus();
  }

  return (
    <div className="setup-guide">
      <section className="surface setup-hero" aria-labelledby="setup-title">
        <div>
          <span className="setup-kicker">Your workspace starts empty</span>
          <h2 id="setup-title">Build your first source-backed launch.</h2>
          <p>Launch Auth will never fill a new account with pretend reach, placements, or authority. Add your website to create the first real intelligence record.</p>
          <button className="primary-button" onClick={focusCompanyUrl}>Start with your website <ArrowRight size={14} /></button>
        </div>
        <aside className="setup-promise">
          <ShieldCheck size={27} weight="duotone" />
          <div><strong>Evidence before metrics</strong><span>Numbers appear only when they are calculated from your analysis or observed from real outcomes.</span></div>
        </aside>
      </section>

      <section className="surface setup-path">
        <div className="surface-heading"><div><span>How Launch Auth works</span><small>Follow this path from company URL to measurable authority</small></div><EvidenceBadge state="4 STEPS" tone="accent" /></div>
        <ol>
          {setupSteps.map((step, index) => (
            <li className={index === 0 ? "active" : ""} key={step.title}>
              <span className="setup-step-number">{index + 1}</span>
              <div><strong>{step.title}</strong><p>{step.body}</p></div>
              <small>{step.state}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="setup-learn" aria-labelledby="workspace-guide-title">
        <div className="setup-learn-heading"><div><h2 id="workspace-guide-title">Know where everything lives</h2><p>Each area has one job. You can explore them now; they will remain honest empty states until the required evidence exists.</p></div></div>
        <div className="setup-learn-grid">
          <article className="surface"><Briefcase size={22} weight="duotone" /><strong>Brand Intelligence</strong><p>Your sourced company profile, editable claims, audience gaps, and the pages used as evidence.</p></article>
          <article className="surface"><Megaphone size={22} weight="duotone" /><strong>Campaign Studio</strong><p>Where you approve evidence and turn verified facts into launch narratives and campaign assets.</p></article>
          <article className="surface"><GlobeHemisphereWest size={22} weight="duotone" /><strong>Distribution Center</strong><p>A truthful ledger of submissions and outcomes. Nothing is marked published until it is observed.</p></article>
          <article className="surface"><CirclesFour size={22} weight="duotone" /><strong>Authority Graph</strong><p>Your growing footprint across sources, placements, directories, backlinks, search, and AI visibility.</p></article>
        </div>
      </section>

      <section className="surface setup-ready">
        <CheckCircle size={22} weight="duotone" />
        <div><strong>Before you begin</strong><p>Use a public company homepage with a clear product description. About, product, pricing, and contact pages help the analysis find stronger evidence.</p></div>
      </section>
    </div>
  );
}

function CommandCenter({ result, status, openCampaign }: { result: AnalysisResult | null; status: string; openCampaign: () => void }) {
  if (!result) return <SetupGuide />;
  const score = result.readiness.score;
  const metrics = { placements: 0, directories: 0, backlinks: 0, ai: "Not measured", search: "Not measured" };
  const opportunity = result.readiness.strongestStoryAngle;
  const timeline: TimelineStep[] = [
    { label: "Discover", meta: "Complete", state: "complete" },
    { label: "Strategy", meta: "Ready", state: "complete" },
    { label: "Review", meta: status === "approved" || status === "campaign" ? "Approved" : "Pending", state: status === "approved" || status === "campaign" ? "complete" : "pending" },
    { label: "Campaign", meta: status === "campaign" ? "Draft ready" : "Waiting", state: status === "campaign" ? "active" : "pending" },
    { label: "Distribution", meta: "Not connected", state: "locked" },
    { label: "Monitor", meta: "Not active", state: "locked" },
  ];

  return (
    <div className="command-grid">
      <AuthorityScore score={score} delta="Source-backed readiness proxy" />
      <div className="metric-ribbon">
        <MetricCard icon={Buildings} label="Media placements" value={metrics.placements} change="No distribution" />
        <MetricCard icon={Briefcase} label="Directories" value={metrics.directories} change="Not submitted" />
        <MetricCard icon={LinkSimple} label="Backlinks" value={metrics.backlinks} change="Not observed" />
        <MetricCard icon={Brain} label="AI visibility" value={metrics.ai} change="Not measured" />
        <MetricCard icon={MagnifyingGlass} label="Search presence" value={metrics.search} change="Not measured" />
      </div>
      <CampaignTimeline steps={timeline} campaignId="CURRENT" />
      <OpportunityCard score={Math.min(100, result.readiness.score + 18)} narrative={opportunity} evidence={result.readiness.score} onBuild={openCampaign} demo={false} />
      <AuthorityGraph score={score} demo={false} />
      <section className="surface recent-wins">
        <div className="surface-heading"><div><span>Observed evidence</span><small>Truthful status, source by source</small></div><EvidenceBadge state="1 OBSERVED" tone="positive" /></div>
        <PlacementCard title={result.profile.company} subtitle="Homepage source" state="PUBLISHED SOURCE" href={result.profile.sourceUrl} />
      </section>
      <DistributionProgress published={0} processing={0} submitted={0} pending={0} demo={false} />
      <section className="surface next-action">
        <Sparkle size={19} weight="fill" />
        <div><span>Recommended next action</span><p>Review every extracted claim, then build a conservative campaign draft.</p></div>
        <button className="secondary-button" onClick={openCampaign}>Open Campaign Studio</button>
      </section>
      <div className="pulse-metrics">
        <MetricCard icon={RocketLaunch} label="Launch readiness" value={`${score} / 100`} change={score >= 70 ? "Promising" : "Needs evidence"} compact />
        <MetricCard icon={ShieldCheck} label="Evidence integrity" value="Verified" change="Source preserved" compact />
        <MetricCard icon={ChartLineUp} label="Momentum" value="Baseline" change="Ready to track" compact />
      </div>
    </div>
  );
}

function BrandIntelligence({ result, claims, editClaim, saveEvidence }: { result: PersistedAnalysisResult | null; claims: Claim[]; editClaim: (id: string, text: string) => void; saveEvidence: () => void }) {
  if (!result) return <EmptyIntelligence title="No company intelligence yet" body="Run intelligence from the Command Center to build a source-backed brand model." />;
  return (
    <div className="brand-intelligence-layout">
      <BrandIntelligenceCard icon={Briefcase} label="Company identity" value={result.profile.company} state="VERIFIED" source={result.profile.sourceUrl} />
      <BrandIntelligenceCard icon={RocketLaunch} label="Product" value={result.profile.product} state="VERIFIED" source={result.profile.sourceUrl} />
      <BrandIntelligenceCard icon={Target} label="Positioning" value={result.profile.positioning} state={result.profile.positioning.startsWith("UNKNOWN") ? "UNKNOWN" : "VERIFIED"} source={result.profile.sourceUrl} wide />
      <BrandIntelligenceCard icon={UserFocus} label="Audience" value={result.profile.audience} state="UNKNOWN" />
      <BrandIntelligenceCard icon={Compass} label="Category & competitors" value="Requires founder confirmation and bounded competitor research." state="MISSING" />
      <section className="surface intelligence-claims">
        <div className="surface-heading"><div><span>Approved claims</span><small>Each claim retains its source and approval state</small></div><EvidenceBadge state={`${claims.filter((claim) => claim.approved).length}/${claims.length} APPROVED`} tone="neutral" /></div>
        {claims.map((claim) => <div className="intelligence-claim" key={claim.id}><EvidenceBadge state={claim.state} tone={claim.state === "VERIFIED" ? "positive" : "warning"} /><textarea aria-label={`Edit claim: ${claim.text}`} value={claim.text} onChange={(event) => editClaim(claim.id, event.target.value)} /><a href={claim.sourceUrl} target="_blank" rel="noreferrer">View source <ArrowRight size={12} /></a></div>)}
        <div className="evidence-save"><button className="secondary-button" onClick={saveEvidence}>{result.persistence === "saved" ? "Save evidence edits" : "Apply evidence edits locally"}</button><span>Edited source claims become assumed until reviewed and approved.</span></div>
      </section>
      <section className="surface missing-intelligence">
        <div className="surface-heading"><div><span>Missing intelligence</span><small>What the system still needs before paid distribution</small></div></div>
        {result.readiness.missingInformation.map((item) => <div className="missing-row" key={item}><span /><p>{item}</p><EvidenceBadge state="REQUIRED" tone="warning" /></div>)}
      </section>
      <section className="surface source-evidence">
        <div className="surface-heading"><div><span>Observed source pages</span><small>Bounded, same-origin crawl evidence</small></div><EvidenceBadge state={`${result.sources?.length ?? 1} SOURCES`} tone="positive" /></div>
        <div className="source-grid">{(result.sources ?? [{ url: result.profile.sourceUrl, title: result.profile.company, description: result.profile.positioning }]).map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}><GlobeHemisphereWest size={17} weight="duotone" /><span><strong>{source.title || new URL(source.url).pathname}</strong><small>{new URL(source.url).pathname || "/"}</small></span><ArrowRight size={12} /></a>)}</div>
      </section>
    </div>
  );
}

function CampaignStudio({ result, claims, toggleClaim, approvable, status, approve, generate }: { result: AnalysisResult | null; claims: Claim[]; toggleClaim: (id: string) => void; approvable: boolean; status: string; approve: () => void; generate: () => void }) {
  if (!result) return <EmptyIntelligence title="Campaign intelligence is waiting" body="Analyze a company first. Launch Auth will turn verified facts into a defensible campaign narrative." />;
  const generated = status === "campaign";
  return (
    <div className="campaign-studio">
      <div className="studio-flow">{["Discover", "Strategy", "Build", "Review", "Launch"].map((step, index) => <span className={index < 2 || generated ? "complete" : index === 2 ? "active" : ""} key={step}>{index < 2 || generated ? <Check size={13} /> : index + 1}{step}</span>)}</div>
      <section className="surface narrative-hero">
        <div><EvidenceBadge state="RECOMMENDED NARRATIVE" tone="accent" /><h2>{result.readiness.strongestStoryAngle}</h2><p>This recommendation is deliberately conservative and derived from the observed homepage evidence.</p></div>
        <div className="narrative-scores"><span><strong>{Math.min(100, result.readiness.score + 18)}</strong>Newsworthiness</span><span><strong>{Math.max(40, result.readiness.score - 2)}</strong>Differentiation</span><span><strong>{result.readiness.score}</strong>Evidence strength</span></div>
      </section>
      <section className="surface claim-review">
        <div className="surface-heading"><div><span>Claim approval</span><small>No paid or generated campaign action can outrun approved evidence.</small></div><EvidenceBadge state={`${claims.filter((claim) => claim.approved).length}/${claims.length} REVIEWED`} tone={approvable ? "positive" : "warning"} /></div>
        {claims.map((claim) => <label className="premium-claim" key={claim.id}><input type="checkbox" checked={claim.approved} onChange={() => toggleClaim(claim.id)} /><span className="check-control"><Check size={12} /></span><div><strong>{claim.text}</strong><a href={claim.sourceUrl} target="_blank" rel="noreferrer">{new URL(claim.sourceUrl).hostname} <ArrowRight size={11} /></a></div><EvidenceBadge state={claim.state} tone={claim.state === "VERIFIED" ? "positive" : "warning"} /></label>)}
        <div className="review-actions"><button className="primary-button" disabled={!approvable || status === "approved" || generated} onClick={approve}>Approve claims <Check size={14} /></button><span>Approval unlocks campaign generation.</span></div>
      </section>
      <div className="asset-grid">
        {["Press Release", "Headlines", "Founder Quotes", "Company Boilerplate", "Product Hunt", "Directories", "Social", "FAQ", "Structured Data"].map((asset, index) => <CampaignAsset key={asset} name={asset} icon={index === 0 ? FileText : index < 4 ? Megaphone : index < 7 ? PaperPlaneTilt : ListChecks} state={generated ? "DRAFT READY" : "LOCKED"} />)}
      </div>
      <div className="studio-generate"><button className="primary-button" disabled={status !== "approved"} onClick={generate}>Build campaign draft <ArrowRight size={14} /></button>{generated ? <p role="status"><Check size={15} /> Campaign draft ready. Distribution remains disconnected.</p> : <p>Approve evidence before generation.</p>}</div>
    </div>
  );
}

function DistributionCenter({ result }: { result: AnalysisResult | null }) {
  if (!result) return <EmptyIntelligence title="Distribution has not started" body="Analyze your company and approve a campaign first. Submission counts and placement statuses will appear only after real fulfillment begins." />;
  return (
    <div className="distribution-center">
      <section className="surface distribution-hero">
        <div><EvidenceBadge state="FULFILLMENT STATUS" tone="accent" /><h2>0 / 0 outlets published</h2><p>Statuses stay truthful: submitted, editorial review, published, indexed, pending, or failed.</p></div>
        <EvidenceBadge state="PROVIDER NOT CONNECTED" tone="warning" />
      </section>
      <DistributionProgress published={0} processing={0} submitted={0} pending={0} demo={false} large />
      <section className="surface distribution-timeline">
        <div className="surface-heading"><div><span>Campaign timeline</span><small>Customer-facing fulfillment without supplier exposure</small></div></div>
        {[
          ["Strategy approved", "READY", "neutral"],
          ["Press release approved", "WAITING", "warning"],
          ["Distribution processing", "NOT STARTED", "neutral"],
          ["Directory submissions", "NOT STARTED", "neutral"],
          ["Authority monitoring", "NOT ACTIVE", "neutral"],
        ].map(([label, state, tone]) => <div className="timeline-row" key={label}><span className="timeline-icon"><Check size={13} /></span><strong>{label}</strong><EvidenceBadge state={state} tone={tone as "neutral" | "warning"} /></div>)}
      </section>
      <section className="surface placement-ledger">
        <div className="surface-heading"><div><span>Placement evidence ledger</span><small>Only observed outcomes appear here</small></div></div>
        <PlacementCard title={result.profile.company} subtitle="Observed company homepage" state="PUBLISHED SOURCE" href={result.profile.sourceUrl} />
      </section>
    </div>
  );
}

function AuthorityGraphScreen({ result }: { result: AnalysisResult | null }) {
  if (!result) return <EmptyIntelligence title="Your authority graph is empty" body="Analyze your company first. The graph will grow only from verified sources and observed authority signals." />;
  return <div className="graph-screen"><AuthorityGraph score={result.readiness.score} demo={false} expanded /><div className="graph-legend">{["Media", "Search", "Directories", "Backlinks", "AI", "Social"].map((item) => <span key={item}><i />{item}<small>0 verified nodes</small></span>)}</div><section className="surface graph-explanation"><Sparkle size={20} weight="duotone" /><div><h2>Your authority footprint</h2><p>The graph grows only as verified placements, directory approvals, indexed sources, backlinks, and detected authority signals are recorded.</p></div></section></div>;
}

function PackagesScreen() {
  return <div className="packages-screen"><div className="package-intro"><h2>Choose the outcome, not a pile of placements.</h2><p>Pricing remains an experiment. Final fulfillment depends on verified supplier economics and campaign eligibility.</p></div><div className="package-grid"><PackageCard name="Launch" promise="Establish your presence." price="$299" features={["Launch intelligence", "Campaign creation", "Foundational distribution"]} /><PackageCard name="Authority" promise="Become difficult to ignore." price="$699" features={["Premium distribution", "Directory fulfillment", "Authority tracking"]} recommended /><PackageCard name="Authority+" promise="Own your category." price="$999" features={["Expanded distribution", "AI visibility observation", "Ongoing authority intelligence"]} /></div></div>;
}

function EmptyIntelligence({ title, body }: { title: string; body: string }) {
  return <section className="empty-intelligence"><span><Brain size={31} weight="duotone" /></span><h2>{title}</h2><p>{body}</p><EvidenceBadge state="ANALYSIS REQUIRED" tone="warning" /></section>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("Command Center");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<PersistedAnalysisResult | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "approved" | "campaign">("idle");
  const [error, setError] = useState("");
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const approvable = useMemo(() => claims.length > 0 && claims.every((claim) => claim.approved), [claims]);

  useEffect(() => {
    let active = true;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login");
          return null;
        }
        if (!response.ok) return null;
        const payload = await response.json();
        if (active) setPersistenceEnabled(Boolean(payload.configured));
        return payload.project as PersistedAnalysisResult | null;
      })
      .then((project) => {
        if (!active || !project) return;
        setResult(project);
        setClaims(project.profile.claims);
        setUrl(project.profile.sourceUrl);
        setStatus(project.campaignStatus === "draft_ready" ? "campaign" : project.campaignStatus === "approved" ? "approved" : "ready");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setStatus("loading");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
      setResult(payload); setClaims(payload.profile.claims); setStatus("ready");
    } catch (caught) {
      setResult(null); setClaims([]); setError(caught instanceof Error ? caught.message : "Analysis failed."); setStatus("idle");
    }
  }

  function toggleClaim(id: string) { setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, approved: !claim.approved } : claim)); }

  function editClaim(id: string, text: string) {
    setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, text, state: "ASSUMED", approved: false } : claim));
    setStatus("ready");
  }

  async function saveCampaign(nextStatus: "evidence_review" | "approved" | "campaign") {
    setError("");
    if (!result?.projectId) {
      setStatus(nextStatus === "evidence_review" ? "ready" : nextStatus);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${result.projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claims, status: nextStatus }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the campaign.");
      setStatus(nextStatus === "evidence_review" ? "ready" : nextStatus);
      setResult((current) => current ? { ...current, campaignStatus: nextStatus === "campaign" ? "draft_ready" : nextStatus } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the campaign.");
    }
  }

  return (
    <AppShell activeView={activeView} setActiveView={setActiveView} hasIntelligence={Boolean(result)}>
      <TopBar activeView={activeView} hasIntelligence={Boolean(result)} persistence={result?.persistence} canSignOut={persistenceEnabled} />
      {error && activeView !== "Command Center" ? <p className="workspace-error" role="alert">{error}</p> : null}
      {activeView === "Command Center" ? <IntelligenceInput url={url} setUrl={setUrl} submit={submit} status={status} error={error} /> : null}
      {activeView === "Command Center" ? <CommandCenter result={result} status={status} openCampaign={() => setActiveView("Campaign Studio")} /> : null}
      {activeView === "Brand Intelligence" ? <BrandIntelligence result={result} claims={claims} editClaim={editClaim} saveEvidence={() => void saveCampaign("evidence_review")} /> : null}
      {activeView === "Campaign Studio" ? <CampaignStudio result={result} claims={claims} toggleClaim={toggleClaim} approvable={approvable} status={status} approve={() => void saveCampaign("approved")} generate={() => void saveCampaign("campaign")} /> : null}
      {activeView === "Distribution Center" ? <DistributionCenter result={result} /> : null}
      {activeView === "Authority Graph" ? <AuthorityGraphScreen result={result} /> : null}
      {activeView === "Packages" ? <PackagesScreen /> : null}
    </AppShell>
  );
}
