import { createAdminClient } from "@/lib/supabase/server";
import {
  MAX_ATTACHMENT_BYTES,
  type EmailAttachment,
  type PreparedEmailAttachment,
  type SavedAttachment,
  validateEmailAttachment,
} from "@/lib/attachments";

export const ATTACHMENT_BUCKET = "email-attachments";
const ATTACHMENT_FOLDER = "attachments";
const STORAGE_NAME_SEPARATOR = "--";

export function attachmentPathBelongsToUser(storagePath: string, userId: string): boolean {
  return storagePath.startsWith(`${userId}/${ATTACHMENT_FOLDER}/`);
}

function normalizeOriginalFilename(name: string): string {
  const withoutPath = name.replace(/[/\\]/g, " ").replace(/[\u0000-\u001F\u007F]/g, "");
  const collapsed = withoutPath.replace(/\s+/g, " ").trim();
  const withName = collapsed || "attachment.pdf";
  const withExtension = withName.toLowerCase().endsWith(".pdf") ? withName : `${withName}.pdf`;
  if (withExtension.length <= 180) return withExtension;
  return `${withExtension.slice(0, 176).replace(/[. ]+$/g, "")}.pdf`;
}

function storageObjectName(originalName: string): string {
  return `${crypto.randomUUID()}${STORAGE_NAME_SEPARATOR}${encodeURIComponent(normalizeOriginalFilename(originalName))}`;
}

function displayNameFromStorageObjectName(objectName: string): string {
  const separatorIndex = objectName.indexOf(STORAGE_NAME_SEPARATOR);
  if (separatorIndex === -1) return objectName;
  const encodedName = objectName.slice(separatorIndex + STORAGE_NAME_SEPARATOR.length);
  if (!encodedName) return objectName;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function createSignedAttachmentUpload(params: {
  userId: string;
  name: string;
  contentType: string;
  size: number;
}): Promise<{ attachment: SavedAttachment; signedUrl: string }> {
  const attachment: SavedAttachment = {
    name: params.name,
    contentType: params.contentType,
    size: params.size,
    storagePath: `${params.userId}/${ATTACHMENT_FOLDER}/${storageObjectName(params.name)}`,
  };
  const validationError = validateEmailAttachment(attachment);
  if (validationError) throw new Error(validationError);

  const db = createAdminClient();

  const { data, error } = await db.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(attachment.storagePath, { upsert: true });
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to create attachment upload URL");
  }

  return { attachment, signedUrl: data.signedUrl };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const nestedMetadata = metadataRecord(metadata?.metadata);
  const nestedCustomMetadata = metadataRecord(metadata?.customMetadata);
  const value =
    metadata?.[key] ??
    nestedMetadata?.[key] ??
    nestedCustomMetadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const nestedMetadata = metadataRecord(metadata?.metadata);
  const nestedCustomMetadata = metadataRecord(metadata?.customMetadata);
  const value =
    metadata?.[key] ??
    nestedMetadata?.[key] ??
    nestedCustomMetadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function listSavedAttachments(userId: string): Promise<SavedAttachment[]> {
  const db = createAdminClient();
  const prefix = `${userId}/${ATTACHMENT_FOLDER}`;
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) throw error;

  return (data ?? [])
    .filter((item) => item.id !== null)
    .map((item) => {
      const metadata = item.metadata as Record<string, unknown> | null;
      return {
        name: metadataString(metadata, "originalName") ?? displayNameFromStorageObjectName(item.name),
        contentType: metadataString(metadata, "contentType") ?? metadataString(metadata, "mimetype") ?? "application/pdf",
        size: metadataNumber(metadata, "size") ?? metadataNumber(metadata, "contentLength") ?? 0,
        storagePath: `${prefix}/${item.name}`,
        createdAt: item.created_at ?? undefined,
        updatedAt: item.updated_at ?? undefined,
      };
    })
    .filter((attachment) => validateEmailAttachment(attachment) === null);
}

export async function deleteSavedAttachmentForUser(userId: string, storagePath: string): Promise<void> {
  if (!attachmentPathBelongsToUser(storagePath, userId)) {
    throw new Error("Attachment does not belong to this user");
  }

  const db = createAdminClient();
  const { error } = await db.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
  if (error) throw error;

  const { data: batches, error: batchesError } = await db
    .from("batches")
    .select("id, attachment")
    .eq("user_id", userId);
  if (batchesError) throw batchesError;

  const referenced = (batches ?? []).filter((batch) => {
    const attachment = batch.attachment as EmailAttachment | null;
    return attachment?.storagePath === storagePath;
  });
  await Promise.all(
    referenced.map(async (batch) => {
      const { error: updateError } = await db
        .from("batches")
        .update({ attachment: null })
        .eq("id", batch.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;
    })
  );
}

export async function resolveAttachmentForSend(
  attachment: EmailAttachment | null | undefined,
  userId: string,
  batchId: string
): Promise<PreparedEmailAttachment | undefined> {
  if (!attachment) return undefined;

  const validationError = validateEmailAttachment(attachment);
  if (validationError) throw new Error(validationError);
  if (attachment.base64) return attachment as PreparedEmailAttachment;

  void batchId;
  if (!attachment.storagePath || !attachmentPathBelongsToUser(attachment.storagePath, userId)) {
    throw new Error("Attachment does not belong to this user");
  }

  const db = createAdminClient();
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(attachment.storagePath);
  if (error || !data) throw new Error("Attachment file not found");

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment file size is invalid");
  }
  if (buffer.byteLength !== attachment.size) {
    throw new Error("Attachment file size changed after upload");
  }

  return {
    ...attachment,
    base64: buffer.toString("base64"),
  };
}
