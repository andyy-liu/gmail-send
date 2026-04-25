"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Batch } from "@/lib/batches";
import { Mail, Users, MoreHorizontal, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Layout constants ────────────────────────────────────────────────────────
const NODE_W = 260;
const SEQ_H = 44;
const EMAIL_H = 152;
const GHOST_H = 72;
const GAP = 36;

// ─── Sequence start ──────────────────────────────────────────────────────────
function SequenceStartNode() {
  return (
    <div
      className="flex items-center justify-center bg-white border border-neutral-200 rounded text-xs font-medium text-neutral-400"
      style={{ width: NODE_W, height: SEQ_H }}
    >
      Sequence start
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-neutral-300 !border-0 !rounded-full"
      />
    </div>
  );
}

// ─── Email node ──────────────────────────────────────────────────────────────
type EmailNodeData = {
  batch: Batch;
  isSelected: boolean;
  onDelete: (id: string) => void;
};

function EmailNodeComponent({ data }: NodeProps) {
  const { batch, isSelected, onDelete } = data as EmailNodeData;
  const [hovered, setHovered] = useState(false);

  const timingLabel = useMemo(() => {
    if (batch.parentBatchId) {
      const d = batch.scheduledDelay;
      return d ? `Send in ${d.value} ${d.unit}` : "Follow-up";
    }
    if (batch.scheduledAt) {
      try {
        return `Scheduled · ${new Date(batch.scheduledAt).toLocaleDateString()}`;
      } catch {
        return "Scheduled";
      }
    }
    return "Send immediately";
  }, [batch.parentBatchId, batch.scheduledDelay, batch.scheduledAt]);

  const statusLabel =
    batch.status === "sent" ? "Sent" : batch.status === "scheduled" ? "Scheduled" : "Draft";
  const statusClass =
    batch.status === "sent"
      ? "bg-green-100 text-green-700"
      : batch.status === "scheduled"
      ? "bg-amber-100 text-amber-700"
      : "bg-neutral-100 text-neutral-500";

  const bodyPreview = useMemo(
    () =>
      batch.body
        ? batch.body
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 72)
        : "",
    [batch.body]
  );

  const recipientCount = batch.contacts.filter((c) => c.email).length;

  return (
    <div
      className={`rounded border bg-white cursor-pointer transition-colors duration-150 ${
        isSelected ? "border-neutral-400 bg-neutral-100" : "border-neutral-200 hover:bg-neutral-50"
      }`}
      style={{ width: NODE_W, height: EMAIL_H }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-neutral-300 !border-0 !rounded-full"
      />

      {/* Timing bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-200 rounded-t">
        <span className="text-[11px] font-medium text-neutral-700 truncate">{timingLabel}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`p-0.5 rounded hover:bg-neutral-300 transition-opacity ${
              hovered ? "opacity-100" : "opacity-0"
            }`}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-neutral-600" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-24">
            <DropdownMenuItem
              className="text-xs text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(batch.id);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Body */}
      <div className="px-3 pt-2 pb-2 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Mail className="h-3.5 w-3.5 text-neutral-400 shrink-0 mt-px" />
            <span className="text-sm font-medium text-neutral-800 truncate">
              {batch.subject || "No subject"}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500 shrink-0">
            <Users className="h-3.5 w-3.5" />
            <span>{recipientCount}</span>
          </div>
        </div>

        {bodyPreview && (
          <p className="text-[11px] text-neutral-400 truncate pl-5">{bodyPreview}</p>
        )}

        <div className="flex justify-end pt-0.5">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-neutral-300 !border-0 !rounded-full"
      />
    </div>
  );
}

// ─── Ghost / add node ────────────────────────────────────────────────────────
type GhostNodeData = {
  parentId: string;
  onAdd: (parentId: string) => void;
};

function GhostNodeComponent({ data }: NodeProps) {
  const { parentId, onAdd } = data as GhostNodeData;
  return (
    <div
      className="flex items-center justify-center rounded border-2 border-dashed border-neutral-300 bg-transparent cursor-pointer hover:border-neutral-400 hover:bg-neutral-50 transition-colors duration-150"
      style={{ width: NODE_W, height: GHOST_H }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-neutral-300 !border-0 !rounded-full"
      />
      <Plus className="h-5 w-5 text-neutral-400" />
    </div>
  );
}

// ─── Node type registry (must be outside component) ──────────────────────────
const nodeTypes: NodeTypes = {
  sequenceStart: SequenceStartNode as unknown as NodeTypes[string],
  emailNode: EmailNodeComponent as unknown as NodeTypes[string],
  ghostNode: GhostNodeComponent as unknown as NodeTypes[string],
};

// ─── Canvas ──────────────────────────────────────────────────────────────────
interface WorkflowCanvasProps {
  chain: Batch[];
  selectedNodeId: string | null;
  onNodeClick: (id: string) => void;
  onAddFollowUp: (parentId: string) => void;
  onDeleteNode: (id: string) => void;
}

export function WorkflowCanvas({
  chain,
  selectedNodeId,
  onNodeClick,
  onAddFollowUp,
  onDeleteNode,
}: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = 0;

    nodes.push({
      id: "sequence-start",
      type: "sequenceStart",
      position: { x: 0, y },
      data: {},
      draggable: false,
      selectable: false,
    });
    y += SEQ_H + GAP;

    chain.forEach((batch, i) => {
      nodes.push({
        id: batch.id,
        type: "emailNode",
        position: { x: 0, y },
        data: {
          batch,
          isSelected: batch.id === selectedNodeId,
          onDelete: onDeleteNode,
        },
        draggable: false,
        selectable: false,
      });

      const sourceId = i === 0 ? "sequence-start" : chain[i - 1].id;
      edges.push({
        id: `e-${sourceId}-${batch.id}`,
        source: sourceId,
        target: batch.id,
        type: "straight",
        style: { stroke: "#d4d4d4", strokeWidth: 2 },
      });

      y += EMAIL_H + GAP;
    });

    const ghostParent = chain.length > 0 ? chain[chain.length - 1].id : "sequence-start";
    nodes.push({
      id: "ghost-node",
      type: "ghostNode",
      position: { x: 0, y },
      data: { parentId: ghostParent, onAdd: onAddFollowUp },
      draggable: false,
      selectable: false,
    });
    edges.push({
      id: `e-${ghostParent}-ghost`,
      source: ghostParent,
      target: "ghost-node",
      type: "straight",
      style: { stroke: "#d4d4d4", strokeWidth: 2 },
    });

    return { nodes, edges };
  }, [chain, selectedNodeId, onDeleteNode, onAddFollowUp]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.type === "emailNode") {
            onNodeClick(node.id);
          } else if (node.type === "ghostNode") {
            const d = node.data as { parentId: string; onAdd: (id: string) => void };
            d.onAdd(d.parentId);
          }
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="#e5e5e5"
        />
        <Controls
          showInteractive={false}
          className="!border !border-neutral-200 !bg-white !rounded !shadow-none [&>button]:!border-neutral-200 [&>button]:!bg-white [&>button]:hover:!bg-neutral-50"
        />
      </ReactFlow>
    </div>
  );
}
