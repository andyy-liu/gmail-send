import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/RichTextEditor";
import { VariableChips } from "@/components/VariableChips";
import type { CustomVariable } from "@/lib/variables";

interface TemplateEditorProps {
  subject: string;
  setSubject: (val: string) => void;
  body: string;
  setBody: (val: string) => void;
  subjectReadOnly?: boolean;
  readOnly?: boolean;
  variables?: CustomVariable[];
}

export function TemplateEditor({
  subject,
  setSubject,
  body,
  setBody,
  subjectReadOnly,
  readOnly,
  variables,
}: TemplateEditorProps) {
  const subjectLocked = subjectReadOnly || readOnly;
  const subjectRef = useRef<HTMLInputElement>(null);

  const insertIntoSubject = (token: string) => {
    const input = subjectRef.current;
    if (!input) {
      setSubject(subject + token);
      return;
    }
    const start = input.selectionStart ?? subject.length;
    const end = input.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + token + subject.slice(end);
    setSubject(next);
    // Restore caret position to right after the inserted token.
    requestAnimationFrame(() => {
      if (!input) return;
      const caret = start + token.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-6 bg-white dark:bg-neutral-900 p-6 rounded-xl border shadow-sm">
      <div className="space-y-2">
        {subjectLocked ? (
          <>
            <Label className="text-sm font-semibold">Email Subject</Label>
            {subjectReadOnly && !readOnly && (
              <p className="text-xs text-neutral-400">Locked to match original thread</p>
            )}
            <div className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400">
              {subject}
            </div>
          </>
        ) : (
          <>
            <Label htmlFor="subject" className="text-sm font-semibold">Email Subject</Label>
            {variables && (
              <VariableChips variables={variables} onInsert={insertIntoSubject} />
            )}
            <Input
              ref={subjectRef}
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
          readOnly={readOnly}
          variables={variables}
        />
      </div>
    </div>
  );
}
