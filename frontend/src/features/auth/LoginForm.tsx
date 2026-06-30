"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BACKEND_URL } from "@/shared/config";

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
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Welcome back to MStreamParserWeb.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-neutral-400">Username</span>
          <input
            type="text"
            required
            autoComplete="username"
            data-cy="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>

        <label className="block">
          <span className="text-sm text-neutral-400">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            data-cy="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>

        {error && (
          <p
            data-cy="login-error"
            className="rounded-md border border-red-900/60 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          data-cy="login-submit"
          className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-neutral-400">
        No account?{" "}
        <Link href="/register" className="text-green-400 hover:underline">
          Register
        </Link>
      </p>
      <Link href="/" className="mt-2 text-xs text-neutral-500 hover:text-neutral-300">
        ← Back to dashboard
      </Link>
    </main>
  );
}
