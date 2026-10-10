// Circle names: the JavaScript copy of the naming rules (app/src/lib.js) used by the circle editor to show the name
// after a schedule change. The database trigger in supabase/migrations/20261010000026_circle_names.sql does the real
// rename; supabase/tests/sql/07_circle_names.sql runs the same cases there.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as lib from "../../src/lib.js";
import { freeze } from "./helpers/circles.js";

afterEach(() => vi.useRealTimers());

const at = (weekday, start_time, timezone) => ({ weekday, start_time, timezone });

describe("zone list matches the migration", () => {
  it("same rows, same order", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261010000026_circle_names.sql"), "utf8");
    const body = sql.slice(sql.indexOf("create or replace function public.circle_zone_labels()"), sql.indexOf("create or replace function public.circle_zone_label("));
    const rows = [...body.matchAll(/\('([^']+)', '([^']+)', '(both|label|zone)'\)/g)].map((m) => [m[1], m[2], m[3]]);
    expect(rows.length).toBeGreaterThan(50);
    expect(lib.ZONE_LABELS).toEqual(rows);
  });
});

describe("labels", () => {
  it.each([
    ["17:00", ".", "5pm"], ["19:30", ".", "7.30pm"], ["18:15", ":", "6:15pm"], ["00:00", ".", "12am"],
    ["12:00", ".", "12pm"], ["12:05", ".", "12.05pm"], ["09:00:00", ".", "9am"],
  ])("time %s (sep %s) -> %s", (t, sep, want) => expect(lib.timeLabel(t, sep)).toBe(want));
  it.each([
    ["Europe/London", "UK"], ["America/Chicago", "CT"], ["Europe/Brussels", "CET"], ["Asia/Kolkata", "IST"],
    ["America/New_York", "EST"], ["Asia/Tehran", "Tehran"], ["Etc/GMT+5", "GMT-5"], ["America/Argentina/Buenos_Aires", "ART"], [null, ""],
  ])("zone %s -> %s", (tz, want) => expect(lib.zoneLabel(tz)).toBe(want));
  it("labels read back as zones, aliases included, unknown ones not", () => {
    expect(lib.zoneForLabel("uk")).toBe("Europe/London");
    expect(lib.zoneForLabel("CST")).toBe("America/Chicago");
    expect(lib.zoneForLabel("Polska")).toBe("Europe/Warsaw");
    expect(lib.zoneForLabel("CET")).toBe("Europe/Paris");
    expect(lib.zoneForLabel("Mars")).toBeNull();
  });
});

