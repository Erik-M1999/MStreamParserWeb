"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BACKEND_URL } from "@/shared/config";

export default function RegisterForm() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // 409 when the email/username is already taken.
        setError(data.error ?? "Could not create the account.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold text-green-400">Account created</h1>
        <p className="mt-2 text-sm text-neutral-400">
          You can now log in with your username and password.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-green-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-green-500"
        >
          Go to log in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Save templates and connect APIs across sessions.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-neutral-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>

        <label className="block">
          <span className="text-sm text-neutral-400">Username</span>
          <input
            type="text"
            required
            autoComplete="username"
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            At least 8 characters.
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-red-900/60 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Creating…" : "Register"}
        </button>
      </form>

      <p className="mt-6 text-sm text-neutral-400">
        Already have an account?{" "}
        <Link href="/login" className="text-green-400 hover:underline">
          Log in
        </Link>
      </p>
      <Link href="/" className="mt-2 text-xs text-neutral-500 hover:text-neutral-300">
        ← Back to dashboard
      </Link>
    </main>
  );
}
