import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap, openSection, sec, closeDrawer } from "./lib.js";

const view = (page, name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const row = (page, name) => page.locator(".tr-row[role=row]", { hasText: name }).first();

test("training: admin", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Training" });
  const list = page.locator("section.tr-page, main section.card").first();
  await page.getByRole("heading", { name: /^Trainees/ }).waitFor();
  await page.waitForTimeout(500);
  await snap(page, "training-1-list", { clip: page.locator("main"), hl: page.locator(".tr-row", { hasText: "Hari" }).first(), pad: 0, top: true });
  await snap(page, "assess-1-assign", { clip: page.locator(".tr-list"), hl: page.getByLabel("Assessor for Hari Sample").or(page.getByLabel(/^Assessor for Hari/)), pad: 12 });

  await page.locator(".tr-row", { hasText: "Hari" }).first().click();
  const drawer = page.locator(".tr-drawer");
  await drawer.waitFor();
  await page.waitForTimeout(400);
  await snap(page, "training-2-panel", { clip: drawer, hl: drawer.locator("section[aria-label=Training]"), pad: 0 });
  const links = drawer.locator("section[aria-label='Personal form links']");
  await openSection(page, "Personal form links");
  await snap(page, "training-5-links", { clip: links, hl: links.getByRole("button", { name: /Copy all links/ }), pad: 16 });
  const assess = drawer.locator("section[aria-label=Assessment]");
  await openSection(page, "Assessment");
  await snap(page, "assess-2-criteria", { clip: assess, hl: assess.locator(".tr-criterion").first(), pad: 16 });
  const out = drawer.locator("section[aria-label=Outcome]");
  await openSection(page, "Outcome");
  await snap(page, "assess-3-outcome", { clip: out, hl: out.locator(".tr-decision"), pad: 16 });
  await closeDrawer(page);

  await view(page, "Next steps").click();
  await page.locator(".tr-next").waitFor();
  await snap(page, "training-3-next", { clip: page.locator("main"), hl: page.locator(".tr-next").getByRole("button", { name: /^Send to all/ }).first(), pad: 0, top: true });
  await snap(page, "training-4-chase", { clip: page.locator(".tr-chase"), hl: page.locator(".tr-chase").getByRole("button", { name: /^Resend/ }), pad: 16 });

  await view(page, "Needs matching").click();
  await page.locator(".tr-matching").waitFor();
  await snap(page, "matching-1-page", { clip: page.locator("main"), hl: view(page, "Needs matching"), pad: 0, top: true });
  await snap(page, "matching-2-row", { clip: page.locator(".tr-match-row").first(), hl: page.locator(".tr-match-row").first().getByRole("button", { name: /^Same person/ }).or(page.locator(".tr-match-row").first().locator("select")), pad: 16 });

  await view(page, "Email wording").click();
  await page.locator(".tr-emails").waitFor();
  await snap(page, "tremail-1-page", { clip: page.locator("main"), hl: page.locator(".tr-emails .seg button").first(), pad: 0, top: true });
});
