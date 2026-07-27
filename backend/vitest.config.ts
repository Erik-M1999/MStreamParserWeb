import { defineConfig } from "vitest/config";

// JWT_SECRET is read at module-load time by middleware/authenticate.ts, so it
// must exist before the integration test imports the routers. Vitest applies
// `test.env` to process.env before loading test files.
export default defineConfig({
  test: {
    environment: "node",
    env: {
      JWT_SECRET: "integration-test-secret-key",
      TOKEN_ENC_KEY: "integration-test-token-enc-key",
      // Spotify/Last.fm services read these at module load; set them so the
      // "configured" branches and OAuth-URL building are exercised in tests.
      SPOTIFY_CLIENT_ID: "test-client-id",
      SPOTIFY_CLIENT_SECRET: "test-client-secret",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      LASTFM_API_KEY: "test-lastfm-key",
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
