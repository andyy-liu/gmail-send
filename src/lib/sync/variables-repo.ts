import { createAdminClient } from "@/lib/supabase/server";
import {
  CustomVariable,
  isValidVariableName,
  isReservedName,
  VARIABLE_NAME_MAX_LEN,
} from "@/lib/variables";

interface DbVariable {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
}

function rowToVariable(r: DbVariable): CustomVariable {
  return { id: r.id, name: r.name, enabled: r.enabled, position: r.position };
}

export async function listVariables(userId: string): Promise<CustomVariable[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("custom_variables")
    .select("id, name, enabled, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToVariable);
}

export class VariableValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariableValidationError";
  }
}

function validateName(name: string) {
  if (!isValidVariableName(name)) {
    throw new VariableValidationError(
      "Variable names must start with a letter and contain only letters, numbers, and underscores."
    );
  }
  if (name.length > VARIABLE_NAME_MAX_LEN) {
    throw new VariableValidationError(`Variable name must be ${VARIABLE_NAME_MAX_LEN} characters or fewer.`);
  }
  if (isReservedName(name)) {
    throw new VariableValidationError(`"${name}" is reserved and cannot be used as a custom variable.`);
  }
}

export async function createVariable(userId: string, name: string): Promise<CustomVariable> {
  validateName(name);
  const db = createAdminClient();

  const { data: maxRow } = await db
    .from("custom_variables")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await db
    .from("custom_variables")
    .insert({ user_id: userId, name, enabled: true, position: nextPosition })
    .select("id, name, enabled, position")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new VariableValidationError(`A variable named "${name}" already exists.`);
    }
    throw error;
  }
  return rowToVariable(data);
}

export async function setVariableEnabled(
  userId: string,
  id: string,
  enabled: boolean
): Promise<CustomVariable> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("custom_variables")
    .update({ enabled })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, name, enabled, position")
    .single();
  if (error || !data) throw error ?? new Error("Variable not found");
  return rowToVariable(data);
}

interface RenameRpcRow {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  rewritten_templates: number;
}

/**
 * Rename a variable atomically via the rename_custom_variable Postgres
 * function. Inside the function: template rewrites in batches, jsonb key
 * renames in contacts and send_recipients, then the variable row update —
 * all in one transaction so any failure rolls everything back.
 */
export async function renameVariable(
  userId: string,
  id: string,
  newName: string
): Promise<{ variable: CustomVariable; rewrittenTemplates: number }> {
  validateName(newName);
  const db = createAdminClient();

  const { data, error } = await db.rpc("rename_custom_variable", {
    p_user_id: userId,
    p_variable_id: id,
    p_new_name: newName,
  });
  if (error) {
    if (error.code === "23505") {
      throw new VariableValidationError(`A variable named "${newName}" already exists.`);
    }
    if (error.code === "P0002" || /Variable not found/i.test(error.message ?? "")) {
      throw new Error("Variable not found");
    }
    throw error;
  }

  const rows = (data ?? []) as RenameRpcRow[];
  const row = rows[0];
  if (!row) throw new Error("Variable not found");
  return {
    variable: { id: row.id, name: row.name, enabled: row.enabled, position: row.position },
    rewrittenTemplates: row.rewritten_templates,
  };
}

export async function deleteVariable(userId: string, id: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("custom_variables")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * For the "Rename will rewrite N templates" / "Delete will affect N templates"
 * confirmation dialogs. Counts batches whose subject or body references the
 * given name as a {{Token}}.
 */
export async function countTemplateReferences(userId: string, name: string): Promise<number> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("batches")
    .select("subject, body_html")
    .eq("user_id", userId);
  if (error) throw error;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`);
  return (data ?? []).filter((b) => re.test(b.subject ?? "") || re.test(b.body_html ?? "")).length;
}
