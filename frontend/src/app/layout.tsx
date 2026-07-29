import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Hanken_Grotesk } from "next/font/google";
import DesktopOnlyGate from "@/shared/components/DesktopOnlyGate";
import "./globals.css";

// Hanken Grotesk is the DESIGN.md type family (a contemporary Akkurat proxy).
// Exposed as a CSS variable so globals.css can wire it into --font-sans.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Music Streaming Tools",
  description: "Process and utilize various music streaming APIs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Dark Reader) inject
    // attributes onto <html> before React hydrates. This silences that specific,
    // harmless mismatch on the root element only — it does not affect our markup.
    <html lang="en" className={hanken.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-surface font-sans text-on-surface antialiased">
        {children}
        {/* Below md: covers the app with a "built for desktop" notice. */}
        <DesktopOnlyGate />
      </body>
    </html>
  );
}
