"use client";

import { useState } from "react";
import ToolCard from "@/features/dashboard/ToolCard";
import Modal from "@/shared/components/Modal";
import ImmersiveDisplayTool from "@/features/imd/ImmersiveDisplayTool";
import PlaylistExtractorTool from "@/features/playlist/PlaylistExtractorTool";
import type { Tool } from "@/shared/types";

// Renders the tool grid and opens functional tools in a floating modal, so the
// dashboard (and its sidebar) stays in place. Each functional tool id maps to
// its own modal below; add more entries as we build them.
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
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
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
        title="SVG Texture Labs"
      >
        <ImmersiveDisplayTool connected={spotifyConnected} loggedIn={loggedIn} />
      </Modal>

      <Modal
        open={openToolId === "playlist-parser"}
        onClose={() => setOpenToolId(null)}
        title="Playlist Extractor"
      >
        <PlaylistExtractorTool connected={spotifyConnected} loggedIn={loggedIn} />
      </Modal>
    </>
  );
}
