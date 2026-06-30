"use client";

import { useState } from "react";
import ToolCard from "@/components/ToolCard";
import Modal from "@/components/Modal";
import ImmersiveDisplayTool from "@/components/imd/ImmersiveDisplayTool";
import type { Tool } from "@/types";

// Renders the tool grid and opens functional tools in a floating modal, so the
// dashboard (and its top bar) stays in place. For now only "immersive-display"
// has a modal; we map more tool ids to their modals here as we build them.
export default function ToolsSection({
  tools,
  spotifyConnected,
  loggedIn,
}: {
  tools: Tool[];
  spotifyConnected: boolean;
  loggedIn: boolean;
}) {
  const [openToolId, setOpenToolId] = useState<string | null>(null);

  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            onOpen={
              tool.status === "available"
                ? () => setOpenToolId(tool.id)
                : undefined
            }
          />
        ))}
      </div>

      <Modal
        open={openToolId === "immersive-display"}
        onClose={() => setOpenToolId(null)}
        title="Immersive Music Display"
      >
        <ImmersiveDisplayTool connected={spotifyConnected} loggedIn={loggedIn} />
      </Modal>
    </>
  );
}
