"use client";

import { useState, useRef, useCallback, useEffect, type ChangeEvent } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  SendIcon,
  FileText,
  CheckCircle2,
  Clock,
  CalendarIcon,
  RefreshCw,
  MailMinus,
  Paperclip,
  X,
} from "lucide-react";
import { Batch, RecipientResult, RecipientResultStatus } from "@/lib/batches";
import type { EmailAttachment } from "@/lib/attachments";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, formatAttachmentSize } from "@/lib/attachments";
import type { CustomVariable } from "@/lib/variables";
import { useEmailSend } from "@/hooks/useEmailSend";
import { ContactTable } from "@/components/ContactTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;
const POLL_INTERVAL_MS = 5000;

interface NodeDrawerProps {
  open: boolean;
  batch: Batch | undefined;
  batches: Batch[];
  signature: string;
  variables: CustomVariable[];
  onUpdate: (patch: Partial<Batch>) => void;
  /** Update any batch by id — used to write reply-check results back to the parent. */
  onUpdateBatch: (id: string, patch: Partial<Batch>) => void;
  onClose: () => void;
}

interface RecipientRow {
  email: string;
  status: string;
  last_error: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  gmail_mime_message_id: string | null;
  sent_at: string | null;
}

/**
 * Returns a RecipientResult for terminal DB states only. Pending/sending rows
 * are mapped to null so the ContactTable shows them as "pending" (gray clock)
 * instead of incorrectly flagging them failed.
 */
function recipientRowToResult(r: RecipientRow): RecipientResult | null {
  let status: RecipientResultStatus;
  if (r.status === "sent") status = "sent";
  else if (r.status === "skipped_replied") status = "skipped_replied";
  else if (r.status === "manually_stopped") status = "manually_stopped";
  else if (r.status === "failed") status = "failed";
  else return null;
  return {
    email: r.email,
    status,
    messageId: r.gmail_message_id ?? undefined,
    threadId: r.gmail_thread_id ?? undefined,
    mimeMessageId: r.gmail_mime_message_id ?? undefined,
    error: r.last_error ?? undefined,
  };
}

function isWeekendDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseLocalDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function mergeDateAndTime(date: Date, time: string) {
  const [hour = 9, minute = 0] = time.split(":").map(Number);
  return toLocalDateTimeValue(
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
  );
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function laterDate(a: Date, b: Date) {
  return a.getTime() > b.getTime() ? a : b;
}

function DateTimePicker({
  value,
  onChange,
  minDate,
}: {
  value: string;
  onChange: (value: string | undefined) => void;
  minDate: Date;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDateTime(value) : null;
  const timeValue = selected
    ? `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`
    : "09:00";
  const minDay = startOfLocalDay(minDate);

  return (
    <div className="flex items-center gap-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-8 w-[190px] justify-start gap-2 rounded text-left text-xs font-normal",
                !selected && "text-neutral-400",
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5 text-neutral-500" />
              {selected ? selected.toLocaleDateString() : "Select date"}
            </Button>
          }
        />
        <PopoverContent
          align="start"
          className="w-auto p-0"
        >
          <Calendar
            mode="single"
            selected={selected ?? undefined}
            disabled={{ before: minDay }}
            onSelect={(date) => {
              if (!date) {
                onChange(undefined);
                return;
              }
              onChange(mergeDateAndTime(date, timeValue));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={timeValue}
        onChange={(e) => {
          const base = selected ?? new Date();
          onChange(mergeDateAndTime(base, e.target.value));
        }}
        className="h-8 w-[96px] px-2 text-xs tabular-nums [appearance:textfield] [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function AttachmentField({
  attachment,
  disabled,
  onChange,
}: {
  attachment?: EmailAttachment | null;
  disabled: boolean;
  onChange: (attachment: EmailAttachment | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Attachment must be a PDF.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`PDF must be ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} or smaller.`);
      return;
    }

    setReading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(",", 2)[1];
      if (!base64) throw new Error("Could not read file.");
      onChange({
        name: file.name,
        contentType: "application/pdf",
        size: file.size,
        base64,
      });
      toast.success("Attachment added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read attachment.");
    } finally {
      setReading(false);
    }
  }

  if (disabled && !attachment) return null;

  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-neutral-600">Attachment</Label>
        {!disabled && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={reading}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-neutral-200 bg-white px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {reading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5" />
            )}
            {attachment ? "Replace PDF" : "Add PDF"}
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || reading}
      />
      {attachment && (
        <div className="flex min-w-0 items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
          <Paperclip className="h-4 w-4 shrink-0 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-neutral-800">{attachment.name}</p>
            <p className="text-[11px] text-neutral-400">{formatAttachmentSize(attachment.size)}</p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
              title="Remove attachment"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {!attachment && !disabled && (
        <p className="text-[11px] text-neutral-400">
          PDF up to {formatAttachmentSize(MAX_ATTACHMENT_BYTES)}.
        </p>
      )}
    </div>
  );
}

/**
 * Stop state lives on the root batch (all emails in a chain share one Gmail
 * thread). For a follow-up tab we overlay root-side stopped statuses onto the
 * follow-up's own results so the user sees the same markers regardless of
 * which node is selected.
 */
function mergeWithParentReplies(
  ownResults: RecipientResult[] | undefined,
  parentResults: RecipientResult[] | undefined
): RecipientResult[] | undefined {
  if (!parentResults?.length) return ownResults;
  const stoppedByEmail = new Map<string, RecipientResult>();
  for (const pr of parentResults) {
    if (
      pr.status === "replied" ||
      pr.status === "skipped_replied" ||
      pr.status === "manually_stopped"
    ) {
      stoppedByEmail.set(pr.email.toLowerCase().trim(), pr);
    }
  }
  if (stoppedByEmail.size === 0) return ownResults;

  const own = ownResults ?? [];
  const ownByEmail = new Map(own.map((r) => [r.email.toLowerCase().trim(), r]));
  // Promote rows when the shared sequence state shows this recipient is now
  // stopped. Reply-derived stops only upgrade sent rows; manual stops can
  // override other terminal states because the user is explicitly ending the
  // sequence from this point forward.
  const merged: RecipientResult[] = own.map((r) => {
    const key = r.email.toLowerCase().trim();
    const stopped = stoppedByEmail.get(key);
    if (stopped?.status === "manually_stopped" && !isStoppedResult(r)) {
      return {
        ...r,
        status: "manually_stopped",
        error: stopped.error,
      };
    }
    if (r.status === "sent" && stopped) {
      return { ...r, status: "replied" as const, error: stopped.error };
    }
    return r;
  });
  // Add parent-side stopped recipients we don't have our own row for (typical
  // for an unsent follow-up: own is empty, surface parent's state here).
  for (const [key, pr] of stoppedByEmail) {
    if (ownByEmail.has(key)) continue;
    merged.push({
      email: pr.email,
      status: pr.status,
      threadId: pr.threadId,
      mimeMessageId: pr.mimeMessageId,
      error: pr.error,
    });
  }
  return merged.length ? merged : undefined;
}

function isStoppedResult(r: RecipientResult) {
  return (
    r.status === "replied" ||
    r.status === "skipped_replied" ||
    r.status === "manually_stopped"
  );
}

export function NodeDrawer({
  open,
  batch,
  batches,
  signature,
  variables,
  onUpdate,
  onUpdateBatch,
  onClose,
}: NodeDrawerProps) {
  const [sendMode, setSendMode] = useState<"draft" | "send">("draft");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("email");
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [stopConfirmEmail, setStopConfirmEmail] = useState<string | null>(null);
  const [stoppingEmail, setStoppingEmail] = useState<string | null>(null);
  const lastCheckedRef = useRef<Map<string, number>>(new Map());
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragState.current = { startX: e.clientX, startWidth: width };
      setIsDragging(true);

      function onMouseMove(ev: MouseEvent) {
        if (!dragState.current) return;
        const delta = dragState.current.startX - ev.clientX;
        setWidth(
          Math.max(
            MIN_WIDTH,
            Math.min(MAX_WIDTH, dragState.current.startWidth + delta),
          ),
        );
      }

      function onMouseUp() {
        dragState.current = null;
        setIsDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width],
  );

  // ─── Derived state ────────────────────────────────────────────────────────
  const isFollowUp = !!batch?.parentBatchId;
  const parent = isFollowUp
    ? batches.find((b) => b.id === batch?.parentBatchId)
    : undefined;
  const isSent = batch?.status === "sent";
  const isScheduled = batch?.status === "scheduled";
  // While scheduled, the batch row IS the snapshot the worker reads. Lock
  // subject/body/contacts so edits don't leak into the running send.
  const locked = isSent || isScheduled;
  const scheduledAt = batch?.scheduledAt ?? "";
  const scheduledAtFallsOnWeekend = scheduledAt
    ? isWeekendDate(scheduledAt)
    : false;
  const today = startOfLocalDay(new Date());
  const parentTime = parent?.sentAt ?? parent?.scheduledAt;
  const parentMinDate = parentTime
    ? startOfLocalDay(new Date(parentTime))
    : today;
  const minScheduleDate = isFollowUp ? laterDate(today, parentMinDate) : today;
  const followUpBeforeParent =
    isFollowUp &&
    !!scheduledAt &&
    !!parentTime &&
    new Date(scheduledAt).getTime() <= new Date(parentTime).getTime();
  const scheduledInPast =
    !!scheduledAt && new Date(scheduledAt).getTime() <= Date.now();

  // Recipients shown for this node. Follow-ups inherit from parent's current
  // contacts so the recipient list always lives on the root node and stays
  // in sync. Otherwise we use the node's own contacts.
  const displayedContacts = isFollowUp
    ? (parent?.contacts ?? [])
    : (batch?.contacts ?? []);

  const isSendAction = !scheduledAt && sendMode === "send";
  const needsConfirmation =
    !!batch && !isSent && (isSendAction || !!scheduledAt);
  const recipientCount = displayedContacts.filter((c) => c.email.trim()).length;
  const sampleRecipients = displayedContacts
    .filter((c) => c.email.trim())
    .slice(0, 4);
  const attachment = batch?.attachment ?? null;

  const { isSubmitting, submit } = useEmailSend({
    activeBatch: batch,
    batches,
    signature,
    scheduledAt,
    variables,
    onBatchUpdate: onUpdate,
  });

  // ─── Polling: per-recipient status while a scheduled job is running ──────
  useEffect(() => {
    if (!open) return;
    if (!batch?.scheduledJobId) return;
    if (batch.status === "sent") return;

    let cancelled = false;
    const jobId = batch.scheduledJobId;

    async function poll() {
      try {
        const res = await fetch(`/api/send/schedule/${jobId}/recipients`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          job: { status: string; completedAt: string | null };
          recipients: RecipientRow[];
        };
        if (cancelled) return;

        const recipientResults = data.recipients
          .map(recipientRowToResult)
          .filter((r): r is RecipientResult => r !== null);
        const terminal =
          data.job.status === "completed" ||
          data.job.status === "failed" ||
          data.job.status === "partial_failed";
        onUpdate({
          recipientResults,
          ...(terminal && {
            status: "sent" as const,
            sentAt: data.job.completedAt ?? new Date().toISOString(),
          }),
        });
      } catch {
        // ignore transient errors; next tick will retry
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Polling restarts when these change. onUpdate intentionally omitted to
    // avoid resetting the interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch?.scheduledJobId, batch?.status]);

  // ─── Reply detection ─────────────────────────────────────────────────────
  // All emails in a chain share one Gmail thread per recipient, so we always
  // check against the root batch — it's the single source of truth.
  const rootBatch = (() => {
    let cur = batch;
    while (cur?.parentBatchId) {
      const p = batches.find((b) => b.id === cur!.parentBatchId);
      if (!p) break;
      cur = p;
    }
    return cur;
  })();

  const canCheckReplies =
    !!rootBatch &&
    rootBatch.status === "sent" &&
    !!rootBatch.recipientResults?.some((r) => r.status === "sent" && r.threadId);

  async function runReplyCheck(force = false) {
    if (!rootBatch || !canCheckReplies) return;
    const id = rootBatch.id;
    const last = lastCheckedRef.current.get(id);
    if (!force && last && Date.now() - last < 10_000) return;

    setCheckingReplies(true);
    lastCheckedRef.current.set(id, Date.now());
    try {
      const res = await fetch(`/api/batches/${id}/check-replies`, { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { results: RecipientResult[]; replied: string[] };
      onUpdateBatch(id, { recipientResults: data.results });
    } catch {
      // transient — user can hit refresh
    } finally {
      setCheckingReplies(false);
    }
  }

  async function confirmStopSequence() {
    if (!rootBatch || !stopConfirmEmail) return;
    const email = stopConfirmEmail;
    const normalized = email.toLowerCase().trim();
    setStoppingEmail(normalized);
    try {
      const res = await fetch(`/api/batches/${rootBatch.id}/recipients/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: RecipientResult[];
        error?: string;
      };
      if (!res.ok || !data.results) {
        throw new Error(data.error || "Failed to stop sequence.");
      }
      onUpdateBatch(rootBatch.id, { recipientResults: data.results });
      toast.success(`Sequence stopped for ${email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop sequence.");
    } finally {
      setStoppingEmail(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (activeTab !== "recipients") return;
    void runReplyCheck();
    // runReplyCheck reads from refs / latest batch state; firing only on the
    // identity inputs avoids re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, rootBatch?.id, canCheckReplies]);

  // ─── Action / button labels ──────────────────────────────────────────────
  const actionLabel = isScheduled
    ? "Reschedule"
    : isFollowUp && !scheduledAt
      ? "Choose a Send Time"
      : scheduledAt
        ? "Schedule Send"
        : sendMode === "send"
          ? "Send Now"
          : "Save Draft";

  const pendingLabel = isScheduled
    ? "Rescheduling..."
    : scheduledAt
      ? "Scheduling..."
      : sendMode === "send"
        ? "Sending..."
        : "Saving Draft...";

  function handleActionClick() {
    if (needsConfirmation) {
      setConfirmOpen(true);
      return;
    }
    submit(sendMode);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex flex-col p-0 gap-0"
        style={{
          width,
          maxWidth: "none",
          ...(isDragging && { transition: "none" }),
        }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={onDragStart}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-neutral-200 active:bg-neutral-300 transition-colors z-10"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              {isFollowUp ? "Follow-up Email" : "Email"}
              {isSent && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Sent
                </span>
              )}
              {isScheduled && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                  <Clock className="h-3 w-3" /> Scheduled
                </span>
              )}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {isSent && batch?.sentAt
                ? `Sent ${new Date(batch.sentAt).toLocaleString()}`
                : isFollowUp
                  ? "Inherits thread from parent"
                  : "Initial email in sequence"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-700"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
            >
              <path
                d="M1 1l12 12M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as string)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-6 pt-4 shrink-0">
            <TabsList className="bg-neutral-100 rounded p-0.5 h-auto gap-0">
              <TabsTrigger
                value="email"
                className="text-xs px-3 py-1.5 h-auto rounded"
              >
                Email
              </TabsTrigger>
              <TabsTrigger
                value="recipients"
                className="text-xs px-3 py-1.5 h-auto rounded"
              >
                Recipients
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Email tab */}
          <TabsContent
            value="email"
            className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
          >
            {batch && (
              <>
                {/* Timing config — hidden once sent. For scheduled non-follow-ups
                    the immediately/schedule toggle is gone; only the datetime
                    remains so the user can reschedule. */}
                {!isSent && (
                  <div className="pb-4 border-b border-neutral-100 space-y-2">
                    <Label className="text-xs font-medium text-neutral-600">
                      {isFollowUp
                        ? "Schedule follow-up for"
                        : isScheduled
                          ? "Scheduled for"
                          : "Send timing"}
                    </Label>

                    {isFollowUp ? (
                      <div className="space-y-1.5">
                        <DateTimePicker
                          value={scheduledAt}
                          onChange={(value) => onUpdate({ scheduledAt: value })}
                          minDate={minScheduleDate}
                        />
                        <p className="text-[11px] text-neutral-400">
                          The previous email must be scheduled first. This
                          follow-up stays draft until you click Schedule Send.
                        </p>
                        {scheduledInPast && (
                          <p className="text-[11px] font-medium text-red-600">
                            Send time must be in the future.
                          </p>
                        )}
                        {followUpBeforeParent && parentTime && (
                          <p className="text-[11px] font-medium text-amber-600">
                            Follow-up must be after{" "}
                            {new Date(parentTime).toLocaleString()}.
                          </p>
                        )}
                        {scheduledAtFallsOnWeekend && (
                          <p className="text-[11px] font-medium text-amber-600">
                            This send time falls on a weekend.
                          </p>
                        )}
                      </div>
                    ) : isScheduled ? (
                      <>
                        <DateTimePicker
                          value={scheduledAt}
                          onChange={(value) => onUpdate({ scheduledAt: value })}
                          minDate={minScheduleDate}
                        />
                        <p className="text-[11px] text-neutral-400">
                          Edits apply when you reschedule.
                        </p>
                        {scheduledInPast && (
                          <p className="text-[11px] font-medium text-red-600">
                            Send time must be in the future.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center rounded border border-neutral-200 bg-neutral-50 p-0.5 gap-0.5 w-fit">
                          <button
                            onClick={() => onUpdate({ scheduledAt: undefined })}
                            className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                              !scheduledAt
                                ? "bg-white text-neutral-900 shadow-sm"
                                : "text-neutral-500 hover:text-neutral-700"
                            }`}
                          >
                            Send immediately
                          </button>
                          <button
                            onClick={() =>
                              onUpdate({
                                scheduledAt:
                                  scheduledAt ||
                                  new Date(Date.now() + 3600000)
                                    .toISOString()
                                    .slice(0, 16),
                              })
                            }
                            className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                              scheduledAt
                                ? "bg-white text-neutral-900 shadow-sm"
                                : "text-neutral-500 hover:text-neutral-700"
                            }`}
                          >
                            Schedule
                          </button>
                        </div>
                        {scheduledAt && (
                          <DateTimePicker
                            value={scheduledAt}
                            onChange={(value) =>
                              onUpdate({ scheduledAt: value })
                            }
                            minDate={minScheduleDate}
                          />
                        )}
                        {scheduledAt && scheduledInPast && (
                          <p className="text-[11px] font-medium text-red-600">
                            Send time must be in the future.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Template editor */}
                <TemplateEditor
                  subject={batch.subject}
                  setSubject={(v) => onUpdate({ subject: v })}
                  body={batch.body}
                  setBody={(v) => onUpdate({ body: v })}
                  subjectReadOnly={isFollowUp}
                  readOnly={locked}
                  variables={variables}
                />
                <AttachmentField
                  attachment={batch.attachment}
                  disabled={locked}
                  onChange={(next) => onUpdate({ attachment: next })}
                />
              </>
            )}
          </TabsContent>

          {/* Recipients tab */}
          <TabsContent
            value="recipients"
            className="flex-1 overflow-y-auto px-6 py-4"
          >
            {batch && (
              <>
                {!isFollowUp && !locked && (
                  <p className="text-xs text-neutral-400 mb-3">
                    Use{" "}
                    <code className="bg-neutral-100 px-1 py-0.5 rounded text-neutral-600">
                      {"{{"} FirstName {"}}"}
                    </code>
                    ,{" "}
                    <code className="bg-neutral-100 px-1 py-0.5 rounded text-neutral-600">
                      {"{{"} Company {"}}"}
                    </code>
                    , and{" "}
                    <code className="bg-neutral-100 px-1 py-0.5 rounded text-neutral-600">
                      {"{{"} Signature {"}}"}
                    </code>{" "}
                    as variables in your email.
                  </p>
                )}
                {(() => {
                  const displayResults = mergeWithParentReplies(
                    batch.recipientResults,
                    isFollowUp ? rootBatch?.recipientResults : undefined,
                  );
                  const stoppedCount = (displayResults ?? []).filter(
                    isStoppedResult,
                  ).length;
                  const manualStoppedCount = (displayResults ?? []).filter(
                    (r) => r.status === "manually_stopped",
                  ).length;
                  const canStopRecipients =
                    !!rootBatch &&
                    (rootBatch.status === "sent" || rootBatch.status === "scheduled");
                  return (
                    <>
                      {canCheckReplies && (
                        <div className="flex items-center justify-between mb-3 text-xs">
                          <div className="flex items-center gap-2 text-neutral-500">
                            {checkingReplies ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Checking for replies…</span>
                              </>
                            ) : stoppedCount > 0 ? (
                              <>
                                <MailMinus className="h-3 w-3 text-amber-600" />
                                <span>
                                  {stoppedCount} recipient
                                  {stoppedCount === 1 ? " is" : "s are"} stopped
                                  {manualStoppedCount > 0
                                    ? ` (${manualStoppedCount} manually)`
                                    : ""}
                                  .
                                </span>
                              </>
                            ) : (
                              <span>No replies detected.</span>
                            )}
                          </div>
                          <button
                            onClick={() => void runReplyCheck(true)}
                            disabled={checkingReplies}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 disabled:opacity-50 cursor-pointer"
                            title="Check for replies now"
                          >
                            <RefreshCw className={cn("h-3 w-3", checkingReplies && "animate-spin")} />
                            Refresh
                          </button>
                        </div>
                      )}
                      <ContactTable
                        contacts={displayedContacts}
                        setContacts={(v) => onUpdate({ contacts: v })}
                        readOnly={locked || isFollowUp}
                        readOnlyNotice={
                          isFollowUp
                            ? "Recipients are inherited from the previous email and edited there."
                            : undefined
                        }
                        recipientResults={displayResults}
                        variables={variables}
                        onStopSequence={
                          canStopRecipients
                            ? (email) => setStopConfirmEmail(email)
                            : undefined
                        }
                        stoppingEmail={stoppingEmail}
                      />
                    </>
                  );
                })()}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Action footer — hidden when sent (terminal) */}
        {!isSent && (
          <div className="border-t border-neutral-200 px-6 py-4 shrink-0">
            {/* Draft/Send toggle only available when not scheduled and not a follow-up */}
            {!scheduledAt && !isScheduled && !isFollowUp && (
              <div className="flex items-center rounded border border-neutral-200 bg-neutral-50 p-0.5 gap-0.5 mb-3 w-fit">
                <button
                  onClick={() => setSendMode("draft")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    sendMode === "draft"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  <FileText className="h-3 w-3" />
                  Save as Draft
                </button>
                <button
                  onClick={() => setSendMode("send")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    sendMode === "send"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  <SendIcon className="h-3 w-3" />
                  Send Now
                </button>
              </div>
            )}

            <Button
              onClick={handleActionClick}
              disabled={
                isSubmitting ||
                !batch ||
                (isFollowUp && !scheduledAt) ||
                followUpBeforeParent ||
                scheduledInPast
              }
              className="bg-neutral-900 text-white hover:bg-neutral-700 active:scale-[0.97] transition-transform w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {pendingLabel}
                </>
              ) : (
                <>
                  <SendIcon className="mr-2 h-4 w-4" />
                  {actionLabel}
                </>
              )}
            </Button>
          </div>
        )}

        {batch && (
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={
              isScheduled
                ? "Reschedule this send?"
                : scheduledAt
                  ? "Schedule this send?"
                  : "Send these emails now?"
            }
            confirmLabel={
              isScheduled
                ? "Reschedule"
                : scheduledAt
                  ? "Schedule Send"
                  : "Send Now"
            }
            confirmVariant={scheduledAt ? "default" : "destructive"}
            description={
              <div className="space-y-3 text-sm text-neutral-600">
                <p>
                  {isScheduled
                    ? `This cancels the existing scheduled job and re-schedules ${recipientCount} email${recipientCount === 1 ? "" : "s"} for ${new Date(scheduledAt).toLocaleString()}.`
                    : scheduledAt
                      ? `This will schedule ${recipientCount} email${recipientCount === 1 ? "" : "s"} for ${new Date(scheduledAt).toLocaleString()}.`
                      : `This will immediately send ${recipientCount} email${recipientCount === 1 ? "" : "s"} through Gmail.`}
                </p>
                {scheduledAtFallsOnWeekend && (
                  <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                    This send time falls on a weekend.
                  </p>
                )}
                <div className="space-y-1.5 rounded border border-neutral-200 bg-neutral-50 p-3">
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Subject
                    </span>
                    <p className="mt-0.5 text-neutral-800">{batch.subject}</p>
                  </div>
                  {attachment && (
                    <div>
                      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                        Attachment
                      </span>
                      <p className="mt-0.5 truncate text-neutral-800">
                        {attachment.name} · {formatAttachmentSize(attachment.size)}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Recipients
                    </span>
                    <div className="mt-1 space-y-1">
                      {sampleRecipients.map((contact) => (
                        <p
                          key={contact.id}
                          className="truncate text-neutral-700"
                        >
                          {contact.firstName} · {contact.email}
                        </p>
                      ))}
                      {recipientCount > sampleRecipients.length && (
                        <p className="text-neutral-400">
                          +{recipientCount - sampleRecipients.length} more
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            }
            onConfirm={() => submit(sendMode)}
          />
        )}
        {rootBatch && (
          <ConfirmDialog
            open={!!stopConfirmEmail}
            onOpenChange={(open) => {
              if (!open) setStopConfirmEmail(null);
            }}
            title="Stop this sequence?"
            confirmLabel="Stop Sequence"
            confirmVariant="destructive"
            description={
              <p>
                This prevents {stopConfirmEmail} from receiving future emails in
                this sequence. Emails already sent cannot be recalled.
              </p>
            }
            onConfirm={confirmStopSequence}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
