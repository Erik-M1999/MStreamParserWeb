import ModeWorkspace, { type PendingTemplate } from "./ModeWorkspace";

export default function PlaylistMode({
  connected,
  loggedIn,
  pendingTemplate,
}: {
  connected: boolean;
  loggedIn: boolean;
  pendingTemplate?: PendingTemplate | null;
}) {
  return (
    <ModeWorkspace
      connected={connected}
      loggedIn={loggedIn}
      mode="playlist"
      pendingTemplate={pendingTemplate}
    />
  );
}
