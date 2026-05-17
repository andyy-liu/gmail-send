"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, SendIcon, FileText, CheckCircle2, Clock } from "lucide-react";
import { Batch, RecipientResult, RecipientResultStatus } from "@/lib/batches";
import { useEmailSend } from "@/hooks/useEmailSend";
import { ContactTable } from "@/components/ContactTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;
const POLL_INTERVAL_MS = 5000;

interface NodeDrawerProps {
  open: boolean;
  batch: Batch | undefined;
  batches: Batch[];
  signature: string;
  onUpdate: (patch: Partial<Batch>) => void;
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

export function NodeDrawer({
  open,
  batch,
  batches,
  signature,
  onUpdate,
  onClose,
}: NodeDrawerProps) {
  const [sendMode, setSendMode] = useState<"draft" | "send">("draft");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    setIsDragging(true);

    function onMouseMove(ev: MouseEvent) {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragState.current.startWidth + delta)));
    }

    function onMouseUp() {
      dragState.current = null;
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  // ─── Derived state ────────────────────────────────────────────────────────
  const isFollowUp = !!batch?.parentBatchId;
  const parent = isFollowUp
    ? batches.find((b) => b.id === batch?.parentBatchId)
    : undefined;
  const isSent = batch?.status === "sent";
  const isScheduled = batch?.status === "scheduled";
  const locked = isSent;
  const scheduledAt = batch?.scheduledAt ?? "";

  // Recipients shown for this node. Follow-ups inherit from parent's current
  // contacts so the recipient list always lives on the root node and stays
  // in sync. Otherwise we use the node's own contacts.
  const displayedContacts = isFollowUp ? (parent?.contacts ?? []) : (batch?.contacts ?? []);

  const isSendAction = !scheduledAt && (sendMode === "send" || isFollowUp);
  const needsConfirmation = !!batch && !isSent && (isSendAction || !!scheduledAt);
  const recipientCount = displayedContacts.filter((c) => c.email.trim()).length;
  const sampleRecipients = displayedContacts
    .filter((c) => c.email.trim())
    .slice(0, 4);

  const { isSubmitting, submit } = useEmailSend({
    activeBatch: batch,
    batches,
    signature,
    scheduledAt,
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

  // ─── Action / button labels ──────────────────────────────────────────────
  const actionLabel = isScheduled
    ? "Reschedule"
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
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex flex-col p-0 gap-0"
        style={{ width, maxWidth: "none", ...(isDragging && { transition: "none" }) }}
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <Tabs defaultValue="email" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-4 shrink-0">
            <TabsList className="bg-neutral-100 rounded p-0.5 h-auto gap-0">
              <TabsTrigger value="email" className="text-xs px-3 py-1.5 h-auto rounded">
                Email
              </TabsTrigger>
              <TabsTrigger value="recipients" className="text-xs px-3 py-1.5 h-auto rounded">
                Recipients
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Email tab */}
          <TabsContent value="email" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {batch && (
              <>
                {/* Timing config — hidden once sent. For scheduled non-follow-ups
                    the immediately/schedule toggle is gone; only the datetime
                    remains so the user can reschedule. */}
                {!isSent && (
                  <div className="pb-4 border-b border-neutral-100 space-y-2">
                    <Label className="text-xs font-medium text-neutral-600">
                      {isFollowUp ? "Send delay" : isScheduled ? "Scheduled for" : "Send timing"}
                    </Label>

                    {isFollowUp ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={batch.scheduledDelay?.value ?? 3}
                          onChange={(e) =>
                            onUpdate({
                              scheduledDelay: {
                                value: Math.max(1, parseInt(e.target.value) || 1),
                                unit: batch.scheduledDelay?.unit ?? "days",
                              },
                            })
                          }
                          className="w-20 text-sm h-8"
                        />
                        <select
                          value={batch.scheduledDelay?.unit ?? "days"}
                          onChange={(e) =>
                            onUpdate({
                              scheduledDelay: {
                                value: batch.scheduledDelay?.value ?? 3,
                                unit: e.target.value as "days" | "hours",
                              },
                            })
                          }
                          className="h-8 px-2 text-xs border border-neutral-200 rounded bg-white text-neutral-700 focus:outline-none"
                        >
                          <option value="days">days</option>
                          <option value="hours">hours</option>
                        </select>
                        <span className="text-xs text-neutral-400">after previous step</span>
                      </div>
                    ) : isScheduled ? (
                      <>
                        <Input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(e) => onUpdate({ scheduledAt: e.target.value })}
                          className="text-xs h-8 w-fit"
                        />
                        <p className="text-[11px] text-neutral-400">
                          Edits apply when you reschedule.
                        </p>
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
                                  new Date(Date.now() + 3600000).toISOString().slice(0, 16),
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
                          <Input
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => onUpdate({ scheduledAt: e.target.value })}
                            className="text-xs h-8 w-fit"
                          />
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
                />
              </>
            )}
          </TabsContent>

          {/* Recipients tab */}
          <TabsContent value="recipients" className="flex-1 overflow-y-auto px-6 py-4">
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
                <ContactTable
                  contacts={displayedContacts}
                  setContacts={(v) => onUpdate({ contacts: v })}
                  readOnly={locked || isFollowUp}
                  readOnlyNotice={
                    isFollowUp
                      ? "Recipients are inherited from the previous email and edited there."
                      : undefined
                  }
                  recipientResults={batch.recipientResults}
                />
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
              disabled={isSubmitting || !batch}
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
              isScheduled ? "Reschedule" : scheduledAt ? "Schedule Send" : "Send Now"
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
                <div className="space-y-1.5 rounded border border-neutral-200 bg-neutral-50 p-3">
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Subject</span>
                    <p className="mt-0.5 text-neutral-800">{batch.subject}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Recipients</span>
                    <div className="mt-1 space-y-1">
                      {sampleRecipients.map((contact) => (
                        <p key={contact.id} className="truncate text-neutral-700">
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
      </SheetContent>
    </Sheet>
  );
}
