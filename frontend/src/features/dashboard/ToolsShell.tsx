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
  const [infoOpen, setInfoOpen] = useState(false);
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
        size="default"
        headerExtra={
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="How SVG Texture Labs works"
            title="How it works"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-outline-variant text-sm italic text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            i
          </button>
        }
      >
        <ImmersiveDisplayTool
          spotifyConnected={spotifyConnected}
          lastfmConnected={lastfmConnected}
          loggedIn={loggedIn}
        />
      </Modal>

      {/* How-it-works dialog for SVG Texture Labs (opened from the "i" button). */}
      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="How SVG Texture Labs works"
        size="small"
      >
        <div className="space-y-4 type-body-md text-on-surface-variant">
          <p>
            SVG Texture Labs fills a vector template with whatever you&apos;re
            listening to or your recent in case live is off, so you can drop live track art straight into your
            renders, streams or games.
          </p>
          <ol className="list-decimal space-y-2 pl-5 marker:text-on-surface-variant">
            <li>
              <span className="text-on-surface">Connect an API of your choice</span>
            </li>
            <li>
              <span className="text-on-surface">Pick a mode:</span> Current
              Song, Playlist or Queue. What's available depends on the API.
            </li>
            <li>
              <span className="text-on-surface">Choose a template:</span> load
              one from the <span className="text-on-surface">Demo Templates</span>{" "}
              folder to try it out, or drop in your own SVG. Templates mark the
              layers to fill by tagging them (a text layer id like{" "}
              <code className="text-on-surface">title</code> or{" "}
              <code className="text-on-surface">artist</code>, and a rectangle
              tagged <code className="text-on-surface">cover</code>).
            </li>
            <li>
              <span className="text-on-surface">Detected invalid template?:</span> You
              might be able to recover with {" "}
              <code className="text-on-surface">Edit tags</code> tool. It allows you to reassign tags
              to your SVG elements.
            </li>
            <li>
              <span className="text-on-surface">Preview:</span> it fills
              automatically with your current data. 
              <br />
              If the tool detects long names, you'll be able to
              randomize it with {" "}
              <code className="text-on-surface">Handle long text</code> option. 
              (Only applies to Current Song mode)
            </li>
            <li>
              <span className="text-on-surface">Export:</span> download as SVG
              or PNG at the resolution you choose or fetch the rendered image
              from your own software with an API key (see Account → API keys).
            </li>
            <li>
              <span className="text-on-surface">Optionally save your template:</span> Drag and Drop your imported File
              into the Library and give it a name. Saved templates and shows in external APIs for the softwares
              to choose and fetch a generated texture from. The tool automtically detects the suitable mode and assign a tag.
              <br />
              Manage your library by copying, moving, deleting or renaming templates and folders.
              <br />
              Features a right-click menu.
            </li>
          </ol>
        </div>
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
