"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getMe, logout, type Me } from "@/features/auth/auth.api";

// Top-bar auth widget: shows the logged-in user + logout, or a Log in link.
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

  if (!loaded) return <span className="ml-2 h-6 w-16" aria-hidden />;

  if (!me) {
    return (
      <Link
        href="/login"
        className="ml-2 rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-200 transition-colors hover:border-neutral-500"
      >
        Log in
      </Link>
    );
  }

  return (
    <span className="ml-2 flex items-center gap-2 text-sm">
      <Link
        href="/account"
        data-cy="user-name"
        className="text-neutral-300 hover:text-neutral-100 hover:underline"
        title="Account & API keys"
      >
        {me.username}
      </Link>
      <button
        type="button"
        data-cy="logout-btn"
        onClick={async () => {
          await logout();
          setMe(null);
          router.refresh();
        }}
        className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
      >
        Log out
      </button>
    </span>
  );
}
