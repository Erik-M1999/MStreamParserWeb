import { type Request, type Response, type RequestHandler } from "express";
import { HttpError } from "./errors.js";

// Wraps an async route handler: awaits it and maps thrown errors to responses.
// An HttpError becomes its status + message; anything else is a logged 500.
// Lets route handlers be thin (call a service, send the result) and never
// repeat try/catch + status mapping.
export function route(
  fn: (req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("[route] unhandled error:", err);
      res.status(500).json({ error: "Internal server error." });
    }
  };
}
