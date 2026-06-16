"use client";

import { useState } from "react";
import CurrentSongMode from "./CurrentSongMode";
import PlaylistMode from "./PlaylistMode";
import QueueMode from "./QueueMode";

type Mode = "current-song" | "playlist" | "queue";

const TABS: { id: Mode; label: string }[] = [
  { id: "current-song", label: "Current Song" },
  { id: "playlist", label: "Playlist" },
  { id: "queue", label: "Queue" },
];

export default function ImmersiveDisplayTool({
  connected,
}: {
  connected: boolean;
}) {
  // "current-song" is the default mode when the tool opens.
  const [mode, setMode] = useState<Mode>("current-song");

  return (
    <div className="space-y-5">
      {/* Mode switcher */}
      <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === tab.id
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Modes stay mounted (hidden when inactive) so switching tabs doesn't
          lose an uploaded template or preview. */}
      <div className={mode === "current-song" ? "" : "hidden"}>
        <CurrentSongMode connected={connected} />
      </div>
      <div className={mode === "playlist" ? "" : "hidden"}>
        <PlaylistMode />
      </div>
      <div className={mode === "queue" ? "" : "hidden"}>
        <QueueMode />
      </div>
    </div>
  );
}
