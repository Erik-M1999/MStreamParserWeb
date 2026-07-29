// Static welcome/landing content. No interactivity -> stays a Server Component.
// Centered, long-scroll layout: each section is its own full-width band with a
// centered column inside. The tool launchers live in ToolsShell (top bar +
// cards below this content).

const USES = [
  "Generate textures for your renders or games involving music displays",
  "External API access to fetch textures upon pressing render",
  "Archiving or sharing a playlist as plain text",
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Create an account",
    body: "Register and log in. Your templates and API keys are saved to your account.",
  },
  {
    title: "Connect API of your choice.",
    body: "Be it Spotify or Last.fm. This grants read access to your playback and library.",
  },
  {
    title: "Pick a tool",
    body: "Use the top bar for quick access, or the cards at the bottom of this page.",
  },
  {
    title: "Export",
    body: "Download the outputs in a format of your choice or set up an API key to fetch them directly from your software.",
  },
];

export default function Welcome() {
  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative flex min-h-[60vh] items-center overflow-hidden border-b border-outline-variant">
        {/* Subtle diagonal texture — this is a purely technical tool, no imagery. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundColor: "var(--color-surface-container-low)",
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 16px)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-surface/85 via-surface/70 to-surface"
        />

        <div className="relative mx-auto w-full max-w-3xl px-8 py-20 text-center">
          <p className="type-label-sm text-primary">Music Streaming Tools</p>
          <h1 className="mt-5 type-display-lg text-on-surface">
            Turn what you&apos;re playing into something you can use.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl type-body-lg text-on-surface-variant">
            Connect an API of your choice, then push your live track, your queue, or an entire
            playlist straight into textures and files instead of copying track names
            by hand.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------- What it does */}
      <section className="px-8 py-24">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="type-label-sm text-on-surface-variant">What it does</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <div>
              <h3 className="type-headline-md text-on-surface">SVG Texture Labs</h3>
              <p className="mt-3 type-body-lg text-on-surface-variant">
                Upload an SVG template with tagged text layers and it fills them with
                the song you&apos;re currently playing, a playlist or your queue.
                <br />
                Save your templates in a library and manage them there.
                <br />
                Fully supports a full folder management suite.
                <br />
                Export the result as SVG or PNG with a resolution of your choice, or fetch it directly from your software via the API.
              </p>
            </div>
            <div>
              <h3 className="type-headline-md text-on-surface">Playlist Extractor</h3>
              <p className="mt-3 type-body-lg text-on-surface-variant">
                Turn any Spotify playlist into a plain text list, numbered in the playlist&apos;s own order:
                <code className="ml-1 text-on-surface">1: Artist - Song Name</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- What it's for */}
      <section className="border-t border-outline-variant bg-surface-container-low px-8 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="type-label-sm text-on-surface-variant">
            What it&apos;s useful for
          </h2>
          <ul className="mt-10 divide-y divide-outline-variant">
            {USES.map((use) => (
              <li key={use} className="py-4 type-body-lg text-on-surface">
                {use}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------- How-to */}
      <section className="border-t border-outline-variant px-8 py-24">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="type-headline-lg text-on-surface">How it works</h2>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="border border-outline-variant bg-surface-container-lowest p-6"
              >
                <span className="type-label-sm text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 type-label-bold uppercase text-on-surface">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm text-on-surface-variant">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
