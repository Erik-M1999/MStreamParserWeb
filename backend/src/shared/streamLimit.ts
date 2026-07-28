// ---------------------------------------------------------------------------
// Concurrency cap for SSE streams.
//
// Every open now-playing stream runs its own polling loop against a third-party
// API (Spotify every 6s, Last.fm every 12s). Without a cap, one account with a
// pile of open tabs — or a client that reconnects without closing — multiplies
// our outbound call rate until we hit the provider's rate limit and everyone's
// stream breaks. A small per-user ceiling keeps that bounded.
//
// Counters live in-process, which matches how the streams themselves work: a
// stream is tied to the process holding the socket, so there is nothing to share
// with a second node.
// ---------------------------------------------------------------------------

/** Max simultaneous streams one user may hold per provider (tabs/windows). */
export const MAX_STREAMS_PER_USER = 3;

export interface StreamSlot {
  /** Frees the slot. Safe to call more than once (later calls no-op). */
  release(): void;
}

export interface StreamLimiter {
  /** Takes a slot, or returns null when the user is already at the cap. */
  acquire(userId: number): StreamSlot | null;
  /** Streams currently held by a user — for tests/diagnostics. */
  count(userId: number): number;
}

export function createStreamLimiter(max = MAX_STREAMS_PER_USER): StreamLimiter {
  const open = new Map<number, number>();

  return {
    acquire(userId: number): StreamSlot | null {
      const current = open.get(userId) ?? 0;
      if (current >= max) return null;
      open.set(userId, current + 1);

      let released = false;
      return {
        release() {
          // A socket can emit "close" more than once; double-counting a release
          // would leak capacity and eventually let a user exceed the cap.
          if (released) return;
          released = true;
          const now = (open.get(userId) ?? 1) - 1;
          // Drop the key at zero so the map tracks active users, not every user
          // who has ever opened a stream.
          if (now <= 0) open.delete(userId);
          else open.set(userId, now);
        },
      };
    },

    count(userId: number): number {
      return open.get(userId) ?? 0;
    },
  };
}
