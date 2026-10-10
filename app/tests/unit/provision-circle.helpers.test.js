// provision-circle: date helpers, attendance merge and Zoom UUID encoding (pure helpers).
import { describe, it, expect, afterEach, vi } from "vitest";
import * as pc from "../../../supabase/functions/provision-circle/index.ts";
import { freeze } from "./helpers/circles.js";

afterEach(() => vi.useRealTimers());

describe("endUtc: 23:59 on the last day in the circle's zone, as UTC", () => {
  it.each([
    ["2026-07-01", "America/Chicago", "2026-07-02T04:59:00Z"],
    ["2026-12-14", "America/Chicago", "2026-12-15T05:59:00Z"],
    ["2026-07-01", "Asia/Kolkata", "2026-07-01T18:29:00Z"],
    ["2026-12-14", "Asia/Kolkata", "2026-12-14T18:29:00Z"],
    ["2026-12-14", "Europe/London", "2026-12-14T23:59:00Z"],
    ["2026-07-01", "Europe/London", "2026-07-01T22:59:00Z"],
    ["2026-07-01", "America/Los_Angeles", "2026-07-02T06:59:00Z"],
    // DST edges
    ["2026-03-29", "Europe/London", "2026-03-29T22:59:00Z"],
    ["2026-10-25", "Europe/London", "2026-10-25T23:59:00Z"],
    ["2026-03-08", "America/Chicago", "2026-03-09T04:59:00Z"],
    ["2026-11-01", "America/Chicago", "2026-11-02T05:59:00Z"],
    ["2026-03-28", "Europe/Paris", "2026-03-28T22:59:00Z"],
    ["2026-10-24", "Europe/Paris", "2026-10-24T21:59:00Z"],
  ])("%s in %s -> %s", (d, tz, want) => expect(pc.endUtc(d, tz)).toBe(want));

  it("no zone means London, unknown zone means UTC", () => {
    expect(pc.endUtc("2026-07-01", null)).toBe("2026-07-01T22:59:00Z");
    expect(pc.endUtc("2026-07-01")).toBe("2026-07-01T22:59:00Z");
    expect(pc.endUtc("2026-07-01", "Mars/Base")).toBe("2026-07-01T23:59:00Z");
  });

  // Bug: the offset is read at "23:59 UTC" instead of "23:59 local". For zones far east of UTC that change clocks
  // on that evening (Auckland, Adelaide, Sydney), the result is an hour off. On 26 Sep 2026 Auckland is still on
  // NZST (+12) at 23:59 local, so the series should end at 11:59Z, but endUtc gives 10:59Z, which would cut off a
  // Saturday session between 23:00 and 23:59 local on a term's last day. Low impact.
  it.fails("is exact on a far-east switch day (Auckland 26 Sep 2026)", () => {
    expect(pc.endUtc("2026-09-26", "Pacific/Auckland")).toBe("2026-09-26T11:59:00Z");
  });
});

describe("ukToday and localToday", () => {
  it("UK date late in the evening, summer and winter", () => {
    freeze("2026-07-01T23:30:00Z"); // 00:30 BST on 2 Jul
    expect(pc.ukToday()).toBe("2026-07-02");
    freeze("2026-01-01T23:30:00Z"); // 23:30 GMT
    expect(pc.ukToday()).toBe("2026-01-01");
  });
  it("circle's own date", () => {
    freeze("2026-07-02T03:00:00Z");
    expect(pc.localToday("America/Los_Angeles")).toBe("2026-07-01");
    expect(pc.localToday("Asia/Kolkata")).toBe("2026-07-02");
    expect(pc.localToday(null)).toBe("2026-07-02");
    expect(pc.localToday("Mars/Base")).toBe("2026-07-02"); // falls back to UK
    freeze("2026-07-01T20:00:00Z");
    expect(pc.localToday("Pacific/Auckland")).toBe("2026-07-02");
  });
});

