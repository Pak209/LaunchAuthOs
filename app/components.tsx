import { ArrowRight, Article, Check, Circle, Crosshair, LockKey, type Icon } from "@phosphor-icons/react";

export type TimelineStep = { label: string; meta: string; state: "complete" | "active" | "pending" | "locked" | "demo" };

export function EvidenceBadge({ state, tone = "neutral" }: { state: string; tone?: "positive" | "warning" | "neutral" | "accent" }) {
  return <span className={`evidence-badge ${tone}`}>{state}</span>;
}

export function AuthorityScore({ score, delta }: { score: number; delta: string }) {
  return <section className="surface authority-score"><div className="surface-heading"><div><span>Launch readiness</span><small>Heuristic, not measured authority</small></div><Circle size={14} /></div><div className="authority-score-value"><strong>{score}</strong><span>/100</span></div><p>{delta}</p><div className="score-meter"><i style={{ width: `${score}%` }} /></div></section>;
}

export function MetricCard({ icon: IconComponent, label, value, change, compact = false }: { icon: Icon; label: string; value: string | number; change: string; compact?: boolean }) {
  return <article className={`metric-card ${compact ? "compact" : ""}`}><div className="metric-label"><IconComponent size={16} weight="duotone" /><span>{label}</span></div><strong>{value}</strong><small>{change}</small></article>;
}

export function CampaignTimeline({ steps, campaignId }: { steps: TimelineStep[]; campaignId: string }) {
  return <section className="surface active-campaign"><div className="surface-heading"><div><span>Campaign progress</span><small>Campaign #{campaignId}</small></div><EvidenceBadge state="RECORDED STATE" tone="neutral" /></div><div className="timeline-track">{steps.map((step) => <div className={`timeline-step ${step.state}`} key={step.label}><span>{step.state === "complete" ? <Check size={13} /> : step.state === "locked" ? <LockKey size={12} /> : <Circle size={9} weight="fill" />}</span><strong>{step.label}</strong><small>{step.meta}</small></div>)}</div></section>;
}

export function OpportunityCard({ score, narrative, evidence, onBuild, demo }: { score: number; narrative: string; evidence: number; onBuild: () => void; demo: boolean }) {
  return <section className="surface opportunity-card"><div className="surface-heading"><div><span>Launch narrative</span><small>Candidate angle for your review</small></div><EvidenceBadge state={demo ? "DEMO" : "REVIEW REQUIRED"} tone="warning" /></div><div className="opportunity-body"><div><h2>Turn your evidence into a story.</h2><p>Suggested narrative</p><blockquote>“{narrative}”</blockquote><div className="signal-row"><EvidenceBadge state={`READINESS ${score}/100`} /><EvidenceBadge state={`${evidence} SOURCE PAGES`} /></div><button className="primary-button" onClick={onBuild}>Open campaign <ArrowRight size={14} /></button></div><div className="opportunity-signal" aria-hidden="true"><Crosshair size={88} weight="duotone" /></div></div></section>;
}

export function AuthorityGraph({ sources, publications, directories, expanded = false }: { sources: number; publications: number | string; directories: number | string; expanded?: boolean }) {
  return <section className={`surface authority-graph evidence-footprint ${expanded ? "expanded" : ""}`}><div className="surface-heading"><div><span>Evidence footprint</span><small>Recorded evidence, without an invented network</small></div><EvidenceBadge state="LEDGER SUMMARY" /></div><dl><div><dt>Captured source pages</dt><dd>{sources}</dd></div><div><dt>Recorded media publications</dt><dd>{publications}</dd></div><div><dt>Operator-recorded directory listings</dt><dd>{directories}</dd></div></dl><p>Network visualization, independent indexing, backlink measurements and AI visibility are not available yet. Source pages are not media placements.</p></section>;
}

export function PlacementCard({ title, subtitle, state, href }: { title: string; subtitle: string; state: string; href?: string }) {
  return <article className="placement-card"><span className="placement-logo"><Article size={17} weight="duotone" /></span><div><strong>{title}</strong><small>{subtitle}</small></div><EvidenceBadge state={state} tone={/FAILED|REMOVED|REJECTED|ERROR/.test(state) ? "warning" : /PUBLISHED|INDEXED/.test(state) ? "positive" : "neutral"} />{href ? <a href={href} target="_blank" rel="noreferrer" aria-label={`Open source for ${title}`}><ArrowRight size={13} /></a> : null}</article>;
}

export function DistributionProgress({ published, accepted, submitted, failed, removed, available, sandbox = false, large = false }: { published: number; accepted: number; submitted: number; failed: number; removed: number; available: boolean; sandbox?: boolean; large?: boolean }) {
  return <section className={`surface distribution-progress ${large ? "large" : ""}`}><div className="surface-heading"><div><span>Placement status</span><small>Unique recorded URLs · no promised outlet total</small></div><EvidenceBadge state={!available ? "UNAVAILABLE" : sandbox ? "SANDBOX" : "RECORDED OUTCOMES"} tone={!available || sandbox ? "warning" : "neutral"} /></div><div className="distribution-counts recorded-counts">{[["Published", published], ["Accepted", accepted], ["Submitted", submitted], ["Failed", failed], ["Removed", removed]].map(([label, count]) => <span key={label}><strong>{available ? count : "—"}</strong>{label}</span>)}</div><p className="evidence-note">Published includes supplier-reported indexed URLs. HTTP checks establish availability, not article accuracy, search indexing or earned editorial coverage.</p></section>;
}

export function BrandIntelligenceCard({ icon: IconComponent, label, value, state, source, wide = false }: { icon: Icon; label: string; value: string; state: string; source?: string; wide?: boolean }) {
  return <article className={`surface intelligence-card ${wide ? "wide" : ""}`}><div className="intelligence-card-icon"><IconComponent size={20} weight="duotone" /></div><div><span>{label}</span><h2>{value}</h2>{source ? <a href={source} target="_blank" rel="noreferrer">View evidence <ArrowRight size={11} /></a> : <small>No evidence source yet</small>}</div><EvidenceBadge state={state} tone={state === "VERIFIED" ? "positive" : "warning"} /></article>;
}

export function CampaignAsset({ name, icon: IconComponent, state }: { name: string; icon: Icon; state: string }) {
  return <article className="campaign-asset"><IconComponent size={20} weight="duotone" /><div><strong>{name}</strong><small>Generated from approved claims</small></div><EvidenceBadge state={state} tone={state === "DRAFT READY" ? "positive" : "neutral"} /></article>;
}

export function PackageCard({ name, promise, price, features, recommended = false, disabled = false, action }: { name: string; promise: string; price: string; features: string[]; recommended?: boolean; disabled?: boolean; action: () => void }) {
  return <article className={`package-card ${recommended ? "recommended" : ""}`}>{recommended ? <EvidenceBadge state="RECOMMENDED" tone="accent" /> : null}<span className="package-name">{name}</span><h2>{promise}</h2><strong className="package-price">{price}</strong><ul>{features.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}</ul><button disabled={disabled} onClick={action} className={recommended ? "primary-button" : "secondary-button"}>Select {name}<ArrowRight size={13} /></button></article>;
}
