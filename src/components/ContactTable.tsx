import { useRef } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactRow } from "@/lib/batches";
import { Trash2, Plus, Upload, Eraser } from "lucide-react";

interface ContactTableProps {
  contacts: ContactRow[];
  setContacts: (contacts: ContactRow[]) => void;
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

function parseCSV(text: string): ContactRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  return lines.slice(1).flatMap((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    const email = row["email"] ?? "";
    const firstName = row["firstname"] ?? row["first_name"] ?? "";
    const company = row["company"] ?? "";
    if (!email && !firstName && !company) return [];
    return [{ id: crypto.randomUUID(), email, firstName, company }];
  });
}

export function ContactTable({ contacts, setContacts }: ContactTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length > 0) setContacts(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const updateContact = (index: number, field: keyof ContactRow, value: string) => {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    setContacts(updated);
  };

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const addContact = () => {
    setContacts([...contacts, { id: crypto.randomUUID(), email: "", firstName: "", company: "" }]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Target Email</TableHead>
              <TableHead className="w-[30%]">First Name</TableHead>
              <TableHead className="w-[30%]">Company</TableHead>
              <TableHead className="w-[10%] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact, i) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <Input
                    placeholder="email@example.com"
                    value={contact.email}
                    onChange={(e) => updateContact(i, "email", e.target.value)}
                    className="border-transparent hover:border-border focus-visible:ring-1 bg-transparent transition-all"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="First Name"
                    value={contact.firstName}
                    onChange={(e) => updateContact(i, "firstName", e.target.value)}
                    className="border-transparent hover:border-border focus-visible:ring-1 bg-transparent transition-all"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="Company"
                    value={contact.company}
                    onChange={(e) => updateContact(i, "company", e.target.value)}
                    className="border-transparent hover:border-border focus-visible:ring-1 bg-transparent transition-all"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => removeContact(i)} className="text-neutral-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {contacts.length === 0 && (
          <div className="text-center py-6 text-sm text-neutral-500">
            No contacts added yet.
          </div>
        )}
      </div>
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
          <Button variant="outline" size="sm" onClick={() => setContacts([])} className="gap-2 text-neutral-400 hover:text-red-500">
            <Eraser className="h-4 w-4" />
            Clear All
          </Button>
        )}
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
      </div>
    </div>
  );
}
