import { useRef, useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactRow, RecipientResult } from "@/lib/batches";
import { Trash2, Plus, Upload, Eraser, CheckCircle2, AlertCircle, MailMinus, Clock } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { CustomVariable } from "@/lib/variables";

interface ContactTableProps {
  contacts: ContactRow[];
  setContacts: (contacts: ContactRow[]) => void;
  readOnly?: boolean;
  /** When present, each row shows a per-recipient status badge. */
  recipientResults?: RecipientResult[];
  /** Shown above the table when readOnly (e.g. "Inherits from parent"). */
  readOnlyNotice?: string;
  /** Custom variables; enabled ones become columns. */
  variables?: CustomVariable[];
  /** Optional per-row action for stopping a recipient's sequence. */
  onStopSequence?: (email: string) => void;
  stoppingEmail?: string | null;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_]+/g, "");
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function parseCSV(text: string, variables: CustomVariable[]): ContactRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const rawHeaders = parseCSVLine(lines[0]);
  // Map every header column to a target field. For built-ins we use the
  // normalised name; for custom variables we keep the original variable name
  // so we can write straight into customFields.
  const headerTargets = rawHeaders.map((h): { kind: "builtin" | "custom" | "skip"; name: string } => {
    const norm = normalizeHeader(h);
    if (norm === "email") return { kind: "builtin", name: "email" };
    if (norm === "firstname") return { kind: "builtin", name: "firstName" };
    if (norm === "company") return { kind: "builtin", name: "company" };
    const matched = variables.find((v) => normalizeHeader(v.name) === norm);
    if (matched) return { kind: "custom", name: matched.name };
    return { kind: "skip", name: "" };
  });

  return lines.slice(1).flatMap((line) => {
    const values = parseCSVLine(line);
    let email = "";
    let firstName = "";
    let company = "";
    const customFields: Record<string, string> = {};
    headerTargets.forEach((t, i) => {
      const v = values[i] ?? "";
      if (t.kind === "builtin") {
        if (t.name === "email") email = v;
        else if (t.name === "firstName") firstName = v;
        else if (t.name === "company") company = v;
      } else if (t.kind === "custom") {
        customFields[t.name] = v;
      }
    });
    if (!email && !firstName && !company && Object.keys(customFields).length === 0) return [];
    return [{ id: crypto.randomUUID(), email, firstName, company, customFields }];
  });
}

