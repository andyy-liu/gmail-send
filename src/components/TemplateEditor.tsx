import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/RichTextEditor";

interface TemplateEditorProps {
  subject: string;
  setSubject: (val: string) => void;
  body: string;
  setBody: (val: string) => void;
  subjectReadOnly?: boolean;
}

export function TemplateEditor({ subject, setSubject, body, setBody, subjectReadOnly }: TemplateEditorProps) {
  return (
    <div className="space-y-6 bg-white dark:bg-neutral-900 p-6 rounded-xl border shadow-sm">
      <div className="space-y-2">
        {subjectReadOnly ? (
          <>
            <Label className="text-sm font-semibold">Email Subject</Label>
            <p className="text-xs text-neutral-400">Locked to match original thread</p>
            <div className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400">
              {subject}
            </div>
          </>
        ) : (
          <>
            <Label htmlFor="subject" className="text-sm font-semibold">Email Subject</Label>
            <Input
              id="subject"
              placeholder="e.g. Quick question for {{FirstName}} at {{Company}}"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </>
        )}
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
