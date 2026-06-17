import ModeWorkspace, { type PendingTemplate } from "./ModeWorkspace";

export default function PlaylistMode({
  connected,
  pendingTemplate,
}: {
  connected: boolean;
  pendingTemplate?: PendingTemplate | null;
}) {
  return (
    <ModeWorkspace
      connected={connected}
      mode="playlist"
      pendingTemplate={pendingTemplate}
    />
  );
}
