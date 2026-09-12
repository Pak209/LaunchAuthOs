"use client";

import { useState } from "react";

export type AdminJob = { workspaceId: string; projectId: string; projectName: string; id: string; type: string; status: string; attempts: number; lastError?: string; needsHumanReview?: boolean; dispatchStartedAt?: string };

export default function AdminQueue({ initialJobs }: { initialJobs: AdminJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function update(job: AdminJob, action: "retry" | "cancel") {
    setError(""); setBusy(`${job.projectId}:${job.id}`);
    try {
      const response = await fetch("/api/admin/jobs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.id, action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the job.");
      setJobs((current) => current.map((item) => item.workspaceId === job.workspaceId && item.projectId === job.projectId && item.id === job.id ? { ...item, ...payload.job } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the job.");
    } finally { setBusy(""); }
  }
  return <section className="admin-table"><div className="admin-table-head"><span>Project</span><span>Job</span><span>Status</span><span>Attempts</span><span>Action</span></div>{jobs.length ? jobs.map((job) => {
    const review = job.type === "provider_submission" && job.status === "failed" && (job.needsHumanReview || job.dispatchStartedAt);
    const dispatched = job.type === "provider_submission" && Boolean(job.dispatchStartedAt);
    return <div className="admin-table-row" key={`${job.workspaceId}:${job.projectId}:${job.id}`}><span><strong>{job.projectName}</strong><small>{job.projectId}</small></span><span><strong>{job.type.replaceAll("_", " ")}</strong><small>{job.lastError ?? job.id}</small></span><span data-status={job.status}>{review ? "needs review" : job.status}</span><span>{job.attempts}</span><span>{review ? <a href={`#reconcile-${job.workspaceId}-${job.projectId}`}>Reconcile above</a> : job.status === "failed" ? <button disabled={busy !== ""} onClick={() => void update(job, "retry")}>Retry</button> : <button disabled={busy !== "" || job.status === "complete" || dispatched} onClick={() => void update(job, "cancel")}>{dispatched && job.status !== "complete" ? "Dispatched" : "Cancel"}</button>}</span></div>;
  }) : <p className="admin-empty">No fulfillment jobs yet.</p>}{error ? <p className="admin-error" role="alert">{error}</p> : null}</section>;
}
