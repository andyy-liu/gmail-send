"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize } from "@/lib/tiptap-font-size";
import { useEffect, useCallback } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Link2, Link2Off, Palette
} from "lucide-react";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const FONT_SIZES = ["8", "10", "12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = [
  "#000000", "#374151", "#dc2626", "#ea580c",
  "#2563eb", "#16a34a", "#9333ea", "#db2777",
];

export function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We use the ones from extensions below
        heading: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Color,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      TextAlign.configure({ types: ["paragraph", "heading"] }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[220px] px-4 py-3 text-sm leading-relaxed",
        "data-placeholder": placeholder ?? "",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
  });

  // Sync content from localStorage on mount and handle external clear
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (content === "" && current !== "<p></p>") {
      // External clear
      editor.commands.clearContent(true);
    } else if (content !== "" && (current === "<p></p>" || current === "")) {
      // Restore from localStorage on first load
      editor.commands.setContent(content);
    }
  }, [editor, content]);

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

  if (!editor) return null;

  return (
    <div className="rounded-xl border bg-white dark:bg-neutral-900 shadow-sm overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-neutral-50 dark:bg-neutral-800/60">
        {/* Text Format */}
        <Toggle size="sm" pressed={editor.isActive("bold")} onPressedChange={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
          <Bold className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("italic")} onPressedChange={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
          <Italic className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("underline")} onPressedChange={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline">
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("strike")} onPressedChange={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
          <Strikethrough className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Font Size */}
        <select
          className="text-xs px-1.5 py-1 rounded-md border border-transparent bg-transparent hover:bg-neutral-200 dark:hover:bg-neutral-700 focus:outline-none cursor-pointer"
          onChange={(e) => {
            const size = e.target.value;
            if (size) editor.chain().focus().setFontSize(`${size}px`).run();
          }}
          defaultValue=""
          aria-label="Font Size"
        >
          <option value="" disabled>Size</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Color Swatches */}
        <div className="flex items-center gap-0.5" aria-label="Text Color">
          <Palette className="h-3.5 w-3.5 text-neutral-400 mx-1" />
          {COLORS.map((color) => (
            <button
              key={color}
              className="h-4 w-4 rounded-sm border border-neutral-300 dark:border-neutral-600 cursor-pointer transition-transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-ring"
              style={{ backgroundColor: color }}
              onClick={() => editor.chain().focus().setColor(color).run()}
              aria-label={`Color ${color}`}
            />
          ))}
          <button
            className="text-xs px-1 py-0.5 rounded border border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            title="Custom color"
            onClick={() => {
              const c = window.prompt("Enter hex color (e.g. #ff0000)");
              if (c) editor.chain().focus().setColor(c).run();
            }}
          >
            …
          </button>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Lists */}
        <Toggle size="sm" pressed={editor.isActive("bulletList")} onPressedChange={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet List">
          <List className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("orderedList")} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Ordered List">
          <ListOrdered className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Align */}
        <Toggle size="sm" pressed={editor.isActive({ textAlign: "left" })} onPressedChange={() => editor.chain().focus().setTextAlign("left").run()} aria-label="Align Left">
          <AlignLeft className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive({ textAlign: "center" })} onPressedChange={() => editor.chain().focus().setTextAlign("center").run()} aria-label="Center">
          <AlignCenter className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive({ textAlign: "right" })} onPressedChange={() => editor.chain().focus().setTextAlign("right").run()} aria-label="Align Right">
          <AlignRight className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Link */}
        <Toggle size="sm" pressed={editor.isActive("link")} onPressedChange={setLink} aria-label="Link">
          <Link2 className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={false} onPressedChange={() => editor.chain().focus().unsetLink().run()} aria-label="Remove Link" disabled={!editor.isActive("link")}>
          <Link2Off className="h-3.5 w-3.5" />
        </Toggle>
      </div>

      {/* Editor Content */}
      <div className="relative">
        <EditorContent editor={editor} />
        {/* Custom placeholder */}
        {editor.isEmpty && (
          <p className="absolute top-3 left-4 text-sm text-neutral-400 pointer-events-none select-none">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  );
}
