"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/shared/components/Modal";
import { getMe, logout, deleteAccount, type Me } from "@/features/auth/auth.api";

// Sidebar account block: shows the logged-in user + logout (or Log in / Register
// prompts). Clicking the account opens a small floating panel (like the API
// status popover) with a Delete Account action, which then asks for the password.
export default function AuthStatus() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Floating "account menu" (the Delete Account affordance), positioned above
  // the account block and measured from it — fixed, so nothing clips it.
  const accountRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  useEffect(() => {
    getMe().then((m) => {
      setMe(m);
      setLoaded(true);
    });
  }, []);

  // Close the account menu on any outside click or Escape.
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuPos(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuPos]);

  function toggleMenu() {
    if (menuPos) {
      setMenuPos(null);
      return;
    }
    const r = accountRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.top - 8, left: r.left });
  }

  function closeDelete() {
    setDeleteOpen(false);
    setPw("");
    setDelError(null);
  }

  async function confirmDelete() {
    if (!pw || deleting) return;
    setDeleting(true);
    setDelError(null);
    try {
      await deleteAccount(pw);
      // Account + cookie are gone — hard reload for a clean logged-out state.
      window.location.href = "/";
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "Could not delete the account.");
      setDeleting(false);
    }
  }

  if (!loaded) return <div className="h-16" aria-hidden />;

  if (!me) {
    return (
      <div className="flex flex-col gap-2">
        <Link
          href="/login"
          className="bg-primary px-3 py-2 text-center type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="border border-outline px-3 py-2 text-center type-label-bold uppercase text-on-surface transition-colors hover:border-on-surface"
        >
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Account block — click to open the account menu (Delete Account). */}
      <button
        ref={accountRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu();
        }}
        className="block w-full border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left transition-colors hover:border-primary"
      >
        <span className="block type-label-sm text-on-surface-variant">Account</span>
        <span
          data-cy="user-name"
          className="block truncate type-label-bold text-on-surface"
        >
          {me.username}
        </span>
      </button>

      {menuPos && (
        <div
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[60] w-56 -translate-y-full border border-outline bg-surface-container-high p-2"
        >
          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              setDeleteOpen(true);
            }}
            className="w-full border border-error px-2 py-1.5 type-label-sm uppercase text-error transition-colors hover:bg-error-container hover:text-on-error-container"
          >
            Delete Account
          </button>
        </div>
      )}

      <button
        type="button"
        data-cy="logout-btn"
        onClick={async () => {
          await logout();
          window.location.href = "/";
        }}
        className="border border-outline px-3 py-2 type-label-bold uppercase text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        Log out
      </button>

      <Modal open={deleteOpen} onClose={closeDelete} title="Delete account" size="small">
        <div className="space-y-4">
          <p className="text-sm text-on-surface">
            This permanently deletes your account and everything in it — templates,
            folders, connected APIs and API keys. This can&apos;t be undone.
          </p>
          <label className="block text-sm">
            <span className="text-on-surface-variant">Confirm your password</span>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
              className="mt-1 w-full border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          {delError && (
            <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
              {delError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDelete}
              className="border border-outline px-3 py-1.5 text-sm hover:border-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting || !pw}
              className="bg-error-container px-3 py-1.5 type-label-bold uppercase text-on-error-container transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
