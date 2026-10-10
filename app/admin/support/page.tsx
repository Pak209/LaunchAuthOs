import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FieldPath } from "firebase-admin/firestore";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { supportCollections, supportItem, validSupportReference, type SupportCollection } from "@/lib/support-triage";
export const dynamic = "force-dynamic";
export default async function SupportQueue({ searchParams }: { searchParams: Promise<{ kind?: string; after?: string }> }) {
  try { await requireInternalAdmin(); } catch (error) { if (error instanceof Error && error.message === "Authentication required.") redirect("/login"); notFound(); }
  if (!isFirebaseAdminExplicitlyConfigured()) return <main><h1>Support review unavailable</h1><p>Server storage is not configured.</p></main>;
  const params = await searchParams;
  const kind: SupportCollection = supportCollections.includes(params.kind as SupportCollection) ? params.kind as SupportCollection : "jobs";
  if (params.after && !validSupportReference(kind, params.after)) notFound();
  let query = getFirebaseAdminDb().collectionGroup(kind).orderBy(FieldPath.documentId()).limit(101);
  if (params.after) query = query.startAfter(getFirebaseAdminDb().doc(params.after));
  const docs = (await query.get()).docs;
  const rows = docs.slice(0, 100).flatMap(doc => { if (!validSupportReference(kind, doc.ref.path)) return []; const item = supportItem(kind, doc.ref.path, doc.data()); return item ? [item] : []; });
  return <main className="admin-shell"><h1>Human review</h1><p>Read-only triage of existing records. This page sends no notifications, creates no support ticket, and does not authorize retries, refunds or supplier contact. Assign an operator and approved contact channel before a pilot.</p><nav>{supportCollections.map(value => <p key={value}><Link href={`/admin/support?kind=${value}`}>{value}</Link></p>)}</nav><p>Scanned {Math.min(docs.length, 100)} records in this page. No matching cases here does not mean other pages or queues are clear.</p>{rows.map(row => <section key={row.reference}><h2>{row.reason}</h2><code>{row.reference}</code><p>{row.nextStep}</p></section>)}{docs.length > 100 ? <Link href={`/admin/support?kind=${kind}&after=${encodeURIComponent(docs[99].ref.path)}`}>Scan next page</Link> : <p>End of this queue scan.</p>}<p><Link href="/admin">Open operations</Link></p></main>;
}
