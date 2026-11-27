import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end checks, against `bun run dev:all` (the app on :5173 with a local Convex backend that
 * has E2E_AUTH=1; see README, "Test"). Each test signs up an account of its own.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }],
});
