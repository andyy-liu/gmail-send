"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { Batch, createBatch, migrateLegacyData } from "@/lib/batches";

export function useBatches() {
  const [batches, setBatches] = useLocalStorage<Batch[]>("gmailsend_batches", []);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");

  useEffect(() => {
    if (batches.length === 0) {
      const migrated = migrateLegacyData();
      const initial = migrated ?? [createBatch("Campaign 1")];
      setBatches(initial);
    } else {
      if (batches.some((b) => b.contacts.some((c) => !c.id))) {
        setBatches((prev) =>
          prev.map((b) => ({
            ...b,
            contacts: b.contacts.map((c) => (c.id ? c : { ...c, id: crypto.randomUUID() })),
          }))
        );
      }
    }
  }, [batches, setBatches]);

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

  function updateBatch(id: string, patch: Partial<Batch>) {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function handleNewCampaign(): string {
    const existingNames = new Set(batches.map((b) => b.name));
    let num = campaigns.length + 1;
    while (existingNames.has(`Campaign ${num}`)) num++;
    const batch = createBatch(`Campaign ${num}`);
    setBatches((prev) => [...prev, batch]);
    setSelectedCampaignId(batch.id);
    return batch.id;
  }

  function handleRenameCampaign(id: string, name: string) {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
  }

  function handleDeleteCampaign(id: string) {
    if (campaigns.length === 1) return;
    const toDelete = collectDescendants(id);
    const remaining = batches.filter((b) => !toDelete.has(b.id));
    setBatches(remaining);
    if (id === activeCampaignId) {
      const next = remaining.find((b) => !b.parentBatchId);
      setSelectedCampaignId(next?.id ?? "");
    }
  }

  function handleAddFollowUp(parentId: string): string {
    const parent = batches.find((b) => b.id === parentId);
    if (!parent) return "";
    const followUp = createBatch("Follow Up", {
      parentBatchId: parentId,
      subject: parent.subject,
      body: "",
      contacts: parent.contacts.map((c) => ({ ...c })),
      scheduledDelay: { value: 3, unit: "days" },
    });
    setBatches((prev) => [...prev, followUp]);
    return followUp.id;
  }

  function handleDeleteNode(id: string) {
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
    handleAddFollowUp,
    handleDeleteNode,
  };
}
