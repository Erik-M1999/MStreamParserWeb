"use client";

import { useState, type ReactNode } from "react";
import ToolCard from "@/features/dashboard/ToolCard";
import Modal from "@/shared/components/Modal";
import ImmersiveDisplayTool from "@/features/imd/ImmersiveDisplayTool";
import PlaylistExtractorTool from "@/features/playlist/PlaylistExtractorTool";
import type { Tool } from "@/shared/types";

// Display priority: SVG Texture Labs is the flagship feature, so it always
// leads (leftmost card / first button) regardless of the order the backend
// returns. Anything not listed keeps its incoming order, after these.
const TOOL_PRIORITY = ["immersive-display", "playlist-parser"];

function byPriority(a: Tool, b: Tool): number {
  const rank = (id: string) => {
    const i = TOOL_PRIORITY.indexOf(id);
    return i === -1 ? TOOL_PRIORITY.length : i;
  };
  return rank(a.id) - rank(b.id);
}

// Owns which tool is open, so the top bar (quick access for repeat users) and
// the cards at the bottom of the page can both launch the same modals. The
// page content in between is passed through as children.
export default function ToolsShell({
  tools,
  spotifyConnected,
  lastfmConnected,
  loggedIn,
  children,
}: {
  tools: Tool[];
  spotifyConnected: boolean;
  lastfmConnected: boolean;
  loggedIn: boolean;
  children: ReactNode;
}) {
  const [openToolId, setOpenToolId] = useState<string | null>(null);
  const isAvailable = (t: Tool) => t.status === "available";
  const orderedTools = [...tools].sort(byPriority);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Top bar — jump straight into a tool from anywhere on the page. */}
      <header className="border-b border-outline bg-surface-container-low px-8 py-4">
        <nav className="flex flex-wrap items-center justify-center gap-8">
          {orderedTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={!isAvailable(tool)}
              onClick={() => setOpenToolId(tool.id)}
              data-cy={`toolbar-${tool.id}`}
              title={isAvailable(tool) ? `Open ${tool.name}` : "Coming soon"}
              className="bg-primary px-6 py-2.5 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tool.name}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        {children}

        {/* The same tools again as full cards, for users arriving fresh. */}
        <section className="border-t border-outline-variant bg-surface-container-low px-8 pb-28 pt-24">
          <div className="mx-auto max-w-5xl text-center">
            <h2 className="type-headline-lg text-on-surface">Get your first texture or convert your playlist</h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2">
              {orderedTools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  onOpen={
                    isAvailable(tool) ? () => setOpenToolId(tool.id) : undefined
                  }
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Modal
        open={openToolId === "immersive-display"}
        onClose={() => setOpenToolId(null)}
        title="SVG Texture Labs"
      >
        <ImmersiveDisplayTool
          spotifyConnected={spotifyConnected}
          lastfmConnected={lastfmConnected}
          loggedIn={loggedIn}
        />
      </Modal>

      <Modal
        open={openToolId === "playlist-parser"}
        onClose={() => setOpenToolId(null)}
        title="Playlist Extractor"
        size="wide"
      >
        <PlaylistExtractorTool connected={spotifyConnected} loggedIn={loggedIn} />
      </Modal>
    </div>
  );
}
