// Desktop-only gate. This app is a companion to desktop software (render
// pipelines, 3ds Max, playlist export into other tools), so it isn't built for
// phones. Below the `md` breakpoint we cover the whole app with this notice;
// at `md`+ it's hidden and the app shows. Pure CSS — no JS, no hydration flicker.
export default function DesktopOnlyGate() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-surface px-8 text-center md:hidden">
      <div>
        <span className="block type-headline-md text-on-surface">Music Streaming</span>
        <span className="block type-label-sm text-primary">Tools</span>
      </div>

      <h1 className="type-headline-lg text-on-surface">Built for desktop</h1>

      <p className="max-w-sm type-body-md text-on-surface-variant">
        This is a companion for desktop softwares. It turns what you&apos;re
        listening to into render or game textures for tools like 3ds Max and Blender.
        Please open it on a Desktop to use it.
      </p>
    </div>
  );
}
