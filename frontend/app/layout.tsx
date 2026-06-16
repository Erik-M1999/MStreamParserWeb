import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MStreamParserWeb",
  description: "Process and utilize various music streaming APIs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Dark Reader) inject
    // attributes onto <html> before React hydrates. This silences that specific,
    // harmless mismatch on the root element only — it does not affect our markup.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
