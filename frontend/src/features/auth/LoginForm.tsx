"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BACKEND_URL } from "@/shared/config";

const inputClasses =
  "mt-1 w-full border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // receive the HttpOnly JWT cookie
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // Backend keeps this message identical for wrong user vs wrong password.
        setError(data.error ?? "Username or password is invalid.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="type-headline-lg text-on-surface">Log in</h1>
      <p className="mt-2 type-body-lg text-on-surface-variant">
        Welcome back to Music Streaming Tools.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="type-label-sm text-on-surface-variant">Username</span>
          <input
            type="text"
            required
            autoComplete="username"
            data-cy="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClasses}
          />
        </label>

        <label className="block">
          <span className="type-label-sm text-on-surface-variant">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            data-cy="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClasses}
          />
        </label>

        {error && (
          <p
            data-cy="login-error"
            className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          data-cy="login-submit"
          className="w-full bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-8 text-sm text-on-surface-variant">
        No account?{" "}
        <Link href="/register" className="text-primary hover:underline">
          Register
        </Link>
      </p>
      <Link
        href="/"
        className="mt-2 type-label-sm text-on-surface-variant hover:text-on-surface"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
