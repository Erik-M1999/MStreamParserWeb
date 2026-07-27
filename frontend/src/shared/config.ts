// Base URL of the Express backend.
//
// - Production (single-app deploy): the static frontend is served BY Express on
//   the same origin, so we use a RELATIVE base ("") — `/api/...` resolves to the
//   same host automatically. No CORS, no hard-coded domain.
// - Development: the Next dev server (:5173) and Express (:3000) are different
//   origins, so we point at the backend explicitly. 127.0.0.1 (not "localhost")
//   to match Spotify's loopback redirect rule.
//
// Override anytime with NEXT_PUBLIC_BACKEND_URL.
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3000" : "");