describe("followSchedule: imported names follow the day and time", () => {
  it.each([
    ["the real case", "TG Circles | Tue | 5pm CT | Test Host", at(2, "17:00:00", "America/Chicago"), at(6, "09:00", "America/Chicago"), "TG Circles | Sat | 9am CT | Test Host"],
    ["dot minutes", "TG Circles | Mon | 7.30pm UK | Test Host", at(1, "19:30", "Europe/London"), at(1, "20:15", "Europe/London"), "TG Circles | Mon | 8.15pm UK | Test Host"],
    ["on the hour", "TG Circles | Mon | 7.30pm UK | Test Host", at(1, "19:30", "Europe/London"), at(1, "20:00", "Europe/London"), "TG Circles | Mon | 8pm UK | Test Host"],
    ["colon style, Tues", "TG Bhakti Circles | Tues | 6:15pm CET | Test Host", at(2, "18:15", "Europe/Paris"), at(3, "18:45", "Europe/Paris"), "TG Bhakti Circles | Wed | 6:45pm CET | Test Host"],
    ["day only", "TG Circles Morning Japa | Thu | 5am UK | Test Host", at(4, "05:00", "Europe/London"), at(5, "05:00", "Europe/London"), "TG Circles Morning Japa | Fri | 5am UK | Test Host"],
    ["zone only", "TG Circles Morning Japa | Fri | 5am UK | Test Host", at(5, "05:00", "Europe/London"), at(5, "05:00", "Europe/Brussels"), "TG Circles Morning Japa | Fri | 5am CET | Test Host"],
    ["unlisted zone", "TG Circles Morning Japa | Fri | 5am CET | Test Host", at(5, "05:00", "Europe/Brussels"), at(5, "06:30", "Asia/Tehran"), "TG Circles Morning Japa | Fri | 6.30am Tehran | Test Host"],
    ["extra name segment", "TG Circles | Sat | 5pm CDMX | Second Name | Test Host", at(6, "17:00", "America/Mexico_City"), at(7, "16:30", "America/Mexico_City"), "TG Circles | Sun | 4.30pm CDMX | Second Name | Test Host"],
    ["full day name", "TG Circles | Monday | 7pm UK | Test Host", at(1, "19:00", "Europe/London"), at(2, "19:00", "Europe/London"), "TG Circles | Tuesday | 7pm UK | Test Host"],
    ["label glued to the time", "TG Circles | Thu | 7.30pmEAT | Test Host", at(4, "19:30", "Africa/Nairobi"), at(4, "20:00", "Africa/Nairobi"), "TG Circles | Thu | 8pm EAT | Test Host"],
    ["space before am", "TG Circles | Sat | 8:30 am ECT | Test Host", at(6, "08:30", "America/Guayaquil"), at(6, "09:00", "America/Guayaquil"), "TG Circles | Sat | 9am ECT | Test Host"],
    ["extra time, zones without clock changes", "TG Circles | Fri | 8pm IST | 11.30pm Korea | Test Host", at(5, "20:00", "Asia/Kolkata"), at(5, "18:00", "Asia/Kolkata"), "TG Circles | Fri | 6pm IST | 9.30pm Korea | Test Host"],
    ["extra time with an unknown zone stays", "TG Circles | Mon | 6pm UK | 7pm Mars | Test Host", at(1, "18:00", "Europe/London"), at(1, "18:30", "Europe/London"), "TG Circles | Mon | 6.30pm UK | 7pm Mars | Test Host"],
  ])("%s", (_, name, before, after, want) => expect(lib.followSchedule(name, before, after)).toBe(want));

  it("extra times use the next session date, so clock changes are right (Chicago to UK and India)", () => {
    freeze("2026-10-10T12:00:00Z"); // Saturday; UK still on summer time, Chicago too
    const name = "TG Circles | Sat | 9am CT | 3pm UK | 7:30pm IST | Test Host";
    expect(lib.followSchedule(name, at(6, "09:00", "America/Chicago"), at(6, "10:00", "America/Chicago")))
      .toBe("TG Circles | Sat | 10am CT | 4pm UK | 8:30pm IST | Test Host");
    freeze("2026-10-31T12:00:00Z"); // Saturday; the UK has changed its clocks, Chicago not yet
    expect(lib.followSchedule(name, at(6, "09:00", "America/Chicago"), at(6, "10:00", "America/Chicago")))
      .toBe("TG Circles | Sat | 10am CT | 3pm UK | 8:30pm IST | Test Host");
  });

  it.each([
    ["not an imported pattern", "Bhakti Circles - Monday"],
    ["time first, no pipes", "Test Host 6PM MST Friday"],
    ["no day segment", "TG Circles | Weekly | 7pm UK | Test Host"],
    ["automatic name", "Gita Circles | Test Host | Monday 19:00 (UK time)"],
  ])("other names stay as they are: %s", (_, name) => {
    expect(lib.followsSchedule(name)).toBe(false);
    expect(lib.followSchedule(name, at(1, "18:00", "Europe/London"), at(2, "19:00", "Europe/Paris"))).toBe(name);
  });

  it("nothing changes when the schedule is the same (19:00 equals 19:00:00) or incomplete", () => {
    const name = "TG Circles | Mon | 7pm UK | Test Host";
    expect(lib.followSchedule(name, at(1, "19:00:00", "Europe/London"), at(1, "19:00", "Europe/London"))).toBe(name);
    expect(lib.followSchedule(name, at(1, "19:00", "Europe/London"), at(2, "", "Europe/London"))).toBe(name);
    expect(lib.followSchedule(null, at(1, "19:00"), at(2, "19:00"))).toBeNull();
  });
});

describe("autoNamePreview", () => {
  it("matches the database's automatic name format", () => {
    expect(lib.autoNamePreview({ host: "Test Host", weekday: 3, start_time: "19:30", timezone: "Europe/London" })).toBe("Gita Circles | Test Host | Wednesday 19:30 (UK time)");
    expect(lib.autoNamePreview({ host: " ", weekday: 6, start_time: "09:00:00", timezone: "America/Chicago" })).toBe("Gita Circles | New host | Saturday 09:00 (Chicago time)");
    expect(lib.autoNamePreview({ host: "A", weekday: 7, start_time: "08:05", timezone: "Etc/GMT+5" })).toBe("Gita Circles | A | Sunday 08:05 (GMT-5)");
  });
});
