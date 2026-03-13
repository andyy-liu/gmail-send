"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import { FontSize } from "@/lib/tiptap-font-size";
import { useEffect, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, Underline as UnderlineIcon,
  Link2, Link2Off, Palette,
} from "lucide-react";

interface SignatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signature: string;
  onSave: (html: string) => void;
}

const FONT_SIZES = ["8", "10", "12", "14", "16", "18"];
const COLORS = [
  "#000000", "#374151", "#6b7280", "#dc2626",
  "#2563eb", "#16a34a", "#9333ea", "#db2777",
];

export function SignatureDialog({ open, onOpenChange, signature, onSave }: SignatureDialogProps) {
  const [draft, setDraft] = useState(signature);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Hard break on Enter — tight signature line spacing
        hardBreak: {
          keepMarks: true,
        },
        heading: false,
        orderedList: false,
        bulletList: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Color,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
    ],
    content: signature,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[180px] px-4 py-3 text-sm leading-snug",
      },
      handleKeyDown: (_view, event) => {
        // Make Enter insert a hard break instead of a new paragraph
        if (event.key === "Enter" && !event.shiftKey) {
          editor?.commands.setHardBreak();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setDraft(editor.getHTML());
    },
    immediatelyRender: false,
  });

  // Sync when dialog re-opens with potentially updated signature
  useEffect(() => {
    if (open && editor) {
      editor.commands.setContent(signature);
    }
  }, [open, editor, signature]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Edit Signature</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-neutral-500 -mt-2">
          Your signature is automatically appended to every draft. Each line is tightly spaced — press <kbd className="px-1 py-0.5 rounded border text-[10px] font-mono bg-neutral-100">Enter</kbd> for a new line.
        </p>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border rounded-t-lg bg-neutral-50 dark:bg-neutral-800/60">
          <Toggle size="sm" pressed={!!editor?.isActive("bold")} onPressedChange={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold">
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={!!editor?.isActive("italic")} onPressedChange={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic">
            <Italic className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={!!editor?.isActive("underline")} onPressedChange={() => editor?.chain().focus().toggleUnderline().run()} aria-label="Underline">
            <UnderlineIcon className="h-3.5 w-3.5" />
          </Toggle>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <select
            className="text-xs px-1.5 py-1 rounded-md border border-transparent bg-transparent hover:bg-neutral-200 dark:hover:bg-neutral-700 focus:outline-none cursor-pointer"
            onChange={(e) => {
              if (e.target.value) editor?.chain().focus().setFontSize(`${e.target.value}px`).run();
            }}
            defaultValue=""
            aria-label="Font Size"
          >
            <option value="" disabled>Size</option>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <Palette className="h-3.5 w-3.5 text-neutral-400 mx-1" />
          {COLORS.map((color) => (
            <button
              key={color}
              className="h-4 w-4 rounded-sm border border-neutral-300 dark:border-neutral-600 cursor-pointer transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
              onClick={() => editor?.chain().focus().setColor(color).run()}
              aria-label={`Color ${color}`}
            />
          ))}

          <Separator orientation="vertical" className="h-5 mx-1" />

          <Toggle size="sm" pressed={!!editor?.isActive("link")} onPressedChange={setLink} aria-label="Link">
            <Link2 className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={false} onPressedChange={() => editor?.chain().focus().unsetLink().run()} aria-label="Remove Link" disabled={!editor?.isActive("link")}>
            <Link2Off className="h-3.5 w-3.5" />
          </Toggle>
        </div>

        {/* Editor */}
        <div className="border border-t-0 rounded-b-lg bg-white dark:bg-neutral-900 overflow-hidden focus-within:ring-1 focus-within:ring-ring">
          <EditorContent editor={editor} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save Signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
