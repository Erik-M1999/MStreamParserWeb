import ModeWorkspace, { type PendingTemplate } from "./ModeWorkspace";

export default function QueueMode({
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
      mode="queue"
      pendingTemplate={pendingTemplate}
    />
  );
}
