"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BACKEND_URL } from "@/config";

interface NowPlaying {
  playing: boolean;
  artist?: string;
  title?: string;
  album?: string;
}

export default function ImmersiveDisplayTool({
  connected,
}: {
  connected: boolean;
}) {
  const [templateSvg, setTemplateSvg] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  // Object URLs must be revoked to avoid leaks; track the current one.
  const previewUrlRef = useRef<string | null>(null);

  function setPreview(url: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function fetchNowPlaying() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/spotify/now-playing`);
      if (res.ok) setNowPlaying((await res.json()) as NowPlaying);
    } catch {
      /* non-critical */
    }
  }

  useEffect(() => {
    if (connected) fetchNowPlaying();
  }, [connected]);

  async function render(svg: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/immersive/render`, {
        method: "POST",
        headers: { "Content-Type": "image/svg+xml" },
        body: svg,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Render failed (${res.status}).`);
        setPreview(null);
        return;
      }
      const filled = await res.text();
      const blob = new Blob([filled], { type: "image/svg+xml" });
      setPreview(URL.createObjectURL(blob));
      void fetchNowPlaying();
    } catch {
      setError("Could not reach the backend. Is it running on port 3000?");
    } finally {
      setLoading(false);
    }
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setTemplateSvg(text);
    setTemplateName(file.name);
    await render(text);
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6">
        <p className="text-sm text-neutral-300">
          Connect your Spotify account to use this tool.
        </p>
        <a
          href={`${BACKEND_URL}/api/auth/spotify/login`}
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Connect Spotify
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-neutral-400">
        {nowPlaying?.playing ? (
          <>
            Now playing:{" "}
            <span className="text-neutral-100">
              {nowPlaying.artist} — {nowPlaying.title}
            </span>
          </>
        ) : (
          "Nothing is playing on Spotify right now."
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-block cursor-pointer rounded-md border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">
          {templateName ? `Template: ${templateName}` : "Upload SVG template"}
          <input
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={onFileChange}
          />
        </label>
        <button
          type="button"
          disabled={!templateSvg || loading}
          onClick={() => templateSvg && render(templateSvg)}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Rendering…" : "Re-render with current song"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {previewUrl && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="mb-3 text-xs uppercase tracking-wider text-neutral-500">
            Preview
          </p>
          {/* Rendered as <img> (not inline) so an uploaded SVG can't run scripts. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Rendered template preview"
            className="mx-auto max-h-[28rem] w-auto"
          />
        </div>
      )}
    </div>
  );
}
