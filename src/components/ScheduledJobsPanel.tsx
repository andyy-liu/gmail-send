"use client";

import { useEffect, useState, useCallback } from "react";
import { Calendar, Clock, Users, X, RefreshCw, Mail, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/lib/gmail";

interface JobSummary {
  id: string;
  scheduledAt: string;
  subject: string;
  contacts: Contact[];
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "sending soon…";
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m % 60}m`;
  return `in ${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface JobCardProps {
  job: JobSummary;
  onCancel: (id: string) => void;
  cancelling: boolean;
}

function JobCard({ job, onCancel, cancelling }: JobCardProps) {
  const MAX_VISIBLE = 4;
  const visible = job.contacts.slice(0, MAX_VISIBLE);
  const overflow = job.contacts.length - MAX_VISIBLE;

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Cancel button */}
      <button
        onClick={() => onCancel(job.id)}
        disabled={cancelling}
        title="Cancel this scheduled send"
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-300 hover:text-red-500 disabled:opacity-30"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Subject */}
      <div className="pr-6">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate leading-snug">
          {job.subject || <span className="italic text-neutral-400">(no subject)</span>}
        </p>
      </div>

      {/* Time */}
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          {formatDate(job.scheduledAt)}
        </span>
        <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {timeUntil(job.scheduledAt)}
        </span>
      </div>

      {/* Recipients */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1 text-xs font-medium text-neutral-400">
          <Users className="h-3.5 w-3.5" />
          {job.contacts.length} recipient{job.contacts.length !== 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          {visible.map((c) => (
            <span
              key={c.email}
              title={c.email}
              className="flex items-center gap-1 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-md px-2 py-0.5 max-w-[160px] truncate"
            >
              <Mail className="h-3 w-3 shrink-0" />
              {c.firstName ? `${c.firstName} (${c.email})` : c.email}
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-xs text-neutral-400 px-1 py-0.5">
              +{overflow} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface ScheduledJobsPanelProps {
  refreshKey?: number;
}

export function ScheduledJobsPanel({ refreshKey }: ScheduledJobsPanelProps) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/send/schedule");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(
        (data.jobs as JobSummary[]).sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs, refreshKey]);

  // Re-render time countdowns every 30s without hitting the server
  useEffect(() => {
    const t = setInterval(() => setJobs((j) => [...j]), 30_000);
    return () => clearInterval(t);
  }, []);

  const handleCancelAll = async () => {
    setCancellingAll(true);
    try {
      await fetch("/api/send/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setJobs([]);
    } finally {
      setCancellingAll(false);
    }
  };

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try {
      await fetch("/api/send/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } finally {
      setCancelling(null);
    }
  };

  if (loading) return null;
  if (jobs.length === 0) return null;

  return (
    <section className="border-t pt-10 mt-4">
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">Scheduled Sends</h2>
          <p className="text-sm text-neutral-500">{jobs.length} job{jobs.length !== 1 ? "s" : ""} pending</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchJobs}
            className="gap-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancelAll}
            disabled={cancellingAll}
            className="gap-2 text-neutral-400 hover:text-red-500 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
            Cancel All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onCancel={handleCancel}
            cancelling={cancelling === job.id}
          />
        ))}
      </div>
    </section>
  );
}
