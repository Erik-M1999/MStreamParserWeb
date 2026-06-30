// A domain/service error that carries the HTTP status the route should return.
// Services throw these for expected failures (400/404/409…); the route() wrapper
// (shared/route.ts) maps them to responses, so handlers stay thin.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
