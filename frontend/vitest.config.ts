import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the Next.js "@/*" path alias (-> ./src) so unit tests can import app modules.
const srcDir = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
