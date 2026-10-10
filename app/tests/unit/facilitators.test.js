// app/src/FacilitatorsPage.jsx: time zones, weekly consistency, flags, rows, filters and the save patch.
import { describe, it, expect } from "vitest";
import * as fp from "../../src/FacilitatorsPage.jsx";

const T = (iso) => Date.parse(iso);
// Wednesday 7 October 2026, 11:00 UK time (same "now" as the e2e fixtures).
const NOW = T("2026-10-07T10:00:00Z");
const circle = (o = {}) => ({
  id: "c1", status: "live", weekday: 1, start_time: "19:00:00", duration_min: 75, timezone: "Europe/London",
  starts_on: null, ends_on: null, zoom_meeting_id: "111", name: "Gita Circles | Test | Monday 19:00 (UK time)", ...o,
});
const session = (startedAt, o = {}) => ({
  id: `s-${startedAt}`, circle_id: "c1", zoom_meeting_id: "111", started_at: startedAt,
  ended_at: new Date(T(startedAt) + 90 * 60000).toISOString(), participant_count: 8, ...o,
});
// Weekly London sessions at 18:00Z (19:00 BST) on the given Mondays.
const mondays = (...days) => days.map((d) => session(`2026-${d}T18:00:00Z`));
const states = (weeks) => weeks.map((w) => w.state);

