"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ContactTable } from "@/components/ContactTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { SignatureDialog } from "@/components/SignatureDialog";
import { Contact } from "@/lib/gmail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, SendIcon, LogOut, PenLine } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const [subject, setSubject] = useLocalStorage("gmailsend_subject", "");
  const [body, setBody] = useLocalStorage("gmailsend_body", "");
  const [signature, setSignature] = useLocalStorage("gmailsend_signature", "");
  const [contacts, setContacts] = useLocalStorage<Contact[]>("gmailsend_contacts", [
    { email: "", firstName: "", company: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sigDialogOpen, setSigDialogOpen] = useState(false);

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
      if (!subject || !body) throw new Error("Subject and Body are required.");
      if (contacts.length === 0) throw new Error("At least one contact is required.");
      
      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        if (!c.email || !c.firstName || !c.company) {
          throw new Error(`Row ${i + 1} is missing fields. All fields are required.`);
        }
      }

      const res = await fetch("/api/drafts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, signature, contacts }),
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
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">1. Master Template</h2>
              <p className="text-sm text-neutral-500">Use {`{{FirstName}}`}, {`{{Company}}`}, and {`{{Signature}}`} as variables.</p>
            </div>
            <TemplateEditor
              subject={subject} setSubject={setSubject}
              body={body} setBody={setBody}
            />
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">2. Contact Variables</h2>
              <p className="text-sm text-neutral-500">Add recipients to generate drafts for.</p>
            </div>
            <ContactTable
              contacts={contacts} setContacts={setContacts}
            />
          </section>

        <div className="max-w-2xl mx-auto mt-12 pt-8 border-t flex flex-col items-center space-y-4">
          <Button 
            onClick={handleCreateDrafts} 
            disabled={isSubmitting} 
            size="lg"
            className="w-full sm:w-auto min-w-[240px] rounded-xl h-12 text-base font-medium shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating Drafts...
              </>
            ) : (
              <>
                <SendIcon className="mr-2 h-4 w-4" />
                Create Drafts in Gmail
              </>
            )}
          </Button>

          {message && (
            <div className={`mt-6 px-4 py-3 pb-3 rounded-lg text-sm font-medium w-full text-center border shadow-sm ${message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900' : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-900'}`}>
              {message.text}
            </div>
          )}
        </div>
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
