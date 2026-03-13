import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/RichTextEditor";

interface TemplateEditorProps {
  subject: string;
  setSubject: (val: string) => void;
  body: string;
  setBody: (val: string) => void;
}

export function TemplateEditor({ subject, setSubject, body, setBody }: TemplateEditorProps) {
  return (
    <div className="space-y-6 bg-white dark:bg-neutral-900 p-6 rounded-xl border shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="subject" className="text-sm font-semibold">Email Subject</Label>
        <Input
          id="subject"
          placeholder="e.g. Quick question for {{FirstName}} at {{Company}}"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Email Body</Label>
        <RichTextEditor
          content={body}
          onChange={setBody}
          placeholder='Hi {{FirstName}}, I wanted to reach out about {{Company}}...'
        />
      </div>
    </div>
  );
}
