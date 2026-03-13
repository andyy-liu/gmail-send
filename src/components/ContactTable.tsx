import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Contact } from "@/lib/gmail";
import { Trash2, Plus } from "lucide-react";

interface ContactTableProps {
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
}

export function ContactTable({ contacts, setContacts }: ContactTableProps) {
  const updateContact = (index: number, field: keyof Contact, value: string) => {
    const newContacts = [...contacts];
    newContacts[index][field] = value;
    setContacts(newContacts);
  };

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const addContact = () => {
    setContacts([...contacts, { email: "", firstName: "", company: "" }]);
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
              <TableRow key={i}>
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
      <Button variant="outline" size="sm" onClick={addContact} className="gap-2">
        <Plus className="h-4 w-4" />
        Add Row
      </Button>
    </div>
  );
}
