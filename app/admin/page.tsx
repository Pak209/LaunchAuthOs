import { notFound, redirect } from "next/navigation";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import AdminQueue, { type AdminJob } from "./admin-queue";
import { AdminOrders, ProviderPreflightPanel, type AdminOrder } from "./admin-operations";
import AdminReconciliation, { type ReconciliationCase } from "./admin-reconciliation";
import AdminDirectories, { type DirectoryCase } from "./admin-directories";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try { await requireInternalAdmin(); } catch (error) {
    if (error instanceof Error && error.message.includes("Authentication")) redirect("/login");
    notFound();
  }
  if (!isFirebaseAdminExplicitlyConfigured()) return <main className="admin-shell"><h1>Admin setup required</h1><p>Configure the server-controlled Firebase Admin credential before using the fulfillment queue.</p></main>;
  const db = getFirebaseAdminDb();
  const [jobSnapshot, orderSnapshot, directorySnapshot] = await Promise.all([db.collectionGroup("jobs").limit(100).get(), db.collectionGroup("orders").limit(100).get(), db.collectionGroup("directorySubmissions").limit(100).get()]);
  const projectRefs = [...new Map([...jobSnapshot.docs, ...orderSnapshot.docs, ...directorySnapshot.docs].flatMap((record) => {
    const project = record.ref.parent.parent;
    return project ? [[project.path, project] as const] : [];
  })).values()];
  const projectSnapshots = projectRefs.length ? await db.getAll(...projectRefs) : [];
  const names = new Map(projectSnapshots.map((project) => [project.ref.path, String(project.data()?.name ?? project.id)]));
  const jobs: AdminJob[] = jobSnapshot.docs.flatMap((snapshot) => {
    const project = snapshot.ref.parent.parent;
    const workspace = project?.parent.parent;
    if (!project || !workspace) return [];
    const data = snapshot.data();
    return [{ workspaceId: workspace.id, projectId: project.id, projectName: names.get(project.path) ?? project.id, id: snapshot.id, type: String(data.type ?? "unknown"), status: String(data.status ?? "unknown"), attempts: Number(data.attempts ?? 0), lastError: data.lastError ? String(data.lastError) : undefined, needsHumanReview: data.needsHumanReview === true, dispatchStartedAt: data.dispatchStartedAt ? String(data.dispatchStartedAt) : undefined }];
  });
  const reconciliationCases: ReconciliationCase[] = orderSnapshot.docs.flatMap((snapshot) => {
    const project = snapshot.ref.parent.parent;
    const workspace = project?.parent.parent;
    if (!project || !workspace) return [];
    const order = snapshot.data();
    const job = jobs.find((candidate) => candidate.workspaceId === workspace.id && candidate.projectId === project.id && candidate.type === "provider_submission");
    if (!job || job.status !== "failed" || order.externalId || (!job.needsHumanReview && !job.dispatchStartedAt && !order.providerSubmissionUncertain)) return [];
    return [{ workspaceId: workspace.id, projectId: project.id, projectName: names.get(project.path) ?? project.id, provider: String(order.provider ?? "unknown"), headline: String(order.submissionInput?.title ?? ""), packageName: String(order.providerPlan ?? order.selectedPackageId ?? "unknown"), billingStatus: String(order.billingStatus ?? "unknown"), attempts: job.attempts, revision: Number(order.reconciliationRevision ?? 0), dispatchedAt: job.dispatchStartedAt ?? null, lastError: job.lastError ?? "Supplier outcome was not confirmed." }];
  });
  const orderCounts = orderSnapshot.docs.reduce((counts, order) => { const status = String(order.data().status ?? "unknown"); counts[status] = (counts[status] ?? 0) + 1; return counts; }, {} as Record<string, number>);
  const orders: AdminOrder[] = orderSnapshot.docs.flatMap((snapshot) => {
    const project = snapshot.ref.parent.parent;
    const workspace = project?.parent.parent;
    if (!project || !workspace) return [];
    const data = snapshot.data();
    return [{ workspaceId: workspace.id, projectId: project.id, projectName: names.get(project.path) ?? project.id, status: String(data.status ?? "unknown"), billingStatus: String(data.billingStatus ?? "unknown"), packageId: data.packageId ?? data.selectedPackageId, externalId: data.externalId ? String(data.externalId) : undefined, paymentIntentId: data.stripePaymentIntentId ? String(data.stripePaymentIntentId) : undefined, amountTotal: Number.isSafeInteger(data.amountTotal) ? data.amountTotal : undefined, refundedAmountCents: Number.isSafeInteger(data.refundedAmountCents) ? data.refundedAmountCents : undefined }];
  });
  const directoryCases: DirectoryCase[] = directorySnapshot.docs.flatMap((snapshot) => {
    const project = snapshot.ref.parent.parent;
    const workspace = project?.parent.parent;
    if (!project || !workspace) return [];
    const data = snapshot.data();
    const order = orders.find((item) => item.workspaceId === workspace.id && item.projectId === project.id);
    return [{ workspaceId: workspace.id, projectId: project.id, projectName: names.get(project.path) ?? project.id, directoryId: snapshot.id, directory: String(data.directory ?? snapshot.id), mode: String(data.mode ?? "manual"), status: String(data.status ?? "unknown"), revision: Number(data.revision ?? 0), requiredActions: Array.isArray(data.requiredActions) ? data.requiredActions.map(String) : [], billingStatus: order?.billingStatus ?? "unknown", submissionUrl: typeof data.submissionUrl === "string" ? data.submissionUrl : null, listingUrl: typeof data.listingUrl === "string" ? data.listingUrl : null, updatedAt: String(data.updatedAt ?? ""), operatorNote: null }];
  });
  return <main className="admin-shell"><header><span>Launch Auth internal</span><h1>Fulfillment operations</h1><p>Server-controlled queue, payment state, retries, and audited operator actions. This beta view shows up to 100 records per queue.</p></header><div className="admin-metrics"><article><strong>{jobs.length}</strong><span>Loaded jobs</span></article><article><strong>{jobs.filter((job) => job.status === "queued").length}</strong><span>Queued</span></article><article><strong>{jobs.filter((job) => job.status === "failed").length}</strong><span>Failed</span></article><article><strong>{orderCounts.paid ?? 0}</strong><span>Paid orders</span></article></div><ProviderPreflightPanel /><AdminOrders key={orders.map((order) => `${order.workspaceId}:${order.projectId}:${order.status}:${order.billingStatus}:${order.refundedAmountCents}`).join("|")} initialOrders={orders} /><AdminReconciliation cases={reconciliationCases} /><AdminDirectories cases={directoryCases} /><section className="admin-section-title"><span>Background work</span><h2>Fulfillment queue</h2></section><AdminQueue key={jobs.map((job) => `${job.workspaceId}:${job.id}:${job.status}:${job.attempts}`).join("|")} initialJobs={jobs} /></main>;
}
