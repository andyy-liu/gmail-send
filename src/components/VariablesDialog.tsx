"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, Eye, EyeOff } from "lucide-react";
import type { CustomVariable } from "@/lib/variables";
import {
  isValidVariableName,
  isReservedName,
  RESERVED_VARIABLE_NAMES,
  extractTokens,
} from "@/lib/variables";
import type { Batch } from "@/lib/batches";

interface VariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: CustomVariable[];
  batches: Batch[];
  onCreate: (name: string) => Promise<CustomVariable | null>;
  onRename: (id: string, newName: string) => Promise<boolean>;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

/** Count how many batches reference this variable name in subject or body. */
function countReferences(name: string, batches: Batch[]): number {
  return batches.filter((b) => {
    const tokens = new Set([...extractTokens(b.subject), ...extractTokens(b.body)]);
    return tokens.has(name);
  }).length;
}

function validate(name: string, variables: CustomVariable[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required.";
  if (!isValidVariableName(trimmed)) {
    return "Use letters, numbers, and underscores. Must start with a letter.";
  }
  if (isReservedName(trimmed)) {
    return `"${trimmed}" is reserved (built-in).`;
  }
  if (variables.some((v) => v.id !== ignoreId && v.name === trimmed)) {
    return `"${trimmed}" already exists.`;
  }
  return null;
}

export function VariablesDialog({
  open,
  onOpenChange,
  variables,
  batches,
  onCreate,
  onRename,
  onToggleEnabled,
  onDelete,
}: VariablesDialogProps) {
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<{
    id: string;
    oldName: string;
    newName: string;
    refs: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomVariable | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setNewName("");
      setNewError(null);
      setEditingId(null);
      setEditError(null);
    }
    onOpenChange(next);
  };

  const sortedVariables = useMemo(
    () => [...variables].sort((a, b) => a.position - b.position),
    [variables]
  );

  const handleCreate = async () => {
    const err = validate(newName, variables);
    if (err) {
      setNewError(err);
      return;
    }
    const created = await onCreate(newName.trim());
    if (created) {
      setNewName("");
      setNewError(null);
    }
  };

  const startEdit = (v: CustomVariable) => {
    setEditingId(v.id);
    setEditName(v.name);
    setEditError(null);
  };

  const commitEdit = (v: CustomVariable) => {
    const trimmed = editName.trim();
    if (trimmed === v.name) {
      setEditingId(null);
      setEditError(null);
      return;
    }
    const err = validate(trimmed, variables, v.id);
    if (err) {
      setEditError(err);
      return;
    }
    const refs = countReferences(v.name, batches);
    setPendingRename({ id: v.id, oldName: v.name, newName: trimmed, refs });
  };

  const confirmRename = async () => {
    if (!pendingRename) return;
    const ok = await onRename(pendingRename.id, pendingRename.newName);
    if (ok) {
      setEditingId(null);
      setEditError(null);
    }
    setPendingRename(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Variables</DialogTitle>
            <DialogDescription className="text-xs">
              Create reusable tokens like <code className="font-mono">{"{{Year}}"}</code> to drop into subjects and bodies. Each enabled variable adds a column to the recipients table. Built-ins ({RESERVED_VARIABLE_NAMES.join(", ")}) are always available.
            </DialogDescription>
          </DialogHeader>

          {/* Create */}
          <div className="space-y-1.5">
            <div className="flex items-start gap-2">
              <Input
                placeholder="e.g. Year, Role, EventDate"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (newError) setNewError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={handleCreate} className="h-8 px-3 gap-1.5 shrink-0">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {newError && <p className="text-[11px] text-red-600">{newError}</p>}
          </div>

          {/* List */}
          <div className="max-h-[320px] overflow-y-auto -mx-2 px-2 space-y-1">
            {sortedVariables.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-6">
                No custom variables yet. Add one above.
              </p>
            ) : (
              sortedVariables.map((v) => {
                const isEditing = editingId === v.id;
                return (
                  <div
                    key={v.id}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded border ${
                      v.enabled ? "border-neutral-200 bg-white" : "border-dashed border-neutral-200 bg-neutral-50"
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Input
                            ref={editInputRef}
                            value={editName}
                            onChange={(e) => {
                              setEditName(e.target.value);
                              if (editError) setEditError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit(v);
                              }
                              if (e.key === "Escape") {
                                setEditingId(null);
                                setEditError(null);
                              }
                            }}
                            className="h-7 text-xs font-mono"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => commitEdit(v)}
                            aria-label="Save"
                          >
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingId(null);
                              setEditError(null);
                            }}
                            aria-label="Cancel"
                          >
                            <X className="h-3.5 w-3.5 text-neutral-500" />
                          </Button>
                        </div>
                        {editError && <p className="text-[11px] text-red-600 mt-1">{editError}</p>}
                      </div>
                    ) : (
                      <>
                        <code
                          className={`flex-1 text-xs font-mono truncate ${
                            v.enabled ? "text-neutral-800" : "text-neutral-400 line-through"
                          }`}
                        >
                          {`{{${v.name}}}`}
                        </code>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={v.enabled}
                          aria-label={v.enabled ? "Disable variable" : "Enable variable"}
                          onClick={() => onToggleEnabled(v.id, !v.enabled)}
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
                            v.enabled
                              ? "text-neutral-600 hover:bg-neutral-100"
                              : "text-neutral-400 hover:bg-neutral-100"
                          }`}
                          title={
                            v.enabled
                              ? "Visible in recipients table and usable in templates"
                              : "Hidden from table; cannot be used in templates"
                          }
                        >
                          {v.enabled ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                          {v.enabled ? "On" : "Off"}
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => startEdit(v)}
                          aria-label="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5 text-neutral-500" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-neutral-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setPendingDelete(v)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRename !== null}
        onOpenChange={(o) => { if (!o) setPendingRename(null); }}
        title="Rename this variable?"
        description={
          pendingRename ? (
            // DialogDescription renders as <p>; use inline spans with block
            // styling so we don't nest block elements inside it.
            <span className="block space-y-2 text-sm text-neutral-600">
              <span className="block">
                Rename <code className="font-mono">{`{{${pendingRename.oldName}}}`}</code> to{" "}
                <code className="font-mono">{`{{${pendingRename.newName}}}`}</code>.
              </span>
              {pendingRename.refs > 0 ? (
                <span className="block">
                  This will rewrite <strong>{pendingRename.refs}</strong>{" "}
                  email template{pendingRename.refs === 1 ? "" : "s"} and update all stored recipient values.
                </span>
              ) : (
                <span className="block">No templates reference this variable yet.</span>
              )}
            </span>
          ) : ""
        }
        confirmLabel="Rename"
        confirmVariant="default"
        onConfirm={confirmRename}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title="Delete this variable?"
        description={
          pendingDelete ? (
            (() => {
              const refs = countReferences(pendingDelete.name, batches);
              return (
                <span className="block space-y-2 text-sm text-neutral-600">
                  <span className="block">
                    Permanently delete <code className="font-mono">{`{{${pendingDelete.name}}}`}</code>. All values stored on recipients for this variable will be discarded.
                  </span>
                  {refs > 0 && (
                    <span className="block rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                      <strong>{refs}</strong> template{refs === 1 ? "" : "s"} reference{refs === 1 ? "s" : ""} this variable. Sending those will fail until you remove the reference.
                    </span>
                  )}
                </span>
              );
            })()
          ) : ""
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
        }}
      />
    </>
  );
}