function StatusBadge({ result }: { result: RecipientResult | undefined }) {
  if (!result) {
    return (
      <span title="Pending" className="inline-flex items-center text-neutral-300">
        <Clock className="h-4 w-4" />
      </span>
    );
  }
  if (result.status === "sent") {
    return (
      <span title="Sent" className="inline-flex items-center text-green-600">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  if (
    result.status === "replied" ||
    result.status === "skipped_replied" ||
    result.status === "manually_stopped"
  ) {
    const tooltip =
      result.status === "replied"
        ? "Recipient replied — sequence stopped."
        : result.status === "manually_stopped"
          ? "Sequence manually stopped."
          : result.error || "Skipped — recipient already replied.";
    return (
      <span
        title={tooltip}
        className="inline-flex items-center text-amber-600"
      >
        <MailMinus className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      title={result.error || "Failed"}
      className="inline-flex items-center text-red-600"
    >
      <AlertCircle className="h-4 w-4" />
    </span>
  );
}

function isStopped(result: RecipientResult | undefined) {
  return (
    result?.status === "replied" ||
    result?.status === "skipped_replied" ||
    result?.status === "manually_stopped"
  );
}

export function ContactTable({
  contacts,
  setContacts,
  readOnly = false,
  recipientResults,
  readOnlyNotice,
  variables,
  onStopSequence,
  stoppingEmail,
}: ContactTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // null = closed, number >= 0 = row index to delete, -1 = clear all
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);

  const resultByEmail = useMemo(() => {
    const map = new Map<string, RecipientResult>();
    for (const r of recipientResults ?? []) {
      if (r.email) map.set(r.email.toLowerCase().trim(), r);
    }
    return map;
  }, [recipientResults]);

  const enabledVariables = useMemo(
    () => (variables ?? []).filter((v) => v.enabled).sort((a, b) => a.position - b.position),
    [variables]
  );

  const showStatusColumn = !!recipientResults;
  const showSequenceActions = !!onStopSequence;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text, variables ?? []);
      if (parsed.length > 0) setContacts(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const updateContact = (index: number, field: "email" | "firstName" | "company", value: string) => {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    setContacts(updated);
  };

  const updateCustomField = (index: number, name: string, value: string) => {
    const updated = [...contacts];
    const current = updated[index].customFields ?? {};
    updated[index] = { ...updated[index], customFields: { ...current, [name]: value } };
    setContacts(updated);
  };

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const addContact = () => {
    setContacts([...contacts, { id: crypto.randomUUID(), email: "", firstName: "", company: "", customFields: {} }]);
  };

  const inputClass = readOnly
    ? "border-transparent bg-transparent text-neutral-600 dark:text-neutral-300 cursor-default pointer-events-none"
    : "border-transparent hover:border-border focus-visible:ring-1 bg-transparent transition-all";

  return (
    <div className="space-y-4">
      {readOnly && readOnlyNotice && (
        <p className="text-xs text-neutral-400">{readOnlyNotice}</p>
      )}
      <div className="rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {showStatusColumn && <TableHead className="w-[36px]" />}
              <TableHead>Target Email</TableHead>
              <TableHead>First Name</TableHead>
              <TableHead>Company</TableHead>
              {enabledVariables.map((v) => (
                <TableHead key={v.id}>{v.name}</TableHead>
              ))}
              {showSequenceActions && <TableHead className="w-[88px] text-right">Sequence</TableHead>}
              {!readOnly && <TableHead className="w-[60px] text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact, i) => {
              const result = resultByEmail.get(contact.email.toLowerCase().trim());
              const stopped = isStopped(result);
              const isStopping = stoppingEmail === contact.email.toLowerCase().trim();
              return (
                <TableRow key={contact.id}>
                  {showStatusColumn && (
                    <TableCell className="pr-0">
                      <StatusBadge result={result} />
                    </TableCell>
                  )}
                  <TableCell>
                    <Input
                      placeholder="email@example.com"
                      value={contact.email}
                      onChange={(e) => updateContact(i, "email", e.target.value)}
                      readOnly={readOnly}
                      tabIndex={readOnly ? -1 : 0}
                      className={inputClass}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="First Name"
                      value={contact.firstName}
                      onChange={(e) => updateContact(i, "firstName", e.target.value)}
                      readOnly={readOnly}
                      tabIndex={readOnly ? -1 : 0}
                      className={inputClass}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="Company"
                      value={contact.company}
                      onChange={(e) => updateContact(i, "company", e.target.value)}
                      readOnly={readOnly}
                      tabIndex={readOnly ? -1 : 0}
                      className={inputClass}
                    />
                  </TableCell>
                  {enabledVariables.map((v) => (
                    <TableCell key={v.id}>
                      <Input
                        placeholder={v.name}
                        value={contact.customFields?.[v.name] ?? ""}
                        onChange={(e) => updateCustomField(i, v.name, e.target.value)}
                        readOnly={readOnly}
                        tabIndex={readOnly ? -1 : 0}
                        className={inputClass}
                      />
                    </TableCell>
                  ))}
                  {showSequenceActions && (
                    <TableCell className="text-right">
                      {stopped ? (
                        <span className="text-[11px] font-medium text-amber-700">
                          Stopped
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onStopSequence?.(contact.email)}
                          disabled={!contact.email.trim() || isStopping}
                          className="h-7 px-2 text-xs text-neutral-500 hover:text-amber-700"
                        >
                          {isStopping ? "Stopping..." : "Stop"}
                        </Button>
                      )}
                    </TableCell>
                  )}
                  {!readOnly && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setConfirmTarget(i)} className="text-neutral-400 hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {contacts.length === 0 && (
          <div className="text-center py-6 text-sm text-neutral-500">
            No contacts added yet.
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addContact} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Row
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          {contacts.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setConfirmTarget(-1)} className="gap-2 text-neutral-400 hover:text-red-500">
              <Eraser className="h-4 w-4" />
              Clear All
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </div>
      )}
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title={confirmTarget === -1 ? "Clear all contacts?" : "Remove contact?"}
        description={confirmTarget === -1 ? "This will remove all contacts from the list." : "This will remove this contact from the list."}
        onConfirm={() => {
          if (confirmTarget === -1) setContacts([]);
          else if (confirmTarget !== null) removeContact(confirmTarget);
        }}
      />
    </div>
  );
}
