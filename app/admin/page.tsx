import { notFound, redirect } from "next/navigation";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "@/lib/firebase/admin";
import { requireInternalAdmin } from "@/lib/internal-admin";
import AdminQueue, { type AdminJob } from "./admin-queue";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try { await requireInternalAdmin(); } catch (error) {
    if (error instanceof Error && error.message.includes("Authentication")) redirect("/login");
    notFound();
  }
  if (!isFirebaseAdminExplicitlyConfigured()) return <main className="admin-shell"><h1>Admin setup required</h1><p>Configure the server-controlled Firebase Admin credential before using the fulfillment queue.</p></main>;
  const db = getFirebaseAdminDb();
  const [jobSnapshot, orderSnapshot] = await Promise.all([db.collectionGroup("jobs").limit(100).get(), db.collectionGroup("orders").limit(100).get()]);
  const projectRefs = [...new Map(jobSnapshot.docs.flatMap((job) => {
    const project = job.ref.parent.parent;
    return project ? [[project.path, project] as const] : [];
  })).values()];
  const projectSnapshots = projectRefs.length ? await db.getAll(...projectRefs) : [];
  const names = new Map(projectSnapshots.map((project) => [project.ref.path, String(project.data()?.name ?? project.id)]));
  const jobs: AdminJob[] = jobSnapshot.docs.flatMap((snapshot) => {
    const project = snapshot.ref.parent.parent;
    const workspace = project?.parent.parent;
    if (!project || !workspace) return [];
    const data = snapshot.data();
    return [{ workspaceId: workspace.id, projectId: project.id, projectName: names.get(project.path) ?? project.id, id: snapshot.id, type: String(data.type ?? "unknown"), status: String(data.status ?? "unknown"), attempts: Number(data.attempts ?? 0), lastError: data.lastError ? String(data.lastError) : undefined }];
  });
  const orderCounts = orderSnapshot.docs.reduce((counts, order) => { const status = String(order.data().status ?? "unknown"); counts[status] = (counts[status] ?? 0) + 1; return counts; }, {} as Record<string, number>);
  return <main className="admin-shell"><header><span>Launch Auth internal</span><h1>Fulfillment operations</h1><p>Server-controlled queue, payment state, retries, and audit history.</p></header><div className="admin-metrics"><article><strong>{jobs.length}</strong><span>Total jobs</span></article><article><strong>{jobs.filter((job) => job.status === "queued").length}</strong><span>Queued</span></article><article><strong>{jobs.filter((job) => job.status === "failed").length}</strong><span>Failed</span></article><article><strong>{orderCounts.paid ?? 0}</strong><span>Paid orders</span></article></div><AdminQueue initialJobs={jobs} /></main>;
}
