"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Batch, ContactRow } from "@/lib/batches";
import type { CustomVariable } from "@/lib/variables";

const FLUSH_DELAY_MS = 500;

interface PendingFlush {
  // Non-contact fields go through PATCH /api/batches/:id.
  patch: Record<string, unknown>;
  // Contact array goes through PUT /api/batches/:id/contacts.
  contacts?: ContactRow[];
  timer: ReturnType<typeof setTimeout> | null;
}

type BatchPatchInput = Partial<Batch>;

/**
 * Keys the server PATCH route accepts. status, sentAt, recipientResults,
 * scheduledAt and scheduledJobId are deliberately excluded — they're written
 * by the server endpoints that prove the underlying Gmail / scheduler action
 * actually happened. We still keep them in local React state for snappy UI;
 * we just don't ship them over the wire.
 */
const WIRE_PATCH_KEYS: (keyof Batch)[] = ["name", "subject", "body", "scheduledDelay"];

function patchToWire(patch: BatchPatchInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WIRE_PATCH_KEYS) {
    if (k in patch) out[k] = patch[k] ?? null;
  }
  return out;
}

export function useBatches() {
  const { status: sessionStatus } = useSession();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [signature, setSignatureState] = useState<string>("");
  const [variables, setVariables] = useState<CustomVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");

  const pendingRef = useRef<Map<string, PendingFlush>>(new Map());
  const sigTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: pull the whole tree from the server ─────────────────────
  // Wait until next-auth has resolved the session before hitting /api/sync,
  // otherwise the request fires unauthenticated and 401s.
  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      if (sessionStatus === "unauthenticated") setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sync");
        if (!res.ok) throw new Error(`sync failed: ${res.status}`);
        const data = (await res.json()) as {
          signature: string;
          batches: Batch[];
          variables: CustomVariable[];
        };
        if (cancelled) return;
        setSignatureState(data.signature ?? "");
        setVariables(data.variables ?? []);

        // Bootstrap: first-ever user has zero batches. Create one campaign so
        // the canvas isn't empty.
        if (!data.batches?.length) {
          const created = await fetch("/api/campaigns", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Campaign 1" }),
          });
          if (!created.ok) throw new Error(`bootstrap failed: ${created.status}`);
          const { batch } = (await created.json()) as { batch: Batch };
          if (cancelled) return;
          setBatches([batch]);
        } else {
          setBatches(data.batches);
        }
      } catch (err) {
        console.error("Failed to load sync state:", err);
        toast.error("Failed to load your campaigns. Refresh to retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionStatus]);

  // ── Per-batch debounced flush ─────────────────────────────────────────────
  const flush = useCallback(async (id: string) => {
    const entry = pendingRef.current.get(id);
    if (!entry) return;
    pendingRef.current.delete(id);
    if (entry.timer) clearTimeout(entry.timer);

    const reqs: Promise<Response>[] = [];
    if (Object.keys(entry.patch).length > 0) {
      reqs.push(
        fetch(`/api/batches/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.patch),
        })
      );
    }
    if (entry.contacts !== undefined) {
      reqs.push(
        fetch(`/api/batches/${id}/contacts`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacts: entry.contacts }),
        })
      );
    }
    try {
      const results = await Promise.all(reqs);
      for (const r of results) {
        if (!r.ok) {
          const msg = await r.json().catch(() => ({ error: r.statusText }));
          throw new Error(msg.error || `HTTP ${r.status}`);
        }
      }
    } catch (err) {
      console.error("Failed to persist batch update:", err);
      toast.error("Failed to save changes. Refresh to recover.");
    }
  }, []);

  const scheduleFlush = useCallback((id: string) => {
    const entry = pendingRef.current.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(id), FLUSH_DELAY_MS);
  }, [flush]);

  // Flush everything in flight on tab hide / navigation away.
  useEffect(() => {
    function flushAll() {
      const ids = Array.from(pendingRef.current.keys());
      ids.forEach((id) => flush(id));
    }
    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll();
    });
    return () => {
      window.removeEventListener("beforeunload", flushAll);
    };
  }, [flush]);

  // ── Mutations: optimistic local update + queue server flush ──────────────
  const updateBatch = useCallback(
    (id: string, patch: BatchPatchInput) => {
      setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

      const entry = pendingRef.current.get(id) ?? { patch: {}, timer: null };
      if (patch.contacts !== undefined) {
        entry.contacts = patch.contacts;
      }
      // Strip contacts from the PATCH payload — they go on their own endpoint.
      const { contacts: _drop, ...rest } = patch;
      void _drop;
      const wire = patchToWire(rest);
      entry.patch = { ...entry.patch, ...wire };
      pendingRef.current.set(id, entry);
      scheduleFlush(id);
    },
    [scheduleFlush]
  );

  const createVariable = useCallback(async (name: string): Promise<CustomVariable | null> => {
    try {
      const res = await fetch("/api/variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const variable = data.variable as CustomVariable;
      setVariables((prev) => [...prev, variable]);
      return variable;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create variable");
      return null;
    }
  }, []);

  const setVariableEnabled = useCallback(async (id: string, enabled: boolean) => {
    setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, enabled } : v)));
    try {
      const res = await fetch(`/api/variables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update variable");
      setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, enabled: !enabled } : v)));
    }
  }, []);

  const renameVariable = useCallback(async (id: string, newName: string): Promise<boolean> => {
    const previous = variables.find((v) => v.id === id);
    if (!previous) return false;
    try {
      const res = await fetch(`/api/variables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const updated = data.variable as CustomVariable;
      // Mirror the server-side rewrite onto local templates + contacts so the
      // UI doesn't drift until the next sync.
      setVariables((prev) => prev.map((v) => (v.id === id ? updated : v)));
      const escaped = previous.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tokenRe = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g");
      const renameKey = (fields: Record<string, string>) => {
        if (!Object.prototype.hasOwnProperty.call(fields, previous.name)) return fields;
        const next = { ...fields, [updated.name]: fields[previous.name] };
        delete next[previous.name];
        return next;
      };
      setBatches((prev) =>
        prev.map((b) => ({
          ...b,
          subject: b.subject.replace(tokenRe, `{{${updated.name}}}`),
          body: b.body.replace(tokenRe, `{{${updated.name}}}`),
          contacts: b.contacts.map((c) => ({ ...c, customFields: renameKey(c.customFields ?? {}) })),
        }))
      );
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename variable");
      return false;
    }
  }, [variables]);

  const deleteVariable = useCallback(async (id: string) => {
    const previous = variables.find((v) => v.id === id);
    setVariables((prev) => prev.filter((v) => v.id !== id));
    try {
      const res = await fetch(`/api/variables/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Drop the now-orphaned key from local contacts to keep state clean.
      if (previous) {
        setBatches((prev) =>
          prev.map((b) => ({
            ...b,
            contacts: b.contacts.map((c) => {
              if (!c.customFields || !(previous.name in c.customFields)) return c;
              const next = { ...c.customFields };
              delete next[previous.name];
              return { ...c, customFields: next };
            }),
          }))
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete variable");
      if (previous) setVariables((prev) => [...prev, previous].sort((a, b) => a.position - b.position));
    }
  }, [variables]);

  const updateSignature = useCallback((next: string) => {
    setSignatureState(next);
    if (sigTimerRef.current) clearTimeout(sigTimerRef.current);
    sigTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/signature", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error("Failed to save signature:", err);
        toast.error("Failed to save signature.");
      }
    }, FLUSH_DELAY_MS);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const campaigns = batches.filter((b) => !b.parentBatchId);
  const activeCampaignId =
    (selectedCampaignId && batches.find((b) => b.id === selectedCampaignId)?.id) ??
    (batches.find((b) => !b.parentBatchId)?.id ?? batches[0]?.id ?? "");
  const activeCampaign = batches.find((b) => b.id === activeCampaignId);

  const getCampaignChain = useCallback(
    (rootId: string): Batch[] => {
      const chain: Batch[] = [];
      const visited = new Set<string>();
      let currentId: string | undefined = rootId;
      while (currentId) {
        if (visited.has(currentId)) break;
        visited.add(currentId);
        const node = batches.find((b) => b.id === currentId);
        if (!node) break;
        chain.push(node);
        currentId = batches.find((b) => b.parentBatchId === currentId)?.id;
      }
      return chain;
    },
    [batches]
  );

  // ── Tree mutations: server-first so we have authoritative ids ────────────
  async function handleNewCampaign(): Promise<string> {
    const existingNames = new Set(batches.map((b) => b.name));
    let num = campaigns.length + 1;
    while (existingNames.has(`Campaign ${num}`)) num++;
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Campaign ${num}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { batch } = (await res.json()) as { batch: Batch };
      setBatches((prev) => [...prev, batch]);
      setSelectedCampaignId(batch.id);
      return batch.id;
    } catch (err) {
      console.error("Failed to create campaign:", err);
      toast.error("Failed to create campaign.");
      return "";
    }
  }

  function handleRenameCampaign(id: string, name: string) {
    updateBatch(id, { name });
  }

  async function handleDeleteCampaign(id: string) {
    if (campaigns.length === 1) return;
    const toDelete = collectDescendants(id);
    const remaining = batches.filter((b) => !toDelete.has(b.id));
    setBatches(remaining);
    if (id === activeCampaignId) {
      const next = remaining.find((b) => !b.parentBatchId);
      setSelectedCampaignId(next?.id ?? "");
    }
    try {
      const res = await fetch(`/api/batches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("Failed to delete campaign:", err);
      toast.error("Failed to delete. Refresh to recover.");
    }
  }

  async function handleDuplicateCampaign(id: string): Promise<string> {
    const toDuplicate = collectDescendants(id);
    try {
      await Promise.all(Array.from(toDuplicate).map((batchId) => flush(batchId)));
      const res = await fetch(`/api/batches/${id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const { batches: copied } = (await res.json()) as { batches: Batch[] };
      const copiedRoot = copied.find((b) => !b.parentBatchId);
      if (!copiedRoot) throw new Error("Duplicated campaign did not include a root batch");
      setBatches((prev) => [...prev, ...copied]);
      setSelectedCampaignId(copiedRoot.id);
      toast.success("Campaign duplicated.");
      return copiedRoot.id;
    } catch (err) {
      console.error("Failed to duplicate campaign:", err);
      toast.error("Failed to duplicate campaign.");
      return "";
    }
  }

  async function handleAddFollowUp(parentId: string): Promise<string> {
    const parent = batches.find((b) => b.id === parentId);
    if (!parent) return "";
    try {
      const res = await fetch(`/api/batches/${parentId}/follow-up`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { batch } = (await res.json()) as { batch: Batch };
      setBatches((prev) => [...prev, batch]);
      return batch.id;
    } catch (err) {
      console.error("Failed to add follow-up:", err);
      toast.error("Failed to add follow-up.");
      return "";
    }
  }

  async function handleDeleteNode(id: string) {
    const node = batches.find((b) => b.id === id);
    if (!node) return;
    const isRoot = !node.parentBatchId;
    if (isRoot && campaigns.length === 1) return;
    const toDelete = collectDescendants(id);
    const remaining = batches.filter((b) => !toDelete.has(b.id));
    setBatches(remaining);
    if (toDelete.has(activeCampaignId)) {
      const next = remaining.find((b) => !b.parentBatchId);
      setSelectedCampaignId(next?.id ?? "");
    }
    try {
      const res = await fetch(`/api/batches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("Failed to delete batch:", err);
      toast.error("Failed to delete. Refresh to recover.");
    }
  }

  function collectDescendants(rootId: string): Set<string> {
    const ids = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      ids.add(id);
      batches.filter((b) => b.parentBatchId === id).forEach((b) => queue.push(b.id));
    }
    return ids;
  }

  return {
    batches,
    campaigns,
    activeCampaign,
    activeCampaignId,
    setActiveCampaignId: setSelectedCampaignId,
    getCampaignChain,
    updateBatch,
    handleNewCampaign,
    handleRenameCampaign,
    handleDeleteCampaign,
    handleDuplicateCampaign,
    handleAddFollowUp,
    handleDeleteNode,
    signature,
    updateSignature,
    variables,
    createVariable,
    renameVariable,
    setVariableEnabled,
    deleteVariable,
    loading,
  };
}
