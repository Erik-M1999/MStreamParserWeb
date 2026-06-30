import { defineConfig } from "vitest/config";

// JWT_SECRET is read at module-load time by middleware/authenticate.ts, so it
// must exist before the integration test imports the routers. Vitest applies
// `test.env` to process.env before loading test files.
export default defineConfig({
  test: {
    environment: "node",
    env: {
      JWT_SECRET: "integration-test-secret-key",
    },
  },
});
