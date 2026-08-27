import Image from "next/image";
import { ArrowRight, Article, Check, Circle, Crosshair, LockKey, type Icon } from "@phosphor-icons/react";

export type TimelineStep = { label: string; meta: string; state: "complete" | "active" | "pending" | "locked" | "demo" };

export function EvidenceBadge({ state, tone = "neutral" }: { state: string; tone?: "positive" | "warning" | "neutral" | "accent" }) {
  return <span className={`evidence-badge ${tone}`}>{state}</span>;
}

export function AuthorityScore({ score, delta }: { score: number; delta: string }) {
  return <section className="surface authority-score"><div className="surface-heading"><div><span>Authority score</span><small>Evidence-adjusted launch signal</small></div><Circle size={14} /></div><div className="authority-score-value"><strong>{score}</strong><span>/100</span></div><p>{delta}</p><div className="score-meter"><i style={{ width: `${score}%` }} /></div></section>;
}

export function MetricCard({ icon: IconComponent, label, value, change, compact = false }: { icon: Icon; label: string; value: string | number; change: string; compact?: boolean }) {
  return <article className={`metric-card ${compact ? "compact" : ""}`}><div className="metric-label"><IconComponent size={16} weight="duotone" /><span>{label}</span></div><strong>{value}</strong><small>{change}</small></article>;
}

export function CampaignTimeline({ steps, campaignId }: { steps: TimelineStep[]; campaignId: string }) {
  return <section className="surface active-campaign"><div className="surface-heading"><div><span>Active campaign</span><small>Campaign #{campaignId}</small></div><EvidenceBadge state="LOCAL WORKSPACE" tone="neutral" /></div><div className="timeline-track">{steps.map((step) => <div className={`timeline-step ${step.state}`} key={step.label}><span>{step.state === "complete" ? <Check size={13} /> : step.state === "locked" ? <LockKey size={12} /> : <Circle size={9} weight="fill" />}</span><strong>{step.label}</strong><small>{step.meta}</small></div>)}</div></section>;
}

export function OpportunityCard({ score, narrative, evidence, onBuild, demo }: { score: number; narrative: string; evidence: number; onBuild: () => void; demo: boolean }) {
  return <section className="surface opportunity-card"><div className="surface-heading"><div><span>Opportunity intelligence</span><small>The highest-leverage next move</small></div><EvidenceBadge state={demo ? "DEMO OPPORTUNITY" : "SOURCE-BACKED"} tone="warning" /></div><div className="opportunity-body"><div><h2>{score}/100 newsworthiness signal.</h2><p>Recommended narrative</p><blockquote>“{narrative}”</blockquote><div className="signal-row"><EvidenceBadge state={`NEWS ${score}`} tone="positive" /><EvidenceBadge state={`EVIDENCE ${evidence}`} tone="positive" /><EvidenceBadge state={demo ? "DEMO" : "OBSERVED"} tone={demo ? "warning" : "accent"} /></div><button className="primary-button" onClick={onBuild}>Build campaign <ArrowRight size={14} /></button></div><div className="opportunity-signal" aria-hidden="true"><Crosshair size={88} weight="duotone" /></div></div></section>;
}

export function AuthorityGraph({ score, demo, expanded = false }: { score: number; demo: boolean; expanded?: boolean }) {
  return <section className={`surface authority-graph ${expanded ? "expanded" : ""}`}><div className="surface-heading"><div><span>Authority graph</span><small>Verified presence across the internet</small></div><EvidenceBadge state={demo ? "DEMO TOPOLOGY" : "0 VERIFIED NODES"} tone={demo ? "warning" : "neutral"} /></div><div className="graph-visual"><Image src="/assets/authority-graph.png" alt="Authority network topology with a central brand hub and six evidence clusters" fill sizes={expanded ? "80vw" : "380px"} priority /><div className="graph-score"><strong>{score}</strong><span>Authority</span></div></div></section>;
}

export function PlacementCard({ title, subtitle, state, href }: { title: string; subtitle: string; state: string; href?: string }) {
  return <article className="placement-card"><span className="placement-logo"><Article size={17} weight="duotone" /></span><div><strong>{title}</strong><small>{subtitle}</small></div><EvidenceBadge state={state} tone={state === "DEMO" ? "warning" : "positive"} />{href ? <a href={href} target="_blank" rel="noreferrer" aria-label={`Open source for ${title}`}><ArrowRight size={13} /></a> : null}</article>;
}

export function DistributionProgress({ published, processing, submitted, pending, demo, large = false }: { published: number; processing: number; submitted: number; pending: number; demo: boolean; large?: boolean }) {
  return <section className={`surface distribution-progress ${large ? "large" : ""}`}><div className="surface-heading"><div><span>Distribution progress</span><small>{demo ? "Illustrative global reach" : "Observed fulfillment only"}</small></div><EvidenceBadge state={demo ? "DEMO MAP" : "NO SUBMISSIONS"} tone={demo ? "warning" : "neutral"} /></div><div className="map-visual"><Image src="/assets/distribution-map.png" alt="World distribution map with connection paths from a North American hub" fill sizes={large ? "80vw" : "500px"} /></div><div className="distribution-counts"><span><strong>{published}</strong>Published</span><span><strong>{processing}</strong>Processing</span><span><strong>{submitted}</strong>Submitted</span><span><strong>{pending}</strong>Pending</span></div></section>;
}

export function BrandIntelligenceCard({ icon: IconComponent, label, value, state, source, wide = false }: { icon: Icon; label: string; value: string; state: string; source?: string; wide?: boolean }) {
  return <article className={`surface intelligence-card ${wide ? "wide" : ""}`}><div className="intelligence-card-icon"><IconComponent size={20} weight="duotone" /></div><div><span>{label}</span><h2>{value}</h2>{source ? <a href={source} target="_blank" rel="noreferrer">View evidence <ArrowRight size={11} /></a> : <small>No evidence source yet</small>}</div><EvidenceBadge state={state} tone={state === "VERIFIED" ? "positive" : "warning"} /></article>;
}

export function CampaignAsset({ name, icon: IconComponent, state }: { name: string; icon: Icon; state: string }) {
  return <article className="campaign-asset"><IconComponent size={20} weight="duotone" /><div><strong>{name}</strong><small>Generated from approved claims</small></div><EvidenceBadge state={state} tone={state === "DRAFT READY" ? "positive" : "neutral"} /></article>;
}

export function PackageCard({ name, promise, price, features, recommended = false }: { name: string; promise: string; price: string; features: string[]; recommended?: boolean }) {
  return <article className={`package-card ${recommended ? "recommended" : ""}`}>{recommended ? <EvidenceBadge state="RECOMMENDED" tone="accent" /> : null}<span className="package-name">{name}</span><h2>{promise}</h2><strong className="package-price">{price}<small> hypothesis</small></strong><ul>{features.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}</ul><button className={recommended ? "primary-button" : "secondary-button"}>Select {name}<ArrowRight size={13} /></button></article>;
}
