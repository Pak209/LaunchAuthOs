"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Brain, Briefcase, Buildings, ChartLineUp, Check, CheckCircle, CirclesFour,
  FileText, GlobeHemisphereWest, LinkSimple, ListChecks, MagnifyingGlass,
  Megaphone, Package, PaperPlaneTilt, RocketLaunch, ShieldCheck, Sparkle, SquaresFour,
  SignOut, Target,
} from "@phosphor-icons/react";
import type { AnalysisResult, Claim, FindingKind, FulfillmentState, PersistedAnalysisResult, ProjectSummary } from "@/lib/types";
import {
  AuthorityGraph, AuthorityScore, CampaignAsset, CampaignTimeline,
  DistributionProgress, EvidenceBadge, MetricCard, OpportunityCard, PackageCard, PlacementCard,
  type TimelineStep,
} from "./components";

type View = "Command Center" | "Brand Intelligence" | "Campaign Studio" | "Distribution Center" | "Authority Graph" | "Reports" | "Packages";
type DistributionDetails = { packageId: "launch" | "authority" | "authority_plus"; country: string; city: string; categories: string[]; contactName: string; contactEmail: string };

const navItems: Array<{ label: View; icon: typeof SquaresFour }> = [
  { label: "Command Center", icon: SquaresFour },
  { label: "Brand Intelligence", icon: Briefcase },
  { label: "Campaign Studio", icon: Megaphone },
  { label: "Distribution Center", icon: GlobeHemisphereWest },
  { label: "Authority Graph", icon: CirclesFour },
  { label: "Reports", icon: FileText },
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

function TopBar({ activeView, hasIntelligence, persistence, canSignOut, projects, projectId, selectProject, newProject }: { activeView: View; hasIntelligence: boolean; persistence?: "local" | "saved"; canSignOut: boolean; projects: ProjectSummary[]; projectId?: string; selectProject: (id: string) => void; newProject: () => void }) {
  return (
    <header className="topbar">
      <div><h1>{activeView}</h1><p>{activeView === "Command Center" ? "Outcome-first overview. Understand momentum at a glance." : "Launch intelligence grounded in verified evidence."}</p></div>
      <div className="topbar-actions">
        {projects.length ? <select className="project-switcher" aria-label="Current project" value={projectId ?? ""} onChange={(event) => selectProject(event.target.value)}><option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select> : null}
        {projects.length ? <button className="mode-button" onClick={newProject}>New project</button> : null}
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

const findingKinds: Array<{ kind: FindingKind; label: string }> = [
  { kind: "product", label: "Products" }, { kind: "audience", label: "Target audiences" },
  { kind: "positioning", label: "Positioning" }, { kind: "founder", label: "Founders" },
  { kind: "milestone", label: "Milestones" }, { kind: "proof_point", label: "Proof points" },
  { kind: "competitor", label: "Competitors" },
];

function BrandIntelligence({ result, claims, editClaim, editProfile, editFinding, addFinding, saveEvidence, saveState }: { result: PersistedAnalysisResult | null; claims: Claim[]; editClaim: (id: string, text: string) => void; editProfile: (field: "company" | "product" | "audience" | "positioning", value: string) => void; editFinding: (kind: FindingKind, id: string, value: string) => void; addFinding: (kind: FindingKind) => void; saveEvidence: () => void; saveState: "idle" | "saving" | "saved" | "failed" }) {
  if (!result) return <EmptyIntelligence title="No company intelligence yet" body="Run intelligence from the Command Center to build a source-backed brand model." />;
  return (
    <div className="brand-intelligence-layout">
      <section className="surface profile-editor">
        <div className="surface-heading"><div><span>Editable company profile</span><small>Corrections autosave and become founder-provided evidence</small></div><EvidenceBadge state={saveState === "saving" ? "SAVING" : saveState === "failed" ? "SAVE FAILED" : saveState === "saved" ? "SAVED" : "READY"} tone={saveState === "failed" ? "warning" : saveState === "saved" ? "positive" : "neutral"} /></div>
        <div className="profile-fields">
          <label>Company<input value={result.profile.company} onChange={(event) => editProfile("company", event.target.value)} /></label>
          <label>Product<input value={result.profile.product} onChange={(event) => editProfile("product", event.target.value)} /></label>
          <label>Audience<textarea value={result.profile.audience} onChange={(event) => editProfile("audience", event.target.value)} /></label>
          <label>Positioning<textarea value={result.profile.positioning} onChange={(event) => editProfile("positioning", event.target.value)} /></label>
        </div>
      </section>
      <section className="surface structured-findings">
        <div className="surface-heading"><div><span>Structured findings</span><small>Every finding includes confidence, freshness, and an immutable evidence snapshot</small></div><EvidenceBadge state={`${Object.values(result.profile.findings).flat().length} FINDINGS`} tone="accent" /></div>
        <div className="finding-groups">{findingKinds.map(({ kind, label }) => <div className="finding-group" key={kind}><div className="finding-group-title"><strong>{label}</strong><button onClick={() => addFinding(kind)}>Add</button></div>{result.profile.findings[kind].length ? result.profile.findings[kind].map((finding) => <div className="finding-row" key={finding.id}><textarea aria-label={`Edit ${label} finding`} value={finding.value} onChange={(event) => editFinding(kind, finding.id, event.target.value)} /><span>{Math.round(finding.confidence * 100)}% confidence<br />Observed {new Date(finding.observedAt).toLocaleDateString()}</span><a href={finding.sourceUrl} target="_blank" rel="noreferrer">Source</a></div>) : <p>No public finding yet.</p>}</div>)}</div>
      </section>
      <section className="surface intelligence-claims">
        <div className="surface-heading"><div><span>Approved claims</span><small>Each claim retains its source and approval state</small></div><EvidenceBadge state={`${claims.filter((claim) => claim.approved).length}/${claims.length} APPROVED`} tone="neutral" /></div>
        {claims.map((claim) => <div className="intelligence-claim" key={claim.id}><EvidenceBadge state={claim.state} tone={claim.state === "VERIFIED" ? "positive" : "warning"} /><textarea aria-label={`Edit claim: ${claim.text}`} value={claim.text} onChange={(event) => editClaim(claim.id, event.target.value)} /><a href={claim.sourceUrl} target="_blank" rel="noreferrer">View source <ArrowRight size={12} /></a></div>)}
        <div className="evidence-save"><button className="secondary-button" onClick={saveEvidence}>{saveState === "saving" ? "Saving…" : result.persistence === "saved" ? "Save now" : "Apply evidence edits locally"}</button><span>Edits autosave after a short pause. Edited source claims become assumed until reviewed and approved.</span></div>
      </section>
      <section className="surface missing-intelligence">
        <div className="surface-heading"><div><span>Missing intelligence</span><small>What the system still needs before paid distribution</small></div></div>
        {result.readiness.missingInformation.map((item) => <div className="missing-row" key={item}><span /><p>{item}</p><EvidenceBadge state="REQUIRED" tone="warning" /></div>)}
      </section>
      <section className="surface source-evidence">
        <div className="surface-heading"><div><span>Observed source pages</span><small>Bounded, same-origin crawl evidence</small></div><EvidenceBadge state={`${result.sources?.length ?? 1} SOURCES`} tone="positive" /></div>
        <div className="source-grid">{(result.sources ?? []).map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><GlobeHemisphereWest size={17} weight="duotone" /><span><strong>{source.title || new URL(source.url).pathname}</strong><small>{new URL(source.url).pathname || "/"} · captured {new Date(source.capturedAt).toLocaleDateString()}</small></span><ArrowRight size={12} /></a>)}</div>
      </section>
    </div>
  );
}

function CampaignStudio({ result, claims, toggleClaim, approvable, status, approve, generate, editAsset, saveAssets, exportAssets, generationStatus }: { result: PersistedAnalysisResult | null; claims: Claim[]; toggleClaim: (id: string) => void; approvable: boolean; status: string; approve: () => void; generate: () => void; editAsset: (id: string, field: "title" | "content", value: string) => void; saveAssets: (status: "draft" | "approved") => void; exportAssets: () => void; generationStatus: "idle" | "generating" | "saving" }) {
  if (!result) return <EmptyIntelligence title="Campaign intelligence is waiting" body="Analyze a company first. Launch Auth will turn verified facts into a defensible campaign narrative." />;
  const campaign = result.campaign;
  const generated = Boolean(campaign);
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
      {campaign ? <section className="surface campaign-editor">
        <div className="surface-heading"><div><span>Campaign asset editor</span><small>Version {campaign.version} · {campaign.model} · generated {new Date(campaign.generatedAt).toLocaleString()}</small></div><EvidenceBadge state={campaign.status} tone={campaign.status === "approved" ? "positive" : "accent"} /></div>
        <div className="campaign-editor-assets">{campaign.assets.map((asset) => <label key={asset.id}><span><input aria-label={`Edit ${asset.type} title`} value={asset.title} onChange={(event) => editAsset(asset.id, "title", event.target.value)} /><small>{asset.claimIds.length} approved evidence reference{asset.claimIds.length === 1 ? "" : "s"}{asset.type === "press_release" ? ` · ${asset.content.split(/\s+/).filter(Boolean).length} words` : ""}</small></span><textarea value={asset.content} aria-label={`Edit ${asset.title}`} onChange={(event) => editAsset(asset.id, "content", event.target.value)} /></label>)}</div>
        <div className="campaign-editor-actions"><button className="secondary-button" disabled={generationStatus !== "idle"} onClick={() => saveAssets("draft")}>Save new version</button><button className="primary-button" disabled={generationStatus !== "idle"} onClick={() => saveAssets("approved")}>Approve campaign</button><button className="secondary-button" onClick={exportAssets}>Download assets</button><button className="secondary-button" disabled={generationStatus !== "idle"} onClick={generate}>Regenerate</button></div>
      </section> : <div className="asset-grid">
        {["Press Release", "Headlines", "Founder Quotes", "Company Boilerplate", "Social Posts", "Directory Copy", "FAQ", "Structured Data"].map((asset, index) => <CampaignAsset key={asset} name={asset} icon={index === 0 ? FileText : index < 4 ? Megaphone : index < 6 ? PaperPlaneTilt : ListChecks} state="LOCKED" />)}
      </div>}
      <div className="studio-generate"><button className="primary-button" disabled={(!generated && status !== "approved") || generationStatus !== "idle"} onClick={generate}>{generationStatus === "generating" ? "Generating evidence-bound assets…" : generated ? "Regenerate campaign" : "Build campaign draft"}<ArrowRight size={14} /></button>{generated ? <p role="status"><Check size={15} /> Real campaign assets are stored with version history. Distribution remains disconnected.</p> : <p>Approve evidence before generation.</p>}</div>
    </div>
  );
}

function DistributionCenter({ result, fulfillment, prepare, loading }: { result: PersistedAnalysisResult | null; fulfillment: FulfillmentState | null; prepare: (details: DistributionDetails) => void; loading: boolean }) {
  const [country, setCountry] = useState("United States");
  const [packageId, setPackageId] = useState<DistributionDetails["packageId"]>("launch");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState("Technology");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  if (!result) return <EmptyIntelligence title="Distribution has not started" body="Analyze your company and approve a campaign first. Submission counts and placement statuses will appear only after real fulfillment begins." />;
  const campaignApproved = result.campaign?.status === "approved";
  const directories = fulfillment?.directories ?? [];
  return (
    <div className="distribution-center">
      <section className="surface distribution-hero">
        <div><EvidenceBadge state="FULFILLMENT STATUS" tone="accent" /><h2>0 / 0 outlets published</h2><p>Statuses stay truthful: submitted, editorial review, published, indexed, pending, or failed.</p></div>
        <EvidenceBadge state={fulfillment?.order ? `${fulfillment.order.provider} · ${fulfillment.order.status}` : campaignApproved ? "READY TO PREPARE" : "CAMPAIGN APPROVAL REQUIRED"} tone={fulfillment?.order ? "accent" : "warning"} />
      </section>
      <DistributionProgress published={0} processing={0} submitted={0} pending={0} demo={false} large />
      <section className="surface distribution-timeline">
        <div className="surface-heading"><div><span>Campaign timeline</span><small>Customer-facing fulfillment without supplier exposure</small></div></div>
        {[
          ["Strategy approved", "READY", "neutral"],
          ["Campaign approved", campaignApproved ? "APPROVED" : "WAITING", campaignApproved ? "neutral" : "warning"],
          ["Provider order", fulfillment?.order?.status?.replaceAll("_", " ").toUpperCase() ?? "NOT PREPARED", fulfillment?.order ? "neutral" : "warning"],
          ["Directory submissions", directories.length ? `${directories.length} PREPARED` : "NOT PREPARED", "neutral"],
          ["Authority monitoring", "NOT ACTIVE", "neutral"],
        ].map(([label, state, tone]) => <div className="timeline-row" key={label}><span className="timeline-icon"><Check size={13} /></span><strong>{label}</strong><EvidenceBadge state={state} tone={tone as "neutral" | "warning"} /></div>)}
      </section>
      {!fulfillment?.order ? <form className="surface fulfillment-prepare" onSubmit={(event) => {
        event.preventDefault();
        prepare({ packageId, country: country.trim(), city: city.trim(), categories: categories.split(",").map((value) => value.trim()).filter(Boolean), contactName: contactName.trim(), contactEmail: contactEmail.trim() });
      }}><ShieldCheck size={22} weight="duotone" /><div className="fulfillment-copy"><strong>Prepare fulfillment safely</strong><p>Choose the customer package and confirm the dateline, categories, and authorized media contact. The supplier plan, cost, credits, and Stripe package become one immutable order.</p></div><div className="distribution-intake-fields"><label><span>Package</span><select value={packageId} onChange={(event) => setPackageId(event.target.value as DistributionDetails["packageId"])}><option value="launch">Launch</option><option value="authority">Authority</option><option value="authority_plus">Authority+</option></select></label><label><span>Country</span><input required minLength={2} maxLength={120} value={country} onChange={(event) => setCountry(event.target.value)} /></label><label><span>City</span><input required maxLength={120} placeholder="Dateline city" value={city} onChange={(event) => setCity(event.target.value)} /></label><label><span>Categories</span><input required placeholder="Technology, Business" value={categories} onChange={(event) => setCategories(event.target.value)} /></label><label><span>Media contact</span><input required minLength={2} maxLength={120} placeholder="Full name" value={contactName} onChange={(event) => setContactName(event.target.value)} /></label><label><span>Contact email</span><input required type="email" maxLength={254} placeholder="press@company.com" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label></div><button className="primary-button" disabled={!campaignApproved || loading || !city.trim() || !categories.trim() || !contactName.trim() || !contactEmail.trim()}>{loading ? "Preparing…" : "Validate & prepare"}</button></form> : null}
      {directories.length ? <section className="surface directory-queue"><div className="surface-heading"><div><span>Assisted directory queue</span><small>Human and customer actions remain explicit</small></div></div>{directories.map((submission) => <div className="directory-row" key={submission.id}><div><strong>{submission.directory}</strong><small>{submission.mode}</small></div><p>{submission.requiredActions.join(" · ")}</p><EvidenceBadge state={submission.status} tone="warning" /></div>)}</section> : null}
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

function ReportsScreen({ result, fulfillment }: { result: PersistedAnalysisResult | null; fulfillment: FulfillmentState | null }) {
  if (!result?.projectId) return <EmptyIntelligence title="No authority report yet" body="Analyze a company first. Reports are generated only from saved evidence and observed outcomes." />;
  const placementCount = fulfillment?.placements?.length ?? 0;
  return <div className="reports-screen"><section className="surface report-hero"><FileText size={28} weight="duotone" /><div><EvidenceBadge state="SOURCE-BACKED" tone="positive" /><h2>{result.profile.company} authority report</h2><p>Includes immutable evidence hashes, approved claims, campaign asset status, directory progress, and every observed placement state.</p></div><a className="primary-button" href={`/api/projects/${result.projectId}/report?format=markdown`}>Download report <ArrowRight size={14} /></a></section><div className="report-metrics"><MetricCard icon={GlobeHemisphereWest} label="Evidence snapshots" value={result.sources?.length ?? 0} change="Captured and hashed" /><MetricCard icon={ShieldCheck} label="Approved claims" value={result.profile.claims.filter((claim) => claim.approved).length} change="Evidence-linked" /><MetricCard icon={Megaphone} label="Campaign assets" value={result.campaign?.assets.length ?? 0} change={result.campaign?.status ?? "Not generated"} /><MetricCard icon={Buildings} label="Observed placements" value={placementCount} change={placementCount ? "Live ledger" : "None observed"} /></div><section className="surface report-integrity"><ShieldCheck size={22} weight="duotone" /><div><strong>Report integrity</strong><p>Submitted, accepted, published, indexed, failed, and removed remain distinct. A source page or submission is never presented as a media placement.</p></div></section></div>;
}

type BillingOffer = { packageId: "launch" | "authority" | "authority_plus"; amount: number | null; currency: string; active: boolean; type: string };

function PackagesScreen({ offers, eligible, selectedPackageId, checkoutLoading, checkout }: { offers: BillingOffer[]; eligible: boolean; selectedPackageId?: BillingOffer["packageId"]; checkoutLoading: boolean; checkout: (packageId: BillingOffer["packageId"]) => void }) {
  const price = (packageId: BillingOffer["packageId"]) => {
    const offer = offers.find((candidate) => candidate.packageId === packageId);
    if (!offer?.active || offer.type !== "one_time" || offer.amount == null) return "Not configured";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: offer.currency.toUpperCase(), maximumFractionDigits: 0 }).format(offer.amount / 100);
  };
  const enabled = (packageId: BillingOffer["packageId"]) => eligible && selectedPackageId === packageId && !checkoutLoading && price(packageId) !== "Not configured";
  return <div className="packages-screen"><div className="package-intro"><h2>Choose the outcome, not a pile of placements.</h2><p>{eligible ? `Your ${selectedPackageId?.replaceAll("_", " ") ?? "selected"} supplier quote is locked to secure Stripe Checkout.` : "Checkout unlocks only after the campaign is approved and an eligible fulfillment order is prepared. Live charges remain disabled for sandbox fulfillment."}</p></div><div className="package-grid"><PackageCard name="Launch" promise="Establish your presence." price={price("launch")} features={["Launch intelligence", "Campaign creation", "Foundational distribution"]} disabled={!enabled("launch")} action={() => checkout("launch")} /><PackageCard name="Authority" promise="Become difficult to ignore." price={price("authority")} features={["Premium distribution", "Directory fulfillment", "Authority tracking"]} recommended disabled={!enabled("authority")} action={() => checkout("authority")} /><PackageCard name="Authority+" promise="Own your category." price={price("authority_plus")} features={["Expanded distribution", "AI visibility observation", "Ongoing authority intelligence"]} disabled={!enabled("authority_plus")} action={() => checkout("authority_plus")} /></div></div>;
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [generationStatus, setGenerationStatus] = useState<"idle" | "generating" | "saving">("idle");
  const [fulfillment, setFulfillment] = useState<FulfillmentState | null>(null);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [billingOffers, setBillingOffers] = useState<BillingOffer[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const approvable = useMemo(() => claims.length > 0 && claims.every((claim) => claim.approved), [claims]);

  function applyProject(project: PersistedAnalysisResult) {
    setResult(project);
    setClaims(project.profile.claims);
    setUrl(project.profile.sourceUrl);
    setStatus(project.campaignStatus === "draft_ready" ? "campaign" : project.campaignStatus === "approved" ? "approved" : "ready");
    setSaveState("saved");
  }

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
        if (active) setProjects(payload.projects ?? []);
        return payload.project as PersistedAnalysisResult | null;
      })
      .then((project) => {
        if (!active || !project) return;
        applyProject(project);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!autosaveRevision || !result) return;
    const timer = window.setTimeout(() => void saveCampaign("evidence_review", true), 900);
    return () => window.clearTimeout(timer);
    // autosaveRevision intentionally represents a complete edit snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveRevision]);

  useEffect(() => {
    if ((activeView !== "Distribution Center" && activeView !== "Packages" && activeView !== "Reports") || !result?.projectId) return;
    let active = true;
    fetch(`/api/projects/${result.projectId}/fulfillment`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to load fulfillment.");
      if (active) setFulfillment(payload.fulfillment);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load fulfillment."); });
    return () => { active = false; };
  }, [activeView, result?.projectId]);

  useEffect(() => {
    if (activeView !== "Packages") return;
    let active = true;
    fetch("/api/billing/packages", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Billing packages are unavailable.");
      if (active) setBillingOffers(payload.offers ?? []);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Billing packages are unavailable."); });
    return () => { active = false; };
  }, [activeView]);

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
      applyProject(payload);
      if (payload.projectId) {
        const summary: ProjectSummary = { id: payload.projectId, name: payload.profile.company, url: payload.profile.sourceUrl, campaignStatus: "evidence_review", updatedAt: payload.fetchedAt };
        setProjects((current) => [summary, ...current.filter((project) => project.id !== payload.projectId)]);
      }
    } catch (caught) {
      setResult(null); setClaims([]); setError(caught instanceof Error ? caught.message : "Analysis failed."); setStatus("idle");
    }
  }

  function toggleClaim(id: string) { setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, approved: !claim.approved } : claim)); }

  function editClaim(id: string, text: string) {
    setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, text, state: "ASSUMED", approved: false } : claim));
    setStatus("ready"); setSaveState("idle"); setAutosaveRevision((revision) => revision + 1);
  }

  function editProfile(field: "company" | "product" | "audience" | "positioning", value: string) {
    setResult((current) => current ? { ...current, profile: { ...current.profile, [field]: value } } : current);
    setStatus("ready"); setSaveState("idle"); setAutosaveRevision((revision) => revision + 1);
  }

  function editFinding(kind: FindingKind, id: string, value: string) {
    setResult((current) => current ? { ...current, profile: { ...current.profile, findings: { ...current.profile.findings, [kind]: current.profile.findings[kind].map((finding) => finding.id === id ? { ...finding, value, confidence: Math.min(finding.confidence, 0.6) } : finding) } } } : current);
    setStatus("ready"); setSaveState("idle"); setAutosaveRevision((revision) => revision + 1);
  }

  function addFinding(kind: FindingKind) {
    if (!result) return;
    const source = result.sources?.[0];
    if (!source) return;
    const finding = { id: `manual-${kind}-${Date.now()}`, kind, value: "Founder confirmation required", sourceUrl: source.url, evidenceId: source.id, confidence: 0.5, observedAt: new Date().toISOString() };
    setResult((current) => current ? { ...current, profile: { ...current.profile, findings: { ...current.profile.findings, [kind]: [...current.profile.findings[kind], finding] } } } : current);
    setStatus("ready"); setSaveState("idle"); setAutosaveRevision((revision) => revision + 1);
  }

  async function saveCampaign(nextStatus: "evidence_review" | "approved" | "campaign", autosave = false) {
    setError("");
    if (!result?.projectId) {
      setStatus(nextStatus === "evidence_review" ? "ready" : nextStatus);
      setSaveState("saved");
      return;
    }
    if (autosave || nextStatus === "evidence_review") setSaveState("saving");
    try {
      const response = await fetch(`/api/projects/${result.projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { ...result.profile, claims }, claims, status: nextStatus }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the campaign.");
      setStatus(nextStatus === "evidence_review" ? "ready" : nextStatus);
      setResult((current) => current ? { ...current, profile: { ...current.profile, claims }, campaignStatus: nextStatus === "campaign" ? "draft_ready" : nextStatus } : current);
      setProjects((current) => current.map((project) => project.id === result.projectId ? { ...project, name: result.profile.company, campaignStatus: nextStatus === "campaign" ? "draft_ready" : nextStatus, updatedAt: new Date().toISOString() } : project));
      setSaveState("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the campaign.");
      setSaveState("failed");
    }
  }

  async function selectProject(projectId: string) {
    if (!projectId || projectId === result?.projectId) return;
    setError(""); setSaveState("idle");
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to load the project.");
      applyProject(payload.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the project.");
    }
  }

  function newProject() {
    setResult(null); setClaims([]); setUrl(""); setStatus("idle"); setError(""); setSaveState("idle"); setActiveView("Command Center");
  }

  async function generateCampaign() {
    if (!result?.projectId) return setError("Save the project before generating a campaign.");
    setError(""); setGenerationStatus("generating");
    try {
      const response = await fetch(`/api/projects/${result.projectId}/campaign/generate`, { method: "POST" });
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate the campaign.");
      setResult((current) => current ? { ...current, campaign: payload.campaign, campaignStatus: "draft_ready" } : current);
      setStatus("campaign");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the campaign.");
    } finally {
      setGenerationStatus("idle");
    }
  }

  function editCampaignAsset(id: string, field: "title" | "content", value: string) {
    setResult((current) => current?.campaign ? { ...current, campaign: { ...current.campaign, status: "draft", assets: current.campaign.assets.map((asset) => asset.id === id ? { ...asset, [field]: value, status: "draft" } : asset) } } : current);
  }

  async function saveCampaignAssets(nextStatus: "draft" | "approved") {
    if (!result?.projectId || !result.campaign) return;
    setError(""); setGenerationStatus("saving");
    try {
      const response = await fetch(`/api/projects/${result.projectId}/campaign`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assets: result.campaign.assets, status: nextStatus }) });
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the campaign.");
      setResult((current) => current ? { ...current, campaign: payload.campaign } : current);
      if (nextStatus === "approved") setProjects((current) => current.map((project) => project.id === result.projectId ? { ...project, campaignStatus: "campaign_approved" } : project));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the campaign.");
    } finally {
      setGenerationStatus("idle");
    }
  }

  function exportCampaignAssets() {
    if (!result?.campaign) return;
    const markdown = result.campaign.assets.map((asset) => `# ${asset.title}\n\n${asset.content}\n\nEvidence: ${asset.claimIds.join(", ")}`).join("\n\n---\n\n");
    const href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = href; anchor.download = `${result.profile.company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-campaign-v${result.campaign.version}.md`; anchor.click();
    URL.revokeObjectURL(href);
  }

  async function prepareFulfillmentState(details: DistributionDetails) {
    if (!result?.projectId) return;
    setError(""); setFulfillmentLoading(true);
    try {
      const response = await fetch(`/api/projects/${result.projectId}/fulfillment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(details) });
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to prepare fulfillment.");
      setFulfillment(payload.fulfillment);
      setResult((current) => current ? { ...current, campaignStatus: "awaiting_payment" } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare fulfillment.");
    } finally {
      setFulfillmentLoading(false);
    }
  }

  async function startCheckout(packageId: BillingOffer["packageId"]) {
    if (!result?.projectId) return;
    setError(""); setCheckoutLoading(true);
    try {
      const response = await fetch(`/api/projects/${result.projectId}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageId }) });
      const payload = await response.json();
      if (response.status === 401) return void window.location.assign("/login");
      if (!response.ok) throw new Error(payload.error ?? "Unable to start checkout.");
      window.location.assign(payload.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start checkout.");
      setCheckoutLoading(false);
    }
  }

  return (
    <AppShell activeView={activeView} setActiveView={setActiveView} hasIntelligence={Boolean(result)}>
      <TopBar activeView={activeView} hasIntelligence={Boolean(result)} persistence={result?.persistence} canSignOut={persistenceEnabled} projects={projects} projectId={result?.projectId} selectProject={(id) => void selectProject(id)} newProject={newProject} />
      {error && activeView !== "Command Center" ? <p className="workspace-error" role="alert">{error}</p> : null}
      {activeView === "Command Center" ? <IntelligenceInput url={url} setUrl={setUrl} submit={submit} status={status} error={error} /> : null}
      {activeView === "Command Center" ? <CommandCenter result={result} status={status} openCampaign={() => setActiveView("Campaign Studio")} /> : null}
      {activeView === "Brand Intelligence" ? <BrandIntelligence result={result} claims={claims} editClaim={editClaim} editProfile={editProfile} editFinding={editFinding} addFinding={addFinding} saveEvidence={() => void saveCampaign("evidence_review")} saveState={saveState} /> : null}
      {activeView === "Campaign Studio" ? <CampaignStudio result={result} claims={claims} toggleClaim={toggleClaim} approvable={approvable} status={status} approve={() => void saveCampaign("approved")} generate={() => void generateCampaign()} editAsset={editCampaignAsset} saveAssets={(nextStatus) => void saveCampaignAssets(nextStatus)} exportAssets={exportCampaignAssets} generationStatus={generationStatus} /> : null}
      {activeView === "Distribution Center" ? <DistributionCenter result={result} fulfillment={fulfillment} prepare={(details) => void prepareFulfillmentState(details)} loading={fulfillmentLoading} /> : null}
      {activeView === "Authority Graph" ? <AuthorityGraphScreen result={result} /> : null}
      {activeView === "Reports" ? <ReportsScreen result={result} fulfillment={fulfillment} /> : null}
      {activeView === "Packages" ? <PackagesScreen offers={billingOffers} eligible={result?.campaign?.status === "approved" && fulfillment?.order?.status === "awaiting_payment"} selectedPackageId={fulfillment?.order?.selectedPackageId} checkoutLoading={checkoutLoading} checkout={(packageId) => void startCheckout(packageId)} /> : null}
    </AppShell>
  );
}
