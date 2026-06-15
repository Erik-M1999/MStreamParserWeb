import Link from "next/link";
import { BACKEND_URL } from "@/config";
import type { ApiConnection } from "@/types";
import ImmersiveDisplayTool from "@/components/ImmersiveDisplayTool";

async function getConnections(): Promise<ApiConnection[]> {
  const res = await fetch(`${BACKEND_URL}/api/connections`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
  return res.json();
}

// Server Component: we resolve the Spotify connection state on the server, then
// hand the interactive part off to a Client Component.
export default async function ImmersiveDisplayPage() {
  const connections = await getConnections();
  const connected = connections.some((c) => c.id === "spotify" && c.connected);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Dashboard
        </Link>
        <span className="font-semibold tracking-tight">Immersive Music Display</span>
      </header>

      <main className="flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold">Current song template</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Upload an SVG template containing <code>artist</code>, <code>title</code>{" "}
          and <code>cover</code> slots. We fill it with whatever you&apos;re playing
          on Spotify right now and show a live preview.
        </p>

        <div className="mt-8">
          <ImmersiveDisplayTool connected={connected} />
        </div>
      </main>
    </div>
  );
}
