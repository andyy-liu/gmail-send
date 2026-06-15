"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Batch } from "@/lib/batches";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  deleteSavedAttachment,
  fetchSavedAttachments,
  formatAttachmentSize,
  type SavedAttachment,
  uploadAttachmentFile,
} from "@/lib/attachments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: Batch[];
  onUpdateBatch: (id: string, patch: Partial<Batch>) => void;
}

export function AttachmentsDialog({
  open,
  onOpenChange,
  batches,
  onUpdateBatch,
}: AttachmentsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<SavedAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedAttachment | null>(null);

  async function loadAttachments() {
    setLoading(true);
    try {
      setAttachments(await fetchSavedAttachments());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load attachments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void loadAttachments();
  }, [open]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Attachment must be a PDF.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`PDF must be ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} or smaller.`);
      return;
    }

    setUploading(true);
    try {
      const uploaded = await uploadAttachmentFile(file);
      setAttachments((prev) => [uploaded, ...prev.filter((a) => a.storagePath !== uploaded.storagePath)]);
      toast.success("Attachment uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload attachment.");
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteSavedAttachment(deleteTarget.storagePath);
      setAttachments((prev) => prev.filter((a) => a.storagePath !== deleteTarget.storagePath));
      for (const batch of batches) {
        if (batch.attachment?.storagePath === deleteTarget.storagePath) {
          onUpdateBatch(batch.id, { attachment: null });
        }
      }
      toast.success("Attachment deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete attachment.");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
      >
        <DialogContent className="max-w-xl" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Attachments
            </DialogTitle>
            <DialogDescription>
              Store sponsorship PDFs once and reuse them across campaigns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-neutral-800">Saved PDFs</p>
                <p className="text-[11px] text-neutral-400">
                  PDF files up to {formatAttachmentSize(MAX_ATTACHMENT_BYTES)}.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload PDF
              </Button>
            </div>

            <div className="max-h-[360px] overflow-y-auto rounded border border-neutral-200">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading attachments
                </div>
              ) : attachments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <FileText className="h-6 w-6 text-neutral-300" />
                  <p className="mt-2 text-xs font-medium text-neutral-600">No saved PDFs</p>
                  <p className="mt-1 text-[11px] text-neutral-400">Upload a sponsorship package to reuse it.</p>
                </div>
              ) : (
                attachments.map((attachment) => (
                  <div
                    key={attachment.storagePath}
                    className="flex min-w-0 items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-neutral-800">{attachment.name}</p>
                      <p className="text-[11px] text-neutral-400">
                        {formatAttachmentSize(attachment.size)}
                        {attachment.updatedAt ? ` · ${new Date(attachment.updatedAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(attachment)}
                      className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete attachment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null);
        }}
        title="Delete attachment?"
        description={
          <p>
            This deletes {deleteTarget?.name} from storage and removes it from any email step currently using it.
          </p>
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={confirmDelete}
      />
    </>
  );
}
