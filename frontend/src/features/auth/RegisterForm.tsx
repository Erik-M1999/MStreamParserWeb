"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BACKEND_URL } from "@/shared/config";

const inputClasses =
  "mt-1 w-full border border-outline bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary";

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
        <h1 className="type-headline-lg text-primary">Account created</h1>
        <p className="mt-2 type-body-lg text-on-surface-variant">
          You can now log in with your username and password.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block bg-primary px-4 py-2 text-center type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container"
        >
          Go to log in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="type-headline-lg text-on-surface">Create an account</h1>
      <p className="mt-2 type-body-lg text-on-surface-variant">
        Save templates and connect APIs across sessions.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="type-label-sm text-on-surface-variant">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClasses}
          />
        </label>

        <label className="block">
          <span className="type-label-sm text-on-surface-variant">Username</span>
          <input
            type="text"
            required
            autoComplete="username"
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClasses}
          />
          <span className="mt-1 block type-label-sm text-on-surface-variant">
            At least 8 characters.
          </span>
        </label>

        {error && (
          <p className="border border-error bg-error-container px-3 py-2 text-sm text-on-error-container">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary px-4 py-2 type-label-bold uppercase text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Creating…" : "Register"}
        </button>
      </form>

      <p className="mt-8 text-sm text-on-surface-variant">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Log in
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
