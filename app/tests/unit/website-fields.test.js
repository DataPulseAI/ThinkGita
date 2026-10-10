// app/src/WebsiteFields.jsx: readiness checklist, and parity with framer-sync's websiteMissing.
import { describe, it, expect, afterEach, vi } from "vitest";
import * as wf from "../../src/WebsiteFields.jsx";
import * as fs from "../../../supabase/functions/framer-sync/index.ts";
import { freeze, readyCircle, person } from "./helpers/circles.js";

afterEach(() => vi.useRealTimers());

describe("isReadinessNote", () => {
  it("recognises the framer-sync prefix only", () => {
    expect(wf.READINESS_PREFIX).toBe(fs.READINESS_PREFIX);
    expect(wf.isReadinessNote("Not shown on the website until set: photo")).toBe(true);
    expect(wf.isReadinessNote("Rate limited")).toBe(false);
    expect(wf.isReadinessNote(null)).toBe(false);
    expect(wf.isReadinessNote(undefined)).toBe(false);
  });
});

describe("startDate, displayName, derivedName, photoFor", () => {
  it("startDate", () => {
    expect(wf.startDate({ starts_on: "2026-10-01", status: "live" })).toBe("2026-10-01");
    expect(wf.startDate({ preferred_start: "2026-11-01", status: "approved" })).toBe("2026-11-01");
    expect(wf.startDate({ preferred_start: "2026-11-01", status: "live" })).toBeNull();
  });
  it("displayName and derivedName", () => {
    const c = { name: "TG Circles | Mon | 7.30pm UK | Anjali", facilitator: person() };
    expect(wf.derivedName(c)).toBe("Anjali");
    expect(wf.displayName({ ...c, website_name: " Isvara " })).toBe("Isvara");
    expect(wf.displayName({ name: "x", facilitator: person({ initiated_name: "A" }), cofacilitators: [{ facilitator: person({ name: "B" }) }, { facilitator: person({ name: "C" }) }] })).toBe("A, B & C");
    expect(wf.displayName({ name: "x", facilitator: person({ name: "e@example.org" }) })).toBe("");
  });
  it("photoFor", () => {
    expect(wf.photoFor({ website_photo_url: "https://img.example.org/c.jpg", facilitator: person() })).toBe("https://img.example.org/c.jpg");
    expect(wf.photoFor({ facilitator: person() })).toBe("https://img.example.org/asha.jpg");
    expect(wf.photoFor({})).toBeNull();
  });
});

describe("websiteChecks", () => {
  it("all ok for a ready circle, in framer-sync's order", () => {
    freeze("2026-10-10T12:00:00Z");
    const checks = wf.websiteChecks(readyCircle());
    expect(checks.map((x) => x.label)).toEqual(["photo", "display name", "WhatsApp group link", "start date", "weekday", "start time", "timezone", "language", "website order"]);
    expect(checks.every((x) => x.ok)).toBe(true);
    expect(checks.find((x) => x.label === "start date").how).toBe("Running weekly");
  });
  it("explains values already set on the website", () => {
    freeze("2026-10-10T12:00:00Z");
    const c = readyCircle({ facilitator: null, website_order: null, whatsapp_group_link: null, framer_has: { photo: true, order: true, whatsapp: true, name: true } });
    const by = Object.fromEntries(wf.websiteChecks(c).map((x) => [x.label, x]));
    expect(by.photo).toMatchObject({ ok: true, how: "Photo (already set on the website)" });
    expect(by["website order"]).toMatchObject({ ok: true, how: "Position (already set on the website)" });
    expect(by["WhatsApp group link"]).toMatchObject({ ok: true, how: "In the signup link (already set on the website)" });
  });
  it("start date hints", () => {
    freeze("2026-10-10T12:00:00Z");
    const pending = readyCircle({ status: "pending", starts_on: null });
    const sd = (c) => wf.websiteChecks(c).find((x) => x.label.startsWith("start date"));
    expect(sd(pending)).toMatchObject({ label: "start date", ok: false, how: "Needed until the circle is live" });
    expect(sd({ ...pending, preferred_start: "2026-10-20" })).toMatchObject({ label: "start date", ok: true, how: "Starts 2026-10-20" });
    expect(sd({ ...pending, preferred_start: "2026-10-01" })).toMatchObject({ label: "start date (it is in the past)", ok: false });
    expect(sd({ ...pending, framer_has: { link: true } })).toMatchObject({ ok: true, how: "Managed on the website" });
  });
});

describe("parity: WebsiteFields.websiteMissing equals framer-sync websiteMissing", () => {
  // Deterministic pseudo-random generator so the same circles are generated every run.
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
  function makeCircles(n, seed) {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const fac = pick(r, [null, person(), person({ photo_url: null }), person({ name: "x@example.org", photo_url: null }), person({ initiated_name: "Isvara", photo_url: "  " })]);
      out.push({
        id: `c${i}`, name: pick(r, ["", "Gita Circles | A | Monday 19:30 (UK)", "TG Circles | Mon | 7pm | Anjali", "TG | Mon | 7pm | English"]),
        name_auto: pick(r, [true, false]),
        status: pick(r, ["pending", "approved", "live", "paused", "conflict", "ended", "rejected"]),
        facilitator: fac, cofacilitators: pick(r, [[], [{ facilitator: person({ name: "Bela" }) }], [{ facilitator: null }]]),
        website_name: pick(r, [null, "", "  ", "Isvara"]), website_photo_url: pick(r, [null, "", "https://img.example.org/g.jpg"]),
        whatsapp_group_link: pick(r, [null, "", "https://chat.whatsapp.com/A", " https://chat.whatsapp.com/B ", "chat.whatsapp.com/C", "http://x y"]),
        starts_on: pick(r, [null, "2026-01-05", "2026-07-15", "2026-10-09", "2026-10-10", "2026-10-11", "2027-02-01"]),
        preferred_start: pick(r, [null, "2026-07-14", "2026-10-10", "2026-12-01"]),
        weekday: pick(r, [null, 0, 1, 3, 7, 8, "3"]), start_time: pick(r, [null, "", "19:30:00"]),
        timezone: pick(r, [null, "Europe/London", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata", "Mars/Base"]),
        language: pick(r, [null, "", "English", "Spanish"]), website_order: pick(r, [null, 0, -1, 1, 5, "2"]),
        framer_created: pick(r, [true, false, undefined]),
        framer_has: pick(r, [undefined, {}, { link: true }, { photo: true, order: true }, { name: true, whatsapp: true, link: true }, { photo: true, name: true, whatsapp: true, order: true, link: true }]),
      });
    }
    return out;
  }
  // Summer and winter instants, plus times when the UK date differs from LA or Auckland.
  const instants = ["2026-07-15T12:00:00Z", "2026-01-14T12:00:00Z", "2026-10-10T23:30:00Z", "2026-10-11T05:00:00Z", "2026-10-10T11:30:00Z", "2026-03-29T00:30:00Z"];
  it.each(instants)("%s: 600 generated circles agree", (iso) => {
    freeze(iso);
    for (const c of makeCircles(600, Date.parse(iso) % 100000)) {
      expect(wf.websiteMissing(c), JSON.stringify(c)).toEqual(fs.websiteMissing(c));
    }
  });
  it("displayName, photoFor and startDate agree too", () => {
    for (const c of makeCircles(300, 7)) {
      expect(wf.displayName(c)).toBe(fs.displayName(c));
      expect(wf.photoFor(c)).toBe(fs.photoFor(c));
      expect(wf.startDate(c)).toBe(fs.startDate(c));
    }
  });
});
