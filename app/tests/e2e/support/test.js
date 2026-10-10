// The `test` every spec uses: fixed clock and timezone, a mocked backend for each page, and a check that the page
// logged no errors. Import { test, expect } from here instead of from @playwright/test.
import { test as base, expect } from "@playwright/test";
import { mockBackend } from "./mock-backend.js";
import { NOW } from "../../fixtures/data.js";

export { expect };
export { signIn } from "./auth.js";
export { reply, fail } from "./mock-backend.js";

// Console noise that is not a bug in the app: blocked external fonts or images.
const EXTERNAL_ASSET = /fonts\.(googleapis|gstatic)\.com|images\.example\.org|framerusercontent\.com/;

export const test = base.extend({
  timezoneId: "Europe/London",
  locale: "en-GB",

  // Answers every backend call; the test changes `mock.db` or adds handlers before signing in.
  mock: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(NOW));
    await use(await mockBackend(page));
  },

  // Fails the test on any uncaught page error or console error. Runs for every test.
  errorGuard: [async ({ page, mock }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const url = msg.location()?.url ?? "";
      const text = msg.text();
      if (/Failed to load resource/.test(text) && (mock.errorUrls.has(url) || EXTERNAL_ASSET.test(url))) return;
      // page.clock injects a script into every frame; the sandboxed email preview iframe blocks it. Not the app's doing.
      if (url === "about:srcdoc" && /Blocked script execution/.test(text)) return;
      errors.push(`console: ${text}${url ? ` (${url})` : ""}`);
    });
    await use(errors);
    expect(errors, "page errors or console errors").toEqual([]);
  }, { auto: true }],

  // Records window.confirm / alert messages and answers them for every test
  // (accept by default; set dialogs.accept = false to cancel).
  dialogs: [async ({ page }, use) => {
    const dialogs = { messages: [], accept: true };
    page.on("dialog", (d) => {
      dialogs.messages.push(d.message());
      return dialogs.accept ? d.accept() : d.dismiss();
    });
    await use(dialogs);
  }, { auto: true }],
});

// Opens a page through the top navigation (groups are dropdowns).
export async function navTo(page, group, item) {
  const nav = page.locator("nav.tabs");
  await nav.getByRole("button", { name: new RegExp(`^${group}`) }).click();
  if (item) await nav.getByRole("menuitem", { name: new RegExp(`^${item}( \\d+)?$`) }).click();
}

// Dates as the app formats them (en-GB, short weekday). Browsers differ on a comma after the weekday
// ("Thu 15 Oct 2026" or "Thu, 15 Oct 2026"), so match either.
export const dateText = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/(\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)) (\d)/g, "$1,? $2"));

// The toast shown after an action.
export const toast = (page) => page.locator(".toast");
// The open circle panel.
export const drawer = (page) => page.locator("aside.drawer");
// No sideways scrolling of the whole page.
export async function expectNoHorizontalOverflow(page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
}
