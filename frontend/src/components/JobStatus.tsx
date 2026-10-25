"use client";

import type { JobState } from "@/lib/types";

export function JobStatus({ job }: { job: JobState | null }) {
  if (!job) return null;
  if (job.status === "failed") {
    return (
      <div className="alert error" role="alert">
        <strong>{job.kind} failed.</strong> {job.error}
      </div>
    );
  }
  if (job.status !== "running") return null;
  return (
    <div className="job" aria-live="polite">
      <div className="row between">
        <span><span className="spinner" /> {job.message || job.stage}</span>
        <span className="muted small">{Math.round(job.progress * 100)}%</span>
      </div>
      <div className="progress"><div style={{ width: `${Math.max(3, job.progress * 100)}%` }} /></div>
    </div>
  );
}
