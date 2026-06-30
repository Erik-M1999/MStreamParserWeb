import Link from "next/link";
import ApiKeysPanel from "@/features/account/ApiKeysPanel";

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Account</h1>
      <h2 className="mt-6 mb-3 text-sm font-medium text-neutral-300">API keys</h2>
      <ApiKeysPanel />
    </main>
  );
}
