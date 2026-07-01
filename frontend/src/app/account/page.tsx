import Link from "next/link";
import ApiKeysPanel from "@/features/account/ApiKeysPanel";

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-8 py-12">
      <Link
        href="/"
        className="type-label-sm text-on-surface-variant hover:text-on-surface"
      >
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 type-headline-lg text-on-surface">Account</h1>
      <h2 className="mt-8 mb-4 type-label-sm text-on-surface-variant">API keys</h2>
      <ApiKeysPanel />
    </main>
  );
}
