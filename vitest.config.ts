import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@convex": path.resolve(root, "./convex"),
    },
  },
  test: {
    // convex-test runs Convex functions the way the backend does; the pure tests are happy there too
    environment: "edge-runtime",
    include: ["tests/unit/**/*.test.ts", "convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
