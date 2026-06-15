export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".pdf,application/pdf";

export interface EmailAttachment {
  name: string;
  contentType: string;
  size: number;
  storagePath?: string;
  base64?: string;
}

export interface SavedAttachment extends EmailAttachment {
  storagePath: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PreparedEmailAttachment extends EmailAttachment {
  base64: string;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateBase64Bytes(base64: string): number {
  const normalized = base64.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 === 1) return -1;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return -1;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

export function validateEmailAttachment(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return "Invalid attachment";

  const attachment = input as Partial<EmailAttachment>;
  if (typeof attachment.name !== "string" || !attachment.name.trim()) {
    return "Attachment filename is required";
  }
  if (attachment.name.length > 255 || /[\r\n]/.test(attachment.name)) {
    return "Attachment filename is invalid";
  }
  if (attachment.contentType !== "application/pdf") {
    return "Attachment must be a PDF";
  }
  if (
    typeof attachment.size !== "number" ||
    !Number.isInteger(attachment.size) ||
    attachment.size <= 0 ||
    attachment.size > MAX_ATTACHMENT_BYTES
  ) {
    return `Attachment must be ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} or smaller`;
  }
  if (attachment.storagePath !== undefined) {
    if (
      typeof attachment.storagePath !== "string" ||
      !attachment.storagePath.trim() ||
      attachment.storagePath.length > 1024 ||
      /[\r\n]/.test(attachment.storagePath)
    ) {
      return "Attachment storage path is invalid";
    }
  }
  if (attachment.base64 !== undefined && typeof attachment.base64 !== "string") {
    return "Attachment data is invalid";
  }
  if (!attachment.storagePath && !attachment.base64) return "Attachment data is required";
  if (!attachment.base64) return null;

  const estimatedBytes = estimateBase64Bytes(attachment.base64);
  if (estimatedBytes !== attachment.size) return "Attachment data is invalid";

  return null;
}

export async function uploadAttachmentFile(file: File): Promise<SavedAttachment> {
  const res = await fetch("/api/attachments/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      contentType: "application/pdf",
      size: file.size,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    attachment?: SavedAttachment;
    signedUrl?: string;
    error?: string;
  };
  if (!res.ok || !payload.attachment || !payload.signedUrl) {
    throw new Error(payload.error || "Could not prepare attachment upload.");
  }

  const formData = new FormData();
  formData.append("cacheControl", "3600");
  formData.append(
    "metadata",
    JSON.stringify({
      originalName: file.name,
      contentType: "application/pdf",
      size: file.size,
    })
  );
  formData.append("", file);
  const uploadRes = await fetch(payload.signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "true" },
    body: formData,
  });
  if (!uploadRes.ok) {
    throw new Error(`Attachment upload failed: HTTP ${uploadRes.status}`);
  }

  return payload.attachment;
}

export async function fetchSavedAttachments(): Promise<SavedAttachment[]> {
  const res = await fetch("/api/attachments");
  const payload = (await res.json().catch(() => ({}))) as {
    attachments?: SavedAttachment[];
    error?: string;
  };
  if (!res.ok || !payload.attachments) {
    throw new Error(payload.error || "Could not load attachments.");
  }
  return payload.attachments;
}

export async function deleteSavedAttachment(storagePath: string): Promise<void> {
  const res = await fetch("/api/attachments", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Could not delete attachment.");
  }
}
