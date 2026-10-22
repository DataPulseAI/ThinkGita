// Helpers for capturing the Help guide screenshots. Every shot comes from the e2e mock backend (made-up people,
// example.org addresses), so no real data ever appears. Run: npm run help:shots
import fs from "node:fs";
import path from "node:path";

export const OUT = path.resolve("tests/help/out");
fs.mkdirSync(OUT, { recursive: true });

const STYLE = `
[data-help-hl]{outline:3px solid #ec6449 !important;outline-offset:3px !important;border-radius:10px;box-shadow:0 0 0 8px rgba(236,100,73,.20) !important;position:relative;z-index:5}
.toast{display:none !important}
*{caret-color:transparent !important}
`;

// A locator, a selector string, or a list of either.
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const loc = (page, x) => (typeof x === "string" ? page.locator(x).first() : x.first());

/**
 * snap(page, name, { hl, clip, pad, full })
 *  hl:   element(s) to ring in coral
 *  clip: element(s) whose combined box (plus pad) is the picture; default is the whole viewport
 *  pad:  extra pixels around the clip (default 24)
 */
export async function snap(page, name, { hl, clip, pad = 24, full = false, wait = 250, top = false } = {}) {
  await page.addStyleTag({ content: STYLE }).catch(() => {});
  const marked = [];
  for (const h of arr(hl)) {
    const el = loc(page, h);
    await el.waitFor({ state: "visible", timeout: 8000 });
    await el.evaluate((n) => n.setAttribute("data-help-hl", ""));
    marked.push(el);
  }
  await page.waitForTimeout(wait);
  const file = path.join(OUT, `${name}.png`);
  const targets = arr(clip);
  if (targets.length) {
    for (const t of targets) await loc(page, t).waitFor({ state: "visible", timeout: 8000 });
    const vp = page.viewportSize();
    const read = async () => Promise.all(targets.map((t) => loc(page, t).boundingBox()));
    // Bring the first target to the top of its scroll area, then check the rest are on screen too.
    // `top`: a whole page, shown from its very top.
    if (top) await page.evaluate(() => window.scrollTo(0, 0));
    else await loc(page, targets[0]).evaluate((n) => n.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    let boxes = await read();
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    if (!top && bottom > vp.height - 4) {
      await loc(page, targets[targets.length - 1]).evaluate((n) => n.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(150);
      boxes = await read();
    }
    let x1 = Math.min(...boxes.map((b) => b.x)) - pad, y1 = Math.min(...boxes.map((b) => b.y)) - pad;
    let x2 = Math.max(...boxes.map((b) => b.x + b.width)) + pad, y2 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    x1 = Math.max(0, x1); y1 = Math.max(0, y1); x2 = Math.min(vp.width, x2); y2 = Math.min(vp.height, y2);
    await page.screenshot({ path: file, clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  } else {
    await page.screenshot({ path: file, fullPage: full });
  }
  for (const el of marked) await el.evaluate((n) => n.removeAttribute("data-help-hl")).catch(() => {});
  return file;
}

export const money = undefined;

// Open a collapsible section in a circle, trainee or facilitator panel.
export async function openSection(page, title) {
  const t = page.locator("button.sec-toggle", { hasText: title }).first();
  await t.waitFor({ state: "visible" });
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  await page.waitForTimeout(250);
  return t;
}
export const sec = (page, title) => page.locator(`section.sec[aria-label="${title}"]`).first();
export async function closeDrawer(page) {
  const x = page.locator(".drawer-head button[aria-label=Close]").first();
  if (await x.count()) { await x.click(); await page.locator(".drawer-bg").first().waitFor({ state: "detached" }).catch(() => {}); await page.waitForTimeout(250); }
}
export const card = (page, heading) => page.locator("section.card", { has: page.getByRole("heading", { name: heading }) }).first();
