"use client";

import { useSession, signIn } from "next-auth/react";
import { useState } from "react";
import { useBatches } from "@/hooks/useBatches";
import { Sidebar } from "@/components/Sidebar";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { NodeDrawer } from "@/components/NodeDrawer";
import { SignatureDialog } from "@/components/SignatureDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sigDialogOpen, setSigDialogOpen] = useState(false);

  const {
    batches,
    campaigns,
    activeCampaignId,
    setActiveCampaignId,
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
    loading: batchesLoading,
  } = useBatches();

  const selectedBatch = batches.find((b) => b.id === selectedNodeId);
  const campaignChain = activeCampaignId ? getCampaignChain(activeCampaignId) : [];

  if (status === "loading" || (status === "authenticated" && batchesLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-neutral-50">
        <Card className="w-full max-w-sm border-neutral-200 shadow-none rounded">
          <CardHeader className="text-center pb-6 pt-8">
            <CardTitle className="text-xl font-semibold tracking-tight">Gmail Send</CardTitle>
            <CardDescription className="pt-1 text-sm text-neutral-500">
              Automate personalized email sequences.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-8 px-8">
            <Button
              onClick={() => signIn("google")}
              className="w-full bg-neutral-900 text-white hover:bg-neutral-700 active:scale-[0.97] transition-transform"
              size="lg"
            >
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        campaigns={campaigns}
        activeCampaignId={activeCampaignId}
        onSelect={(id) => {
          setActiveCampaignId(id);
          setSelectedNodeId(null);
        }}
        onNew={handleNewCampaign}
        onRename={handleRenameCampaign}
        onDuplicate={async (id) => {
          const copiedId = await handleDuplicateCampaign(id);
          if (copiedId) setSelectedNodeId(null);
          return copiedId;
        }}
        onDelete={handleDeleteCampaign}
        onSignature={() => setSigDialogOpen(true)}
        session={session}
      />

      <div className="flex-1 relative overflow-hidden">
        {activeCampaignId ? (
          <WorkflowCanvas
            chain={campaignChain}
            selectedNodeId={selectedNodeId}
            onNodeClick={setSelectedNodeId}
            onAddFollowUp={async (parentId) => {
              const newId = await handleAddFollowUp(parentId);
              if (newId) setSelectedNodeId(newId);
            }}
            onDeleteNode={(id) => {
              handleDeleteNode(id);
              if (selectedNodeId === id) setSelectedNodeId(null);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-neutral-400">
            Create a campaign to get started.
          </div>
        )}
      </div>

      <NodeDrawer
        open={!!selectedNodeId && !!selectedBatch}
        batch={selectedBatch}
        batches={batches}
        signature={signature}
        onUpdate={(patch) => selectedNodeId && updateBatch(selectedNodeId, patch)}
        onClose={() => setSelectedNodeId(null)}
      />

      <SignatureDialog
        open={sigDialogOpen}
        onOpenChange={setSigDialogOpen}
        signature={signature}
        onSave={updateSignature}
      />
    </div>
  );
}
