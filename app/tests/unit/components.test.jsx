// Small dashboard components rendered with React (no network).
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WebsiteReadiness } from "../../src/WebsiteFields.jsx";
import * as A from "../../src/Admin.jsx";
import { freeze, readyCircle } from "./helpers/circles.js";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
let root, host;
function render(el) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(el));
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

describe("WebsiteReadiness", () => {
  it("compact: Ready", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(render(<WebsiteReadiness circle={readyCircle()} compact />).textContent).toBe("Ready");
  });
  it("compact: count of missing items with the list as a tooltip", () => {
    freeze("2026-10-10T12:00:00Z");
    const el = render(<WebsiteReadiness circle={readyCircle({ website_order: null, whatsapp_group_link: null })} compact />);
    expect(el.textContent).toBe("Missing 2");
    expect(el.querySelector("span").getAttribute("title")).toBe("WhatsApp group link, website order");
  });
  it("full: checklist with ticks and the reason it is hidden", () => {
    freeze("2026-10-10T12:00:00Z");
    const el = render(<WebsiteReadiness circle={readyCircle({ website_order: null })} />);
    expect(el.textContent).toContain("Not ready for the website. It stays hidden until: website order.");
    const items = [...el.querySelectorAll("li")];
    expect(items).toHaveLength(9);
    expect(items.filter((li) => li.classList.contains("done"))).toHaveLength(8);
    expect(items[0].textContent).toContain("Photo");
  });
  it("full: switched off wording", () => {
    freeze("2026-10-10T12:00:00Z");
    const el = render(<WebsiteReadiness circle={readyCircle({ website_visible: false, website_order: null })} />);
    expect(el.textContent).toContain("Before it can be shown, set: website order.");
  });
  it("full: ready", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(render(<WebsiteReadiness circle={readyCircle()} />).textContent).toContain("Ready for the website.");
  });
});

describe("SlotCard", () => {
  const c = (i, over = {}) => ({ id: `c${i}`, name: `Gita Circles | Host ${i} | Monday 19:00 (UK)`, weekday: 1, start_time: `${String(10 + i).padStart(2, "0")}:00:00`, duration_min: 60, licence_id: `L${i % 3}`, status: "live", licence: { label: `Licence 0${i % 3}` }, ...over });
  it("lists circles by time with free licences", () => {
    const el = render(<A.SlotCard title="Monday 19:00" list={[c(2), c(1, { status: "pending" })]} capacity={3} />);
    expect(el.querySelector(".hc-title").textContent).toBe("Monday 19:00");
    expect(el.querySelector(".hc-sub").textContent).toBe("2 circles · 1 licence free");
    const times = [...el.querySelectorAll("dt")].map((x) => x.textContent);
    expect(times).toEqual(["11:00–12:00", "12:00–13:00"]);
    const names = [...el.querySelectorAll("dd")].map((x) => x.textContent);
    expect(names[0]).toBe("Host 1Licence 01 · Awaiting approval");
    expect(names[1]).toBe("Host 2Licence 02");
  });
  it("every licence in use, singular wording, licence view hides labels", () => {
    const el = render(<A.SlotCard title="t" list={[c(1)]} capacity={1} licence={{ id: "L1" }} />);
    expect(el.querySelector(".hc-sub").textContent).toBe("1 circle · every licence in use");
    expect(el.querySelector(".hc-meta")).toBeNull();
  });
  it("shows at most 8 and says how many more", () => {
    const list = Array.from({ length: 10 }, (_, i) => c(i));
    const el = render(<A.SlotCard title="t" list={list} />);
    expect(el.querySelectorAll("dt")).toHaveLength(8);
    expect(el.textContent).toContain("and 2 more");
    expect(el.querySelector(".hc-sub").textContent).toBe("10 circles");
  });
});

describe("WebsiteSwitch", () => {
  it("blocked switch says why and does not call run", () => {
    freeze("2026-10-10T12:00:00Z");
    const run = vi.fn();
    const el = render(<A.WebsiteSwitch circle={readyCircle({ website_visible: false, website_order: null })} run={run} />);
    const btn = el.querySelector("button");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toBe("Not ready for the website. Needs: website order");
    expect(btn.textContent).toBe("Not ready");
    act(() => btn.click());
    expect(run).not.toHaveBeenCalled();
  });
  it("a shown circle can always be switched off", async () => {
    freeze("2026-10-10T12:00:00Z");
    const run = vi.fn(async () => {});
    const el = render(<A.WebsiteSwitch circle={readyCircle({ website_order: null })} run={run} />);
    const btn = el.querySelector("button");
    expect(btn.getAttribute("aria-checked")).toBe("true");
    expect(btn.textContent).toBe("Shown");
    await act(async () => btn.click());
    expect(run).toHaveBeenCalledWith(expect.any(Function), "Hidden from the website");
  });
  it("paused circles are blocked with the plain reason", () => {
    const el = render(<A.WebsiteSwitch circle={readyCircle({ status: "paused", website_visible: false })} run={vi.fn()} />);
    expect(el.querySelector("button").getAttribute("title")).toBe("Paused circles aren't listed");
    expect(el.querySelector("button").textContent).toBe("Hidden");
  });
});
