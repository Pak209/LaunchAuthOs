import Link from "next/link";
import { notFound } from "next/navigation";

type LegalDocument = { title: string; intro: string; sections: Array<{ title: string; paragraphs: string[] }> };

const documents: Record<string, LegalDocument> = {
  privacy: {
    title: "Privacy Policy",
    intro: "This draft describes how Launch Auth handles account, company, evidence, campaign, fulfillment, and payment information.",
    sections: [
      { title: "Information we process", paragraphs: ["We process account identifiers, company URLs, public webpage evidence, customer corrections, approved claims, generated campaign assets, fulfillment records, support communications, and operational logs.", "Payment card details are collected and processed by Stripe through Stripe-hosted Checkout. Launch Auth stores payment and billing status identifiers, not full card numbers."] },
      { title: "How information is used", paragraphs: ["Information is used to authenticate accounts, build source-backed company intelligence, generate approved campaign materials, fulfill purchased services, verify outcomes, prevent abuse, provide support, and improve reliability."] },
      { title: "Service providers", paragraphs: ["Firebase provides identity and database infrastructure. OpenAI may process approved campaign evidence when generation is enabled. Stripe processes checkout and payments. Distribution, directory, email, hosting, monitoring, and analytics providers must be listed here before production activation."] },
      { title: "Retention and deletion", paragraphs: ["Evidence snapshots and audit records are retained to support campaign provenance, contractual reporting, fraud prevention, and dispute handling. A production retention schedule and account-deletion process must be approved before paid launch."] },
      { title: "Your choices", paragraphs: ["Customers may correct findings, withhold claim approval, avoid campaign generation, and request access or deletion subject to legal and operational retention requirements."] },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "These draft terms govern access to the Launch Auth intelligence, campaign, distribution, and reporting service.",
    sections: [
      { title: "Customer authority", paragraphs: ["You must be authorized to act for the company, product, marks, accounts, and materials submitted. You are responsible for reviewing and approving every claim and campaign asset before distribution."] },
      { title: "Evidence and generated content", paragraphs: ["Automated findings can be incomplete or incorrect. Generated materials are drafts. Launch Auth does not authorize publication of unapproved claims and does not provide legal, financial, or investment advice."] },
      { title: "Distribution outcomes", paragraphs: ["Submission, acceptance, publication, indexing, organic pickup, and continued availability are different outcomes. Unless a final order expressly says otherwise, Launch Auth does not guarantee editorial acceptance, search ranking, media coverage, traffic, revenue, or permanent indexing."] },
      { title: "Acceptable use", paragraphs: ["You may not use the service for false, misleading, unlawful, infringing, impersonating, abusive, sanctioned, or deceptive campaigns. Launch Auth may pause a campaign for evidence, eligibility, safety, legal, supplier, or editorial review."] },
      { title: "Payments and changes", paragraphs: ["Prices, taxes, deliverables, and supplier-dependent limitations are shown before payment. Material order changes require customer approval and may change price or eligibility."] },
    ],
  },
  refunds: {
    title: "Refund Policy",
    intro: "This draft separates refundable unperformed work from external costs that have already been committed.",
    sections: [
      { title: "Before external submission", paragraphs: ["A customer may request cancellation and a refund before Launch Auth or a provider submits campaign materials or commits non-recoverable third-party costs."] },
      { title: "After submission begins", paragraphs: ["After an external submission or non-recoverable cost is committed, any refund is limited to the unused and recoverable portion of the order, except where law requires otherwise."] },
      { title: "Editorial decisions", paragraphs: ["Editorial rejection, non-indexing, ranking changes, outlet removal, or lack of organic pickup is not automatically a service failure unless the paid package expressly guaranteed that specific outcome."] },
      { title: "Our failure", paragraphs: ["If Launch Auth cannot deliver a purchased, eligible service because of our error, we will offer reasonable re-performance, substitution approved by the customer, or a refund for the affected undelivered portion."] },
      { title: "How to request", paragraphs: ["The production support address, response time, refund window, and legal entity details must be inserted and approved before paid checkout is enabled."] },
    ],
  },
  disclosures: {
    title: "Supplier and Claims Disclosures",
    intro: "Launch Auth reports what happened without inflating distribution activity into earned authority.",
    sections: [
      { title: "Supplier relationships", paragraphs: ["Launch Auth may use contracted distribution, directory, email, hosting, payment, and monitoring providers. A provider may identify itself in a dateline, hosted release, report, or destination page. Final package disclosures must name material supplier limitations before checkout."] },
      { title: "Status definitions", paragraphs: ["Submitted means materials were sent. Accepted means a destination or provider accepted them for processing. Published means a public URL was observed. Indexed means an independent index was observed. Failed means the attempted operation did not complete. Removed means a previously observed URL is no longer live."] },
      { title: "No metric inflation", paragraphs: ["A company homepage is source evidence, not a media placement. A distributed release is not necessarily an editorial article. A backlink is not necessarily indexed. Dashboard metrics remain empty until supported by stored evidence."] },
      { title: "Guarantee language", paragraphs: ["The words guaranteed, published, indexed, placement, reach, and coverage may be used only when the applicable contract and stored evidence support the precise statement."] },
    ],
  },
};

export function generateStaticParams() { return Object.keys(documents).map((document) => ({ document })); }

export default async function LegalPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const content = documents[document];
  if (!content) notFound();
  return <main className="legal-shell"><nav><Link href="/">Launch Auth</Link><span>Pre-launch legal draft</span></nav><article><span className="legal-status">Draft — owner and counsel approval required</span><h1>{content.title}</h1><p className="legal-intro">{content.intro}</p>{content.sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}<footer><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/legal/refunds">Refunds</Link><Link href="/legal/disclosures">Disclosures</Link></footer></article></main>;
}
