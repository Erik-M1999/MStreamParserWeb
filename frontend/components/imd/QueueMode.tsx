import ModeWorkspace, { type PendingTemplate } from "./ModeWorkspace";

export default function QueueMode({
  connected,
  pendingTemplate,
}: {
  connected: boolean;
  pendingTemplate?: PendingTemplate | null;
}) {
  return (
    <ModeWorkspace
      connected={connected}
      mode="queue"
      pendingTemplate={pendingTemplate}
    />
  );
}