describe("firstOccurrence", () => {
  it.each([
    [6, "2026-10-10"], [7, "2026-10-11"], [1, "2026-10-12"], [5, "2026-10-16"], [3, "2026-10-14"],
  ])("from Sat 10 Oct, weekday %i -> %s", (wd, want) => expect(pc.firstOccurrence("2026-10-10", wd)).toBe(want));
  it("crosses month and year ends", () => {
    expect(pc.firstOccurrence("2026-12-31", 1)).toBe("2027-01-04");
    expect(pc.firstOccurrence("2026-10-31", 7)).toBe("2026-11-01");
  });
  it("unaffected by DST change weekends", () => {
    expect(pc.firstOccurrence("2026-10-24", 7)).toBe("2026-10-25");
    expect(pc.firstOccurrence("2026-03-28", 1)).toBe("2026-03-30");
  });
});

describe("weeksBetween", () => {
  it("counts sessions inclusive of both ends", () => {
    expect(pc.weeksBetween("2026-01-05", "2026-01-05")).toBe(1);
    expect(pc.weeksBetween("2026-01-05", "2026-01-11")).toBe(1);
    expect(pc.weeksBetween("2026-01-05", "2026-01-12")).toBe(2);
    expect(pc.weeksBetween("2026-01-05", "2026-12-21")).toBe(51);
    expect(pc.weeksBetween("2026-03-23", "2026-03-30")).toBe(2); // across the UK clock change
  });
});

describe("isoDate", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => expect(pc.isoDate(new Date("2026-10-10T23:59:59Z"))).toBe("2026-10-10"));
});

describe("encUuid", () => {
  it("encodes once normally", () => expect(pc.encUuid("abc+def==")).toBe("abc%2Bdef%3D%3D"));
  it("encodes twice when it starts with a slash or contains a double slash", () => {
    expect(pc.encUuid("/abc")).toBe("%252Fabc");
    expect(pc.encUuid("ab//cd")).toBe("ab%252F%252Fcd");
  });
  it("a single slash inside is encoded once", () => expect(pc.encUuid("ab/cd")).toBe("ab%2Fcd"));
});

describe("mergePeople", () => {
  it("merges rejoins by email (case-insensitive), keeping first join, last leave and total time", () => {
    const out = pc.mergePeople([
      { name: "Asha", user_email: "Asha@Example.org", join_time: "2026-10-01T18:05:00Z", leave_time: "2026-10-01T18:30:00Z", duration: 1500 },
      { name: "Asha (phone)", user_email: "asha@example.org ", join_time: "2026-10-01T18:00:00Z", leave_time: "2026-10-01T18:02:00Z", duration: 120 },
      { name: "Asha", user_email: "asha@example.org", join_time: "2026-10-01T18:35:00Z", leave_time: "2026-10-01T19:00:00Z", duration: "1500" },
    ]);
    expect(out).toEqual([{ person_key: "asha@example.org", name: "Asha", email: "asha@example.org", first_join: "2026-10-01T18:00:00Z", last_leave: "2026-10-01T19:00:00Z", seconds: 3120 }]);
  });
  it("without email, matches by name ignoring case and extra spaces", () => {
    const out = pc.mergePeople([
      { name: "Ravi  Example", duration: 60, join_time: "a" },
      { name: "ravi example", duration: 30, join_time: "b" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ person_key: "ravi example", name: "Ravi  Example", email: null, seconds: 90 });
  });
  it("skips the waiting room and nameless rows, fills a missing name later", () => {
    const out = pc.mergePeople([
      { name: "Lobby Person", status: "in_waiting_room", duration: 999 },
      { name: "", user_email: "" },
      { name: "", user_email: "b@example.org", duration: 10 },
      { name: "Bela", user_email: "b@example.org", duration: 5 },
    ]);
    expect(out).toEqual([expect.objectContaining({ person_key: "b@example.org", name: "Bela", seconds: 15 })]);
  });
  it("missing duration counts as zero", () => expect(pc.mergePeople([{ name: "X" }])[0].seconds).toBe(0));
});

describe("constants", () => {
  it("Zoom day names are Sunday first", () => {
    expect(pc.ZOOM_DAYS[1]).toBe("Sunday");
    expect(pc.ZOOM_DAYS[2]).toBe("Monday");
    expect(pc.ZOOM_DAYS[7]).toBe("Saturday");
  });
  it("reschedulable fields", () => expect(pc.RESCHEDULE_FIELDS).toEqual(["weekday", "start_time", "duration_min", "timezone", "preferred_start"]));
});
