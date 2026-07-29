"use client";

import { useState } from "react";
import Modal from "@/shared/components/Modal";
import ApiKeysPanel from "@/features/account/ApiKeysPanel";

// Sidebar entry point for managing the API keys that external tools (e.g. the
// 3ds Max panel) use. Opens the key manager in a modal — no page navigation.
export default function ExternalApiKeysButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-outline px-3 py-2 type-label-bold uppercase text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        External API Keys
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="External API Keys" size="medium">
        <ApiKeysPanel />
      </Modal>
    </>
  );
}
