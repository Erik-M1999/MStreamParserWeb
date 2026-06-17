// Shared drag-and-drop payload for moving templates between the workspace
// (drop zone) and the Library. Carried on the DataTransfer under this mime.

export const IMD_DND_MIME = "application/x-imd-template";

export interface ImdDragPayload {
  name: string;
  modes: string[];
  /** Inline SVG (workspace file or a user template). */
  svg?: string;
  /** Backend template id to fetch (read-only _debug templates). */
  backendId?: string;
  /** Set when dragging an existing Library item, to MOVE it (not copy/save). */
  source?: { type: "template"; id: string } | { type: "folder"; path: string };
}
