import { defineConfig, devices } from "@playwright/test";
const PORT = 4799;
export default defineConfig({
  testDir: "tests/help",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    timezoneId: "Europe/London", locale: "en-GB",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1300, height: 900 }, deviceScaleFactor: 1.5 } }],
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: true, timeout: 60_000 },
});
