import { Resend } from "resend";
import { render } from "@react-email/render";
import { createElement } from "react";
import { WelcomeEmail } from "./emails/WelcomeEmail.js";

// ---------------------------------------------------------------------------
// Transactional email via Resend + React Email templates.
//
// - No-ops gracefully when RESEND_API_KEY is unset, so the app runs fine
//   without email configured (dev / CI / tests).
// - Callers send fire-and-forget (they don't await), so email never blocks the
//   HTTP request — and this module swallows its own errors so a mail failure
//   can never bubble into a route handler.
//
// Resend free tier: without a verified domain you can only send FROM
// onboarding@resend.dev TO your own account email. Set MAIL_FROM to a verified
// address to send to anyone.
// ---------------------------------------------------------------------------

const API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM = "Music Streaming Tools <noreply@m1999-tools.de>";
const APP_URL = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

const resend = API_KEY ? new Resend(API_KEY) : null;

/** Sends the welcome email. Resolves even on failure (errors are logged, not thrown). */
export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  if (!resend) {
    console.warn("[mail] RESEND_API_KEY not set — skipping welcome email.");
    return;
  }
  const loginUrl = `${APP_URL}/login`;
  try {
    const element = createElement(WelcomeEmail, { username, loginUrl });
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: "Welcome to Music Streaming Tools",
      html,
      text,
    });
    if (error) console.error("[mail] welcome email failed:", error);
  } catch (err) {
    console.error("[mail] welcome email threw:", err);
  }
}
