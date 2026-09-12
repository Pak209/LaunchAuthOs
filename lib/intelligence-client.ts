import type { IntelligenceJobStatus } from "./intelligence-jobs";

export function intelligenceJobHost(url: string) {
  try { return new URL(url).hostname || "Company website"; }
  catch { return "Company website"; }
}

export function canApplyIntelligenceResult(job: IntelligenceJobStatus, followed: { id: string; epoch: number } | null, currentEpoch: number) {
  return job.status === "completed" && followed?.id === job.id && followed.epoch === currentEpoch;
}