describe("time zone helpers", () => {
  it("converts wall clock time in a zone to an instant, across clock changes", () => {
    expect(fp.zonedTime("2026-10-05", "19:00", "Europe/London")).toBe(T("2026-10-05T18:00:00Z")); // BST
    expect(fp.zonedTime("2026-10-26", "19:00", "Europe/London")).toBe(T("2026-10-26T19:00:00Z")); // GMT
    expect(fp.zonedTime("2026-10-06", "18:00", "America/New_York")).toBe(T("2026-10-06T22:00:00Z"));
    expect(fp.zonedTime("2026-10-07", "12:00", "Asia/Kolkata")).toBe(T("2026-10-07T06:30:00Z"));
    expect(fp.zonedTime("2026-10-05", "07:00", "Pacific/Auckland")).toBe(T("2026-10-04T18:00:00Z"));
  });
  it("reads calendar dates and weekdays", () => {
    expect(fp.ymdIn(T("2026-10-06T23:30:00Z"), "Europe/London")).toBe("2026-10-07");
    expect(fp.ymdIn(T("2026-10-06T23:30:00Z"), "America/New_York")).toBe("2026-10-06");
    expect(fp.isoWeekday("2026-10-05")).toBe(1);
    expect(fp.isoWeekday("2026-10-11")).toBe(7);
    expect(fp.addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(fp.tzOffsetMs("Europe/London", T("2026-07-01T12:00:00Z"))).toBe(3600e3);
    expect(fp.validTz("Not/AZone")).toBe(false);
  });
});

describe("sessionKind", () => {
  it("counts 2 or more people (or an unknown count) as held", () => {
    expect(fp.sessionKind(session("2026-10-05T18:00:00Z"))).toBe("held");
    expect(fp.sessionKind(session("2026-10-05T18:00:00Z", { participant_count: 0 }))).toBe("held");
  });
  it("tells host-only sessions from short test starts", () => {
    expect(fp.sessionKind(session("2026-10-05T18:00:00Z", { participant_count: 1 }))).toBe("host");
    const short = session("2026-10-05T18:00:00Z", { participant_count: 1, ended_at: "2026-10-05T18:03:00Z" });
    expect(fp.sessionKind(short)).toBe("ignore");
  });
});

describe("circleWeeks", () => {
  it("lists the last 8 scheduled weeks, oldest first, marking held and missed", () => {
    const s = mondays("08-17", "08-24", "09-07", "09-14", "09-21", "10-05");
    const w = fp.circleWeeks(circle(), s, NOW);
    expect(w.map((x) => x.ymd)).toEqual(["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(states(w)).toEqual(["held", "held", "missed", "held", "held", "held", "missed", "held"]);
    expect(w[7].start).toBe(T("2026-10-05T18:00:00Z"));
  });
  it("keeps the latest week neutral until attendance has had time to sync", () => {
    const justAfter = T("2026-10-05T20:30:00Z");
    expect(fp.circleWeeks(circle(), [], justAfter).at(-1).state).toBe("waiting");
    expect(fp.circleWeeks(circle(), [], justAfter + fp.GRACE_MS).at(-1).state).toBe("missed");
    // Before today's start time, today is not a week yet: the strip ends last Monday.
    expect(fp.circleWeeks(circle(), [], T("2026-10-05T17:00:00Z")).at(-1).ymd).toBe("2026-09-28");
  });
  it("uses the circle's own weekday and timezone, with the UK date alongside", () => {
    // Tuesday 22:00 in New York is early Wednesday in the UK.
    const ny = circle({ weekday: 2, start_time: "22:00:00", timezone: "America/New_York" });
    const w = fp.circleWeeks(ny, [], NOW).at(-1);
    expect(w.ymd).toBe("2026-10-06");
    expect(w.uk).toBe("2026-10-07");
    expect(w.start).toBe(T("2026-10-07T02:00:00Z"));
    // Kolkata Wednesday 12:00 is 06:30 UTC, already past at 10:00 UTC, so today counts.
    const kol = circle({ weekday: 3, start_time: "12:00:00", timezone: "Asia/Kolkata" });
    expect(fp.circleWeeks(kol, [], NOW).at(-1).ymd).toBe("2026-10-07");
    // Auckland Monday morning is Sunday evening in the UK.
    const akl = circle({ weekday: 1, start_time: "07:00:00", timezone: "Pacific/Auckland" });
    const a = fp.circleWeeks(akl, [], NOW).at(-1);
    expect([a.ymd, a.uk]).toEqual(["2026-10-05", "2026-10-04"]);
  });
  it("keeps the local time steady across the UK clock change", () => {
    const after = T("2026-11-04T10:00:00Z");
    const w = fp.circleWeeks(circle(), [], after);
    const starts = w.slice(-3).map((x) => new Date(x.start).toISOString());
    expect(starts).toEqual(["2026-10-19T18:00:00.000Z", "2026-10-26T19:00:00.000Z", "2026-11-02T19:00:00.000Z"]);
  });
  it("matches a session moved to another day of the same week", () => {
    const moved = [session("2026-10-01T18:00:00Z")]; // Thursday instead of Monday 28 Sep
    expect(fp.circleWeeks(circle(), moved, NOW).at(-2).state).toBe("held");
  });
  it("marks weeks before the start date, after the end date, and while paused", () => {
    const starting = fp.circleWeeks(circle({ starts_on: "2026-09-21" }), [], NOW);
    expect(states(starting)).toEqual(["before", "before", "before", "before", "before", "missed", "missed", "missed"]);
    const ended = fp.circleWeeks(circle({ ends_on: "2026-09-21" }), mondays("09-14", "09-21"), NOW);
    expect(states(ended).slice(-4)).toEqual(["held", "held", "after", "after"]);
    const paused = fp.circleWeeks(circle({ status: "paused" }), mondays("08-17", "08-24"), NOW);
    expect(states(paused)).toEqual(["held", "held", "paused", "paused", "paused", "paused", "paused", "paused"]);
  });
  it("without a start date, weeks before the first session on record are not counted", () => {
    const s = mondays("09-21", "09-28", "10-05");
    const w = fp.circleWeeks(circle(), s, NOW, { firstSeen: T("2026-09-21T18:00:00Z") });
    expect(states(w)).toEqual(["before", "before", "before", "before", "before", "held", "held", "held"]);
  });
  it("shows host-only weeks and ignores test starts", () => {
    const s = [
      session("2026-09-28T18:00:00Z", { participant_count: 1 }),
      session("2026-10-05T17:50:00Z", { participant_count: 1, ended_at: "2026-10-05T17:52:00Z" }),
    ];
    expect(states(fp.circleWeeks(circle(), s, NOW)).slice(-2)).toEqual(["host", "missed"]);
  });
  it("prefers a held session over a host-only one in the same week", () => {
    const s = [session("2026-10-05T17:30:00Z", { participant_count: 1 }), session("2026-10-05T18:00:00Z", { participant_count: 6 })];
    const w = fp.circleWeeks(circle(), s, NOW).at(-1);
    expect([w.state, w.session.participant_count]).toEqual(["held", 6]);
  });
});

describe("circleConsistency flags", () => {
  const all = ["08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05"];
  it("is quiet when the circle meets every week", () => {
    const h = fp.circleConsistency(circle(), mondays(...all), NOW);
    expect(h).toMatchObject({ due: 8, met: 8, missed: 0, flags: [], running: true, avg: 8 });
    expect(h.lastSession).toBe(T("2026-10-05T18:00:00Z"));
  });
  it("flags 2 missed of the last 4 weeks", () => {
    const h = fp.circleConsistency(circle(), mondays(...all.filter((d) => !["09-14", "09-28"].includes(d))), NOW);
    expect(h.flags).toEqual(["Missed 2 of the last 4 weeks"]);
  });
  it("flags 3 or more weeks without a session", () => {
    const h = fp.circleConsistency(circle(), mondays(...all.slice(0, 5)), NOW);
    expect(h.trailing).toBe(3);
    expect(h.flags).toEqual(["No session in 3 weeks"]);
  });
  it("flags a live circle with no sessions on record", () => {
    expect(fp.circleConsistency(circle(), [], NOW).flags).toEqual(["No sessions on record"]);
  });
  it("does not flag one missed week, a circle that has just started, or a paused circle", () => {
    expect(fp.circleConsistency(circle(), mondays(...all.slice(0, 7)), NOW).flags).toEqual([]);
    expect(fp.circleConsistency(circle({ starts_on: "2026-10-05" }), [], NOW).flags).toEqual([]);
    expect(fp.circleConsistency(circle({ status: "paused" }), [], NOW).flags).toEqual([]);
  });
  it("a live circle starting later is not running and says when it starts", () => {
    const h = fp.circleConsistency(circle({ starts_on: "2026-10-12" }), [], NOW);
    expect(h).toMatchObject({ running: false, nextStart: "2026-10-12", due: 0, flags: [] });
  });
  it("circles awaiting approval have no strip", () => {
    expect(fp.circleConsistency(circle({ status: "pending" }), [], NOW).weeks).toEqual([]);
  });
});

describe("sessionsByCircle", () => {
  it("uses circle_id, and the Zoom meeting ID for sessions not linked to a circle", () => {
    const c1 = circle();
    const c2 = circle({ id: "c2", zoom_meeting_id: "222" });
    const m = fp.sessionsByCircle([c1, c2], [
      { id: "a", circle_id: "c1", zoom_meeting_id: "111" },
      { id: "b", circle_id: null, zoom_meeting_id: "222" },
      { id: "c", circle_id: null, zoom_meeting_id: "999" },
      { id: "d", circle_id: "gone", zoom_meeting_id: "111" },
    ]);
    expect(m.get("c1").map((s) => s.id)).toEqual(["a"]);
    expect(m.get("c2").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("facilitatorNames, initials, detailFlags", () => {
  it("shows the initiated name with the legal name beside it", () => {
    expect(fp.facilitatorNames({ initiated_name: "Kirtana", first_name: "Asha", last_name: "Example", name: "x" })).toEqual({ title: "Kirtana", sub: "Asha Example" });
    expect(fp.facilitatorNames({ initiated_name: "Kirtana", name: "Kirtana (Asha Example)" })).toEqual({ title: "Kirtana", sub: "Asha Example" });
    expect(fp.facilitatorNames({ name: "Bram Sample" })).toEqual({ title: "Bram Sample", sub: "" });
    expect(fp.facilitatorNames({ name: "someone@example.org", email: "someone@example.org" }).title).toBe("someone@example.org");
  });
  it("makes initials", () => {
    expect(fp.initials({ name: "Bram de Sample" })).toBe("BS");
    expect(fp.initials({ initiated_name: "Devi" })).toBe("D");
  });
  it("flags details worth fixing", () => {
    expect(fp.detailFlags({ name: "a@example.org", phone: "" }).map((d) => d.key)).toEqual(["name", "photo", "phone"]);
    expect(fp.detailFlags({ name: "Asha", phone: "+44", photo_url: "https://x.example.org/a.jpg" })).toEqual([]);
    expect(fp.detailFlags({ name: "Asha", phone: "+44", photo_url: "not a link" }).map((d) => d.key)).toEqual(["photo"]);
  });
});

describe("buildRows, filterRows, sortRows", () => {
  const facs = [
    { id: "f1", name: "Asha Example", email: "asha@example.org", phone: "+44 1", photo_url: "https://x.example.org/a.jpg" },
    { id: "f2", name: "Bram Sample", email: "bram@example.org", phone: "+44 2" },
    { id: "f3", name: "Chitra Placeholder", email: "chitra@example.org", phone: null },
    { id: "f4", name: "dev@example.org", email: "dev@example.org", phone: "+44 4" },
    { id: "f5", name: "Esha Specimen", email: "esha@example.org", phone: "+44 5" },
  ];
  const by = (id) => facs.find((f) => f.id === id);
  const circles = [
    circle({ id: "c1", facilitator: by("f1"), cofacilitators: [{ facilitator: by("f5") }] }),
    circle({ id: "c2", facilitator: by("f2"), zoom_meeting_id: "222" }),
    circle({ id: "c3", status: "pending", facilitator: by("f3") }),
    circle({ id: "c4", status: "paused", facilitator: by("f2"), zoom_meeting_id: "444" }),
    circle({ id: "c5", status: "ended", facilitator: by("f4") }),
  ];
  const sessions = [
    ...mondays("08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05"),
    ...mondays("08-17", "08-24", "08-31", "09-07", "09-14").map((s) => ({ ...s, id: `${s.id}-2`, circle_id: "c2", zoom_meeting_id: "222" })),
  ];
  const rows = fp.buildRows(facs, circles, sessions, NOW);
  const row = (id) => rows.find((r) => r.id === id);

  it("gives each facilitator a status from their current circles", () => {
    expect(row("f1").status).toBe("well");
    expect(row("f2").status).toBe("check");
    expect(row("f2").circleFlags).toEqual(["No session in 3 weeks"]);
    expect(row("f3").status).toBe("starting");
    expect(row("f4").status).toBe("none"); // only an ended circle
    expect(row("f5").status).toBe("well"); // co-facilitates c1
  });
  it("counts circles by status and role", () => {
    expect(row("f2").counts).toEqual({ live: 1, awaiting: 0, paused: 1, co: 0 });
    expect(row("f5").counts).toEqual({ live: 0, awaiting: 0, paused: 0, co: 1 });
    expect(row("f1").lastSession).toBe(T("2026-10-05T18:00:00Z"));
    expect(row("f1").avg).toBe(8);
  });
  it("filters by status, detail and search words", () => {
    expect(fp.filterRows(rows, { status: "check" }).map((r) => r.id)).toEqual(["f2"]);
    expect(fp.filterRows(rows, { detail: "phone" }).map((r) => r.id)).toEqual(["f3"]);
    expect(fp.filterRows(rows, { detail: "name" }).map((r) => r.id)).toEqual(["f4"]);
    expect(fp.filterRows(rows, { q: "monday asha" }).map((r) => r.id)).toEqual(["f1"]);
    expect(fp.filterRows(rows, { q: "esha@" }).map((r) => r.id)).toEqual(["f5"]);
  });
  it("sorts", () => {
    expect(fp.sortRows(rows, "attention")[0].id).toBe("f2");
    expect(fp.sortRows(rows, "circles")[0].id).toBe("f2");
    expect(fp.sortRows(rows, "name").map((r) => r.id)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    const last = fp.sortRows(rows, "last").filter((r) => r.lastSession).map((r) => r.id);
    expect(last).toEqual(["f2", "f1", "f5"]);
    expect(fp.sortRows(rows, "last").slice(-2).map((r) => r.id)).toEqual(["f3", "f4"]);
  });
  it("still lists people only known through a circle", () => {
    const extra = fp.buildRows([], circles.slice(0, 1), [], NOW);
    expect(extra.map((r) => r.id).sort()).toEqual(["f1", "f5"]);
  });
});

describe("facilitatorUpdate and formProblems", () => {
  const fac = { id: "f1", name: "Asha Example", email: "asha@example.org", phone: "+44 1", first_name: null, last_name: null, initiated_name: null, photo_url: null };
  const form = (o) => ({ name: "Asha Example", email: "asha@example.org", phone: "+44 1", first_name: "", last_name: "", initiated_name: "", photo_url: "", ...o });
  it("only sends what changed, trimmed, with empty fields as null", () => {
    expect(fp.facilitatorUpdate(fac, form())).toEqual({});
    expect(fp.facilitatorUpdate(fac, form({ first_name: " Asha ", phone: "", email: "Asha.New@Example.org " })))
      .toEqual({ first_name: "Asha", phone: null, email: "asha.new@example.org" });
    expect(fp.facilitatorUpdate({ ...fac, photo_url: "https://x.example.org/a.jpg" }, form())).toEqual({ photo_url: null });
  });
  it("checks the name, email and photo link", () => {
    expect(fp.formProblems(form())).toEqual({});
    expect(Object.keys(fp.formProblems(form({ name: " ", email: "nope", photo_url: "ftp://x" })))).toEqual(["name", "email", "photo_url"]);
    expect(fp.formProblems(form({ name: "asha@example.org" })).name).toMatch(/not an email/);
  });
});
