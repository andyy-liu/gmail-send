"use client";

import { useState, useRef, useEffect } from "react";
import { Batch } from "@/lib/batches";
import { Plus, X } from "lucide-react";

interface BatchTabsProps {
  batches: Batch[];
  activeBatchId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

const STATUS_DOT: Record<Batch["status"], string> = {
  active: "bg-neutral-400",
  sent: "bg-green-500",
  scheduled: "bg-amber-500",
};

export function BatchTabs({
  batches,
  activeBatchId,
  onSelect,
  onRename,
  onDelete,
  onNew,
}: BatchTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  function startEdit(batch: Batch, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(batch.id);
    setEditName(batch.name);
  }

  function commitEdit(id: string) {
    const trimmed = editName.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === "Enter") commitEdit(id);
    else if (e.key === "Escape") setEditingId(null);
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-px border-b border-neutral-200 dark:border-neutral-800 -mx-1 px-1">
      {batches.map((batch) => {
        const isActive = batch.id === activeBatchId;
        return (
          <div
            key={batch.id}
            onClick={() => {
              if (editingId === batch.id) return;
              onSelect(batch.id);
            }}
            className={`group relative flex items-center gap-1.5 px-3 py-2 rounded-t-lg cursor-pointer select-none whitespace-nowrap transition-colors flex-shrink-0 ${
              isActive
                ? "bg-white dark:bg-neutral-900 border border-b-white dark:border-neutral-700 dark:border-b-neutral-900 border-neutral-200 -mb-px text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
            }`}
          >
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${STATUS_DOT[batch.status]}`} />
            {batch.parentBatchId && (
              <span className="text-neutral-400 text-[10px] leading-none">↩</span>
            )}

            {editingId === batch.id ? (
              <input
                ref={editInputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitEdit(batch.id)}
                onKeyDown={(e) => handleKeyDown(e, batch.id)}
                onClick={(e) => e.stopPropagation()}
                className="text-sm bg-transparent border-b border-neutral-400 dark:border-neutral-500 focus:outline-none w-24 text-neutral-900 dark:text-neutral-100"
              />
            ) : (
              <span
                className="text-sm font-medium"
                onDoubleClick={(e) => startEdit(batch, e)}
                title="Double-click to rename"
              >
                {batch.name}
              </span>
            )}

            {batches.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(batch.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity ml-0.5"
                title="Delete batch"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="flex items-center gap-1 px-2.5 py-2 text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 rounded-t-lg transition-colors flex-shrink-0"
        title="New batch"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>New Batch</span>
      </button>
    </div>
  );
}
