"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { FontSize } from "@/lib/tiptap-font-size";
import { useEffect, useCallback, useState, useRef } from "react";
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
  Link2, Link2Off, Palette, ImagePlus,
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

// Cap inserted images so a single huge clipboard paste doesn't blow past the
// signature size limit. ~4MB raw is ~5.3MB base64; we reject above this.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Natural-size cap applied when pasting/dropping a raw bitmap with no width hint.
const DEFAULT_MAX_INSERT_WIDTH = 600;
const RESIZE_PRESETS = [100, 200, 300, 500];

/**
 * Image with width/height attributes that round-trip to HTML attrs (not CSS),
 * which Gmail/Outlook/Apple Mail respect when rendering email.
 */
const ResizableImage = Image.extend({
  inline: false,
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width"),
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => el.getAttribute("height"),
        renderHTML: (attrs) => (attrs.height ? { height: attrs.height } : {}),
      },
    };
  },
});

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function naturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

export function SignatureDialog({ open, onOpenChange, signature, onSave }: SignatureDialogProps) {
  const [draft, setDraft] = useState(signature);
  const [imageSelected, setImageSelected] = useState(false);
  const [selectedWidth, setSelectedWidth] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      ResizableImage.configure({
        allowBase64: true,
        HTMLAttributes: { style: "max-width:100%;height:auto;" },
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
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void insertImageFile(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        for (const file of imageFiles) void insertImageFile(file);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      setDraft(editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      const active = editor.isActive("image");
      setImageSelected(active);
      if (active) {
        const w = editor.getAttributes("image").width;
        setSelectedWidth(w ? String(w) : "");
      }
    },
    immediatelyRender: false,
  });

  const insertImageFile = async (file: File) => {
    if (!editor) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert(`Image is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`);
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const { width, height } = await naturalSize(dataUrl);
    // If image is wider than our default cap, scale down proportionally;
    // otherwise insert at natural size so pasted images "look the same."
    let w: number | null = null;
    let h: number | null = null;
    if (width > 0) {
      if (width > DEFAULT_MAX_INSERT_WIDTH) {
        w = DEFAULT_MAX_INSERT_WIDTH;
        h = Math.round((height / width) * DEFAULT_MAX_INSERT_WIDTH);
      } else {
        w = width;
        h = height;
      }
    }
    editor
      .chain()
      .focus()
      .setImage({ src: dataUrl, ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) })
      .run();
  };

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

  const applyImageWidth = (rawWidth: number | string | null) => {
    if (!editor) return;
    const attrs = editor.getAttributes("image");
    const currentW = Number(attrs.width) || null;
    const currentH = Number(attrs.height) || null;
    if (rawWidth === null || rawWidth === "") {
      editor.chain().focus().updateAttributes("image", { width: null, height: null }).run();
      setSelectedWidth("");
      return;
    }
    const w = typeof rawWidth === "string" ? parseInt(rawWidth, 10) : rawWidth;
    if (!Number.isFinite(w) || w <= 0) return;
    let h: number | null = null;
    if (currentW && currentH) {
      h = Math.round((currentH / currentW) * w);
    }
    editor.chain().focus().updateAttributes("image", { width: w, ...(h ? { height: h } : {}) }).run();
    setSelectedWidth(String(w));
  };

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

          <Separator orientation="vertical" className="h-5 mx-1" />

          <Toggle size="sm" pressed={false} onPressedChange={() => fileInputRef.current?.click()} aria-label="Insert Image">
            <ImagePlus className="h-3.5 w-3.5" />
          </Toggle>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void insertImageFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Image resize controls — shown when an image is selected */}
        {imageSelected && (
          <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 -mt-2 border-x border-b bg-neutral-50 dark:bg-neutral-800/60 text-xs">
            <span className="text-neutral-500 mr-1">Image width:</span>
            {RESIZE_PRESETS.map((px) => (
              <button
                key={px}
                onClick={() => applyImageWidth(px)}
                className="px-2 py-0.5 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer"
              >
                {px}px
              </button>
            ))}
            <input
              type="number"
              min={10}
              max={2000}
              value={selectedWidth}
              onChange={(e) => setSelectedWidth(e.target.value)}
              onBlur={() => applyImageWidth(selectedWidth)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyImageWidth(selectedWidth);
                }
              }}
              placeholder="px"
              className="w-16 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-600 bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Custom width in pixels"
            />
            <button
              onClick={() => applyImageWidth(null)}
              className="ml-1 px-2 py-0.5 rounded border border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            >
              Reset
            </button>
          </div>
        )}

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
