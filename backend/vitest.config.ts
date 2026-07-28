import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// JWT_SECRET is read at module-load time by middleware/authenticate.ts, so it
// must exist before the integration test imports the routers. Vitest applies
// `test.env` to process.env before loading test files.
//
// NOTHING secret-shaped is hardcoded here. Real credentials come from the
// developer's gitignored backend/.env (same file the app uses); the throwaway
// values below are generated fresh per run, so there is no committed string a
// secret scanner can flag — or an attacker can try against a real service.

// Pick up backend/.env if the developer has one (copy .env.example to start).
// Vitest runs with cwd = backend/, and a missing file is fine: the only tests
// that need DATABASE_URL are the real-DB ones.
const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/** A random throwaway value for a per-run test secret. */
const ephemeral = () => crypto.randomBytes(32).toString("hex");

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // Signed and verified inside the same process, so a random value per run
      // works exactly like a fixed one — and can never be a real secret.
      JWT_SECRET: ephemeral(),
      TOKEN_ENC_KEY: ephemeral(),
      // Real-DB tests (integration/library/apikeys) hit the local MariaDB from
      // docker-compose; set DATABASE_URL in backend/.env to point at it. The
      // credential-free fallback keeps every other test running: the DB tests
      // fail loudly on connect instead of the whole suite failing to import.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "mysql://127.0.0.1:3306/MStreamParserWeb",
      // Spotify/Last.fm services read these at module load; set them so the
      // "configured" branches and OAuth-URL building are exercised in tests.
      // The client ID is an identifier, not a credential, and one test asserts
      // it appears in the authorize URL — so it stays fixed.
      SPOTIFY_CLIENT_ID: "test-client-id",
      SPOTIFY_CLIENT_SECRET: ephemeral(),
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      LASTFM_API_KEY: ephemeral(),
    },
    coverage: {
      provider: "v8",
      // Honest measure: count EVERY source file, not just the ones a test
      // happened to import.
      all: true,
      include: ["src/**/*.ts"],
      // Excluded on purpose (not "coverage gaming"):
      //  - server.ts       : app bootstrap / app.listen — exercised by the app, not unit tests
      //  - scripts/**       : one-off dev scripts (seed)
      //  - emails/**        : presentational React email templates (.tsx)
      //  - *.routes.ts      : thin Express wiring; covered via integration tests where it matters
      //  - shared/route.ts  : trivial error-mapping wrapper, covered transitively
      exclude: [
        "src/server.ts",
        "src/scripts/**",
        "src/emails/**",
        "src/**/*.d.ts",
      ],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
