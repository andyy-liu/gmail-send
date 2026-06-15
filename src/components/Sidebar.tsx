"use client";

import { useState, useRef, useEffect } from "react";
import { Batch } from "@/lib/batches";
import { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { Plus, ChevronLeft, ChevronRight, MoreHorizontal, PenLine, LogOut, Braces, Bell, Paperclip } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface SidebarProps {
  campaigns: Batch[];
  activeCampaignId: string;
  onSelect: (id: string) => void;
  onNew: () => Promise<string>;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => Promise<string>;
  onDelete: (id: string) => void;
  onSignature: () => void;
  onVariables: () => void;
  onNotifications: () => void;
  onAttachments: () => void;
  session: Session;
}

export function Sidebar({
  campaigns,
  activeCampaignId,
  onSelect,
  onNew,
  onRename,
  onDuplicate,
  onDelete,
  onSignature,
  onVariables,
  onNotifications,
  onAttachments,
  session,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function startRename(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
  }

  function commitRename() {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  }

  async function handleNewCampaign() {
    const id = await onNew();
    if (!id) return;
    startRename(id, "");
    setEditName("");
  }

  return (
    <div
      className="relative flex flex-col border-r border-neutral-200 bg-white shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 48 : "clamp(200px, 16vw, 280px)" }}
    >
      {!collapsed && (
        <>
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-neutral-200">
            <span className="text-sm font-semibold text-neutral-900">Gmail Send</span>
          </div>

          {/* Campaign list */}
          <div className="flex-1 overflow-y-auto py-1">
            <button
              onClick={handleNewCampaign}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New campaign
            </button>

            {campaigns.map((c) => (
              <div
                key={c.id}
                className={`group relative flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                  c.id === activeCampaignId ? "bg-neutral-100" : "hover:bg-neutral-50"
                }`}
                onClick={() => editingId !== c.id && onSelect(c.id)}
              >
                {editingId === c.id ? (
                  <input
                    ref={inputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 text-xs bg-transparent outline-none border-b border-neutral-400 text-neutral-800 py-0.5"
                    placeholder="Campaign name"
                  />
                ) : (
                  <span className="flex-1 text-xs text-neutral-700 truncate">{c.name}</span>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-200 transition-opacity shrink-0"
                  >
                    <MoreHorizontal className="h-3 w-3 text-neutral-500" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start" className="w-28">
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(c.id, c.name);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDuplicate(c.id);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(c.id);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-neutral-200 p-2 space-y-0.5">
            <button
              onClick={onNotifications}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded transition-colors"
            >
              <Bell className="h-3.5 w-3.5 shrink-0" />
              Notifications
            </button>
            <button
              onClick={onVariables}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded transition-colors"
            >
              <Braces className="h-3.5 w-3.5 shrink-0" />
              Variables
            </button>
            <button
              onClick={onAttachments}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded transition-colors"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              Attachments
            </button>
            <button
              onClick={onSignature}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded transition-colors"
            >
              <PenLine className="h-3.5 w-3.5 shrink-0" />
              Signature
            </button>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded transition-colors"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              Sign out
            </button>
            <p className="text-[10px] text-neutral-400 truncate px-2 pt-0.5">
              {session.user?.email}
            </p>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="Delete campaign?"
        description="This will permanently delete this campaign and all its emails."
        onConfirm={() => { if (confirmDeleteId) onDelete(confirmDeleteId); }}
      />

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="absolute -right-3 top-5 z-10 flex items-center justify-center w-6 h-6 bg-white border border-neutral-200 rounded-full hover:bg-neutral-50 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-neutral-500" />
        ) : (
          <ChevronLeft className="h-3 w-3 text-neutral-500" />
        )}
      </button>
    </div>
  );
}
