"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  AlertCircle,
  MailMinus,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Batch } from "@/lib/batches";

interface NotificationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: Batch[];
}

type EventStatus = "scheduled" | "sent" | "failed" | "replied" | "skipped_replied";

interface RecipientEvent {
  batchId: string;
  batchLabel: string;
  status: EventStatus;
  detail?: string;
}

interface RecipientActivity {
  email: string;
  firstName: string;
  company: string;
  events: RecipientEvent[];
}

interface ChainEntry {
  id: string;
  label: string;
  status: Batch["status"];
  /** Whichever timestamp is most relevant for the summary line. */
  whenIso: string | null;
}

interface CampaignGroup {
  rootId: string;
  name: string;
  chain: ChainEntry[];
  recipients: RecipientActivity[];
}

function chainFor(root: Batch, all: Batch[]): Batch[] {
  const chain: Batch[] = [root];
  let currentId: string | undefined = root.id;
  while (currentId) {
    const child = all.find((b) => b.parentBatchId === currentId);
    if (!child) break;
    chain.push(child);
    currentId = child.id;
  }
  return chain;
}

function labelFor(index: number): string {
  if (index === 0) return "Email";
  return `Follow-up ${index}`;
}

function eventForRecipient(batch: Batch, email: string): RecipientEvent | null {
  const key = email.toLowerCase().trim();
  if (batch.status === "scheduled") {
    return { batchId: batch.id, batchLabel: "", status: "scheduled" };
  }
  if (batch.status === "sent") {
    const r = batch.recipientResults?.find((x) => x.email.toLowerCase().trim() === key);
    if (!r) return null;
    return {
      batchId: batch.id,
      batchLabel: "",
      status: r.status as EventStatus,
      detail: r.error,
    };
  }
  return null;
}

function batchSummaryTime(batch: Batch): string | null {
  if (batch.status === "sent") return batch.sentAt ?? batch.scheduledAt ?? null;
  if (batch.status === "scheduled") return batch.scheduledAt ?? null;
  return null;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summaryLabelFor(status: Batch["status"]): string {
  if (status === "sent") return "Sent";
  if (status === "scheduled") return "Scheduled";
  return "";
}

function maxTimeForRecipient(_r: RecipientActivity, chain: ChainEntry[]): number {
  // Approximate "recent activity" using the campaign's most recent batch time;
  // we don't store per-recipient sent timestamps in recipientResults.
  return chain.reduce(
    (m, c) => Math.max(m, c.whenIso ? Date.parse(c.whenIso) : 0),
    0
  );
}

function eventIsDeviation(e: RecipientEvent): boolean {
  return e.status === "failed" || e.status === "replied" || e.status === "skipped_replied";
}

function StatusPill({ event }: { event: RecipientEvent }) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium border";
  if (event.status === "scheduled") {
    return (
      <span className={cn(base, "border-blue-200 bg-blue-50 text-blue-700")}>
        <Clock className="h-3 w-3" />
        {event.batchLabel}
      </span>
    );
  }
  if (event.status === "sent") {
    return (
      <span className={cn(base, "border-green-200 bg-green-50 text-green-700")}>
        <CheckCircle2 className="h-3 w-3" />
        {event.batchLabel}
      </span>
    );
  }
  if (event.status === "failed") {
    return (
      <span
        className={cn(base, "border-red-200 bg-red-50 text-red-700")}
        title={event.detail || "Failed"}
      >
        <AlertCircle className="h-3 w-3" />
        {event.batchLabel} · Failed{event.detail ? `: ${event.detail}` : ""}
      </span>
    );
  }
  if (event.status === "replied") {
    return (
      <span className={cn(base, "border-amber-200 bg-amber-50 text-amber-700")}>
        <MailMinus className="h-3 w-3" />
        {event.batchLabel} · Replied — sequence stopped
      </span>
    );
  }
  // skipped_replied
  return (
    <span
      className={cn(base, "border-amber-200 bg-amber-50 text-amber-700")}
      title={event.detail || "Skipped — recipient already replied."}
    >
      <MailMinus className="h-3 w-3" />
      {event.batchLabel} · Skipped (replied earlier)
    </span>
  );
}

