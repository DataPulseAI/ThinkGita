// End-to-end tests of the dashboard (Playwright). Run: npm run test:e2e
// The app is built and served locally; every Supabase call is answered by mocks in tests/e2e/support,
// so these tests never touch the real database, Zoom, email or the website.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4799;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: "retain-on-failure",
    // Optional: point at a specific Chromium (e.g. a headless shell in a sandbox); otherwise Playwright's own browser is used.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    timezoneId: "Europe/London",
    locale: "en-GB",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1300, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: { command: `npm run build && npx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
