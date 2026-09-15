import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e.spec.ts", "*.e2e.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:43187",
    // Full Chromium can exercise the system GPU instead of forcing the shell's
    // software renderer; unavailable hardware still uses Chromium's fallback.
    channel: "chromium",
    launchOptions: { args: ["--enable-gpu"] },
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start -- --port 43187",
    url: "http://127.0.0.1:43187",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      TIMESTORY_DB_PATH: "data/e2e.sqlite",
      TIMESTORY_DIST_DIR: ".next-e2e",
    },
  },
});