export function NotificationsDialog({ open, onOpenChange, batches }: NotificationsDialogProps) {
  const groups = useMemo<CampaignGroup[]>(() => {
    const roots = batches.filter((b) => !b.parentBatchId);
    const result: CampaignGroup[] = [];

    for (const root of roots) {
      const rawChain = chainFor(root, batches);
      // Skip purely-draft chains; this is the "things that aren't drafts" filter.
      const chain: ChainEntry[] = rawChain
        .map((b, i) => ({
          id: b.id,
          label: labelFor(i),
          status: b.status,
          whenIso: batchSummaryTime(b),
        }))
        .filter((c) => c.status === "sent" || c.status === "scheduled");
      if (chain.length === 0) continue;

      const recipients: RecipientActivity[] = [];
      for (const contact of root.contacts) {
        if (!contact.email.trim()) continue;
        const events: RecipientEvent[] = [];
        rawChain.forEach((batch, i) => {
          const ev = eventForRecipient(batch, contact.email);
          if (ev) events.push({ ...ev, batchLabel: labelFor(i) });
        });
        if (events.length === 0) continue;
        recipients.push({
          email: contact.email,
          firstName: contact.firstName,
          company: contact.company,
          events,
        });
      }
      if (recipients.length === 0) continue;

      // Surface recipients with deviations (failed/replied/skipped) at the top
      // so they're easy to spot in a long list.
      recipients.sort((a, b) => {
        const aDev = a.events.some(eventIsDeviation) ? 1 : 0;
        const bDev = b.events.some(eventIsDeviation) ? 1 : 0;
        if (aDev !== bDev) return bDev - aDev;
        return a.email.localeCompare(b.email);
      });

      result.push({
        rootId: root.id,
        name: root.name || "Untitled campaign",
        chain,
        recipients,
      });
    }

    // Most-recently-active campaign first.
    result.sort((a, b) => {
      const ta = maxTimeForRecipient(a.recipients[0], a.chain);
      const tb = maxTimeForRecipient(b.recipients[0], b.chain);
      return tb - ta;
    });
    return result;
  }, [batches]);

  const totalRecipients = groups.reduce((sum, g) => sum + g.recipients.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[min(95vw,1400px)] w-[min(95vw,1400px)] max-h-[85vh] flex flex-col p-0 gap-0"
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-neutral-200">
          <DialogTitle className="text-base font-semibold">Notifications</DialogTitle>
          <DialogDescription className="text-xs text-neutral-500">
            {groups.length === 0
              ? "No activity yet. Send or schedule a campaign to see updates here."
              : `${totalRecipients} recipient${totalRecipients === 1 ? "" : "s"} across ${groups.length} campaign${groups.length === 1 ? "" : "s"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {groups.map((g) => (
            <section key={g.rootId} className="space-y-2">
              <header className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-neutral-900 truncate">{g.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-neutral-500">
                    {g.chain.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1">
                        <span className="font-medium text-neutral-700">{c.label}:</span>
                        <span>
                          {summaryLabelFor(c.status)} {fmt(c.whenIso)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-neutral-400 shrink-0">
                  {g.recipients.length} recipient{g.recipients.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
                {g.recipients.map((r) => (
                  <div
                    key={r.email}
                    className="flex items-center gap-6 px-4 py-2.5"
                  >
                    <div className="min-w-0 w-[260px] shrink-0">
                      <p className="text-sm font-medium text-neutral-800 truncate">{r.email}</p>
                      {(r.firstName || r.company) && (
                        <p className="text-[11px] text-neutral-500 truncate">
                          {[r.firstName, r.company].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                      {r.events.map((e) => (
                        <StatusPill key={`${r.email}-${e.batchId}`} event={e} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
