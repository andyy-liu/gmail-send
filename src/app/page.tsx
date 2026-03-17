"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ContactTable } from "@/components/ContactTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { SignatureDialog } from "@/components/SignatureDialog";
import { ScheduledJobsPanel } from "@/components/ScheduledJobsPanel";
import { BatchTabs } from "@/components/BatchTabs";
import { Batch, createBatch, migrateLegacyData } from "@/lib/batches";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, SendIcon, LogOut, PenLine, Clock, FileText, CornerDownLeft } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const [batches, setBatches] = useLocalStorage<Batch[]>("gmailsend_batches", []);
  const [activeBatchId, setActiveBatchId] = useState<string>("");
  const [signature, setSignature] = useLocalStorage("gmailsend_signature", "");
  const [scheduledAt, setScheduledAt] = useLocalStorage("gmailsend_scheduled_at", "");
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sigDialogOpen, setSigDialogOpen] = useState(false);
  const [sendMode, setSendMode] = useState<"draft" | "send">("draft");

  // Migration / init: runs once client-side
  useEffect(() => {
    if (batches.length === 0) {
      const migrated = migrateLegacyData();
      const initial = migrated ?? [createBatch("Batch 1")];
      setBatches(initial);
      setActiveBatchId(initial[0].id);
    } else if (!activeBatchId || !batches.find((b) => b.id === activeBatchId)) {
      setActiveBatchId(batches[0].id);
    }
  }, []); // eslint-disable-line

  const activeBatch = batches.find((b) => b.id === activeBatchId) ?? batches[0];

  function updateActiveBatch(patch: Partial<Batch>) {
    setBatches((prev) => prev.map((b) => (b.id === activeBatchId ? { ...b, ...patch } : b)));
  }

  function handleNewBatch() {
    const existingNames = new Set(batches.map((b) => b.name));
    let num = batches.length + 1;
    while (existingNames.has(`Batch ${num}`)) num++;
    const batch = createBatch(`Batch ${num}`);
    setBatches((prev) => [...prev, batch]);
    setActiveBatchId(batch.id);
  }

  function handleRenameBatch(id: string, name: string) {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
  }

  function handleDeleteBatch(id: string) {
    if (batches.length === 1) return;
    const next = batches.find((b) => b.id !== id);
    setBatches((prev) => prev.filter((b) => b.id !== id));
    if (id === activeBatchId && next) setActiveBatchId(next.id);
  }

  function handleFollowUpBatch() {
    if (!activeBatch?.sentResults?.length) return;
    const sentEmails = new Set(activeBatch.sentResults.map((r) => r.email));
    const followUpContacts = activeBatch.contacts.filter((c) => sentEmails.has(c.email));
    if (followUpContacts.length === 0) return;
    const followUp = createBatch(`Follow Up — ${activeBatch.name}`, {
      parentBatchId: activeBatch.id,
      subject: activeBatch.subject,
      body: "",
      contacts: followUpContacts,
    });
    setBatches((prev) => [...prev, followUp]);
    setActiveBatchId(followUp.id);
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-950">
        <Card className="w-full max-w-sm rounded-2xl border-neutral-200 dark:border-neutral-800 shadow-sm bg-white dark:bg-neutral-900 overflow-hidden">
          <CardHeader className="text-center pb-8 pt-10">
            <CardTitle className="text-2xl font-semibold tracking-tight">Gmail Send</CardTitle>
            <CardDescription className="pt-2">Automate customized email drafts.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-10 px-8">
            <Button onClick={() => signIn("google")} className="w-full rounded-xl" size="lg">
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCreateDrafts = async () => {
    setMessage(null);
    setIsSubmitting(true);

    try {
      if (!activeBatch) throw new Error("No active batch.");
      if (!activeBatch.subject || !activeBatch.body) throw new Error("Subject and Body are required.");
      if (activeBatch.contacts.length === 0) throw new Error("At least one contact is required.");

      for (let i = 0; i < activeBatch.contacts.length; i++) {
        const c = activeBatch.contacts[i];
        if (!c.email || !c.firstName || !c.company) {
          throw new Error(`Row ${i + 1} is missing fields. All fields are required.`);
        }
      }

      if (scheduledAt) {
        const res = await fetch("/api/send/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
            scheduledAt,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to schedule send.");

        const formatted = new Date(data.scheduledAt).toLocaleString();
        setMessage({
          type: "success",
          text: `Scheduled ${data.count} email(s) to send at ${formatted}.`,
        });
        setScheduleRefreshKey((k) => k + 1);
        updateActiveBatch({ status: "scheduled" });
      } else if (sendMode === "send" || activeBatch.parentBatchId) {
        let parentThreadIds: Record<string, string> | undefined;
        let parentMimeMessageIds: Record<string, string> | undefined;
        if (activeBatch.parentBatchId) {
          const parent = batches.find((b) => b.id === activeBatch.parentBatchId);
          if (parent?.sentResults?.length) {
            parentThreadIds = {};
            parentMimeMessageIds = {};
            for (const r of parent.sentResults) {
              parentThreadIds[r.email] = r.threadId;
              parentMimeMessageIds[r.email] = r.mimeMessageId;
            }
          }
        }
        const res = await fetch("/api/send/now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
            ...(parentThreadIds && { parentThreadIds, parentMimeMessageIds }),
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send emails.");

        if (data.errors && data.errors.length > 0) {
          setMessage({
            type: "error",
            text: `Sent ${data.results?.length || 0} email(s), but failed on ${data.errors.length}. See console.`,
          });
          console.error("Send errors:", data.errors);
        } else {
          setMessage({
            type: "success",
            text: `Successfully sent ${data.results.length} email(s)!`,
          });
          updateActiveBatch({
            status: "sent",
            sentAt: new Date().toISOString(),
            sentResults: data.results,
          });
        }
      } else {
        const res = await fetch("/api/drafts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: activeBatch.subject,
            body: activeBatch.body,
            signature,
            contacts: activeBatch.contacts,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create drafts.");

        if (data.errors && data.errors.length > 0) {
          setMessage({
            type: "error",
            text: `Created ${data.results?.length || 0} drafts, but failed on ${data.errors.length}. See console.`,
          });
          console.error("Draft errors:", data.errors);
        } else {
          setMessage({
            type: "success",
            text: `Successfully created ${data.results.length} draft(s)!`,
          });
          updateActiveBatch({
            status: "sent",
            sentAt: new Date().toISOString(),
            sentResults: data.results,
          });
        }
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "An unknown error occurred" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="border-b bg-white dark:bg-neutral-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold tracking-tight">Gmail Send</h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">MVP</span>
          </div>
          <div className="flex items-center space-x-4">
            <p className="hidden sm:block text-sm text-neutral-500 font-medium">{session?.user?.name || session?.user?.email}</p>
            <Button variant="ghost" size="sm" onClick={() => setSigDialogOpen(true)} className="gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded-lg">
              <PenLine className="h-4 w-4" />
              Signature
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded-lg">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 lg:p-8 mt-4 space-y-10">
        {batches.length > 0 && activeBatch && (
          <BatchTabs
            batches={batches}
            activeBatchId={activeBatchId}
            onSelect={setActiveBatchId}
            onRename={handleRenameBatch}
            onDelete={handleDeleteBatch}
            onNew={handleNewBatch}
          />
        )}

        {activeBatch && (
          <>
            <section className="space-y-4">
              <p className="text-sm text-neutral-500">Use {`{{FirstName}}`}, {`{{Company}}`}, and {`{{Signature}}`} as variables.</p>
              <TemplateEditor
                subject={activeBatch.subject}
                setSubject={(v) => updateActiveBatch({ subject: v })}
                body={activeBatch.body}
                setBody={(v) => updateActiveBatch({ body: v })}
                subjectReadOnly={!!activeBatch.parentBatchId}
              />
            </section>

            <section className="space-y-4">
              <p className="text-sm text-neutral-500">Add recipients to generate drafts for.</p>
              <ContactTable
                contacts={activeBatch.contacts}
                setContacts={(v) => updateActiveBatch({ contacts: v })}
              />
            </section>

            {activeBatch.status === "sent" && activeBatch.sentResults && activeBatch.sentResults.length > 0 && (
              <div className="border-t pt-6 flex flex-col items-start gap-1">
                <button
                  onClick={handleFollowUpBatch}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <CornerDownLeft className="h-4 w-4" />
                  Follow Up on this batch
                </button>
                <p className="text-xs text-neutral-400 ml-1">
                  Creates a new batch threaded to the {activeBatch.sentResults.length} original email(s)
                </p>
              </div>
            )}
          </>
        )}

        <div className="max-w-2xl mx-auto mt-12 pt-8 border-t flex flex-col items-center space-y-4">
          {!scheduledAt && !activeBatch?.parentBatchId && (
            <div className="flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-0.5 gap-0.5">
              <button
                onClick={() => setSendMode("draft")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  sendMode === "draft"
                    ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                    : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Save as Draft
              </button>
              <button
                onClick={() => setSendMode("send")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  sendMode === "send"
                    ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                    : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                <SendIcon className="h-3.5 w-3.5" />
                Send Now
              </button>
            </div>
          )}

          {!activeBatch?.parentBatchId && <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="flex items-center gap-2 text-sm text-neutral-500 font-medium whitespace-nowrap">
              <Clock className="h-4 w-4" />
              Schedule for
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400"
            />
            {scheduledAt && (
              <button
                onClick={() => setScheduledAt("")}
                className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                Clear
              </button>
            )}
          </div>}

          <Button
            onClick={handleCreateDrafts}
            disabled={isSubmitting}
            size="lg"
            className="w-full sm:w-auto min-w-[240px] rounded-xl h-12 text-base font-medium shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {scheduledAt ? "Scheduling..." : sendMode === "send" ? "Sending..." : "Generating Drafts..."}
              </>
            ) : (
              <>
                <SendIcon className="mr-2 h-4 w-4" />
                {scheduledAt ? "Schedule Send" : sendMode === "send" ? "Send Now" : "Create Drafts in Gmail"}
              </>
            )}
          </Button>

          {message && (
            <div className={`mt-6 px-4 py-3 pb-3 rounded-lg text-sm font-medium w-full text-center border shadow-sm ${message.type === "error" ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900" : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-900"}`}>
              {message.text}
            </div>
          )}
        </div>

        <ScheduledJobsPanel refreshKey={scheduleRefreshKey} />
      </main>

      <SignatureDialog
        open={sigDialogOpen}
        onOpenChange={setSigDialogOpen}
        signature={signature}
        onSave={setSignature}
      />
    </div>
  );
}
