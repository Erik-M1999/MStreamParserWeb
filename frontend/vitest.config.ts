import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the Next.js "@/*" path alias so unit tests can import app modules.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
