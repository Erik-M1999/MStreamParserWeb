import { defineConfig } from "cypress";

// E2E against the running dev stack. baseUrl uses 127.0.0.1 (not localhost) so
// the auth cookie — scoped to 127.0.0.1 by the backend — is sent on app calls.
export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    video: false,
    env: {
      backendUrl: "http://127.0.0.1:3000",
    },
  },
});
