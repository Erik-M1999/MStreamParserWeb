"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getMe, logout, type Me } from "@/features/auth/auth.api";

// Sidebar account block: shows the logged-in user + logout, or Log in / Register
// prompts. Sharp corners, light surface, red primary accent (see DESIGN.md).
export default function AuthStatus() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getMe().then((m) => {
      setMe(m);
      setLoaded(true);
    });
  }, []);

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
      <div className="border border-outline-variant bg-surface-container-lowest px-3 py-2">
        <span className="block type-label-sm text-on-surface-variant">Account</span>
        <span
          data-cy="user-name"
          className="block truncate type-label-bold text-on-surface"
        >
          {me.username}
        </span>
      </div>
      <button
        type="button"
        data-cy="logout-btn"
        onClick={async () => {
          await logout();
          setMe(null);
          router.refresh();
        }}
        className="border border-outline px-3 py-2 type-label-bold uppercase text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        Log out
      </button>
    </div>
  );
}
