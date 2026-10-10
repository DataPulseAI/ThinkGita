// framer-sync: website text, readiness rules and the CMS field builder (pure helpers).
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import * as fs from "../../../supabase/functions/framer-sync/index.ts";
import { freeze, readyCircle, person } from "./helpers/circles.js";

const { F } = fs;
afterEach(() => vi.useRealTimers());

const SUMMER = "2026-07-15T12:00:00Z"; // Wednesday
const WINTER = "2026-01-14T12:00:00Z"; // Wednesday

describe("clock", () => {
  it.each([
    ["19:30:00", "7:30pm"], ["07:00", "7am"], ["00:15", "12:15am"], ["12:00", "12pm"], ["09:05:00", "9:05am"], ["23:59", "11:59pm"], ["00:00", "12am"],
  ])("%s -> %s", (t, want) => expect(fs.clock(t)).toBe(want));
});

describe("small formatters", () => {
  it("shortDate and utmDate", () => {
    expect(fs.shortDate("2026-10-18")).toBe("18 Oct");
    expect(fs.utmDate("2026-10-18")).toBe("18Oct26");
    expect(fs.utmDate("2027-01-05")).toBe("5Jan27");
  });
  it("listJoin", () => {
    expect(fs.listJoin([])).toBe("");
    expect(fs.listJoin(["A"])).toBe("A");
    expect(fs.listJoin(["A", "B"])).toBe("A & B");
    expect(fs.listJoin(["A", "B", "C"])).toBe("A, B & C");
  });
  it("langCode uses known codes, else the first three letters capitalised", () => {
    expect(fs.langCode("English")).toBe("Eng");
    expect(fs.langCode("Spanish")).toBe("Esp");
    expect(fs.langCode("Slovak")).toBe("Slk");
    expect(fs.langCode("Czech")).toBe("Cze");
    expect(fs.langCode("Norwegian")).toBe("Nor");
    expect(fs.langCode("bengali")).toBe("Ben");
    expect(fs.langCode("GERMAN")).toBe("Ger");
  });
  it("validTz", () => {
    expect(fs.validTz("Europe/Paris")).toBe(true);
    expect(fs.validTz("Mars/Base")).toBe(false);
    expect(fs.validTz("")).toBe(false);
    expect(fs.validTz(null)).toBe(false);
  });
  it("offsetMinutes", () => {
    expect(fs.offsetMinutes("Asia/Kolkata", new Date("2026-07-01T00:00:00Z"))).toBe(330);
    expect(fs.offsetMinutes("America/Chicago", new Date("2026-07-01T00:00:00Z"))).toBe(-300);
    expect(fs.offsetMinutes("America/Chicago", new Date("2026-01-01T00:00:00Z"))).toBe(-360);
    expect(fs.offsetMinutes("Europe/London", new Date("2026-01-01T00:00:00Z"))).toBe(0);
    expect(fs.offsetMinutes("Asia/Kathmandu", new Date("2026-01-01T00:00:00Z"))).toBe(345);
  });
  it("slugify strips accents and symbols", () => {
    expect(fs.slugify("Ánanda Rūpa & Co. - Mon 1930")).toBe("ananda-rupa-co-mon-1930");
    expect(fs.slugify("  --Hello__World--  ")).toBe("hello-world");
    expect(fs.slugify("!!!")).toBe("");
  });
});

describe("startDate", () => {
  it("uses starts_on first", () => expect(fs.startDate({ starts_on: "2026-10-01", preferred_start: "2026-09-01", status: "pending" })).toBe("2026-10-01"));
  it("uses preferred_start only while awaiting approval", () => {
    expect(fs.startDate({ preferred_start: "2026-11-01", status: "pending" })).toBe("2026-11-01");
    expect(fs.startDate({ preferred_start: "2026-11-01", status: "approved" })).toBe("2026-11-01");
    expect(fs.startDate({ preferred_start: "2026-11-01", status: "live" })).toBeNull();
    expect(fs.startDate({ preferred_start: "2026-11-01", status: "conflict" })).toBeNull();
  });
  it("null when nothing set", () => expect(fs.startDate({ status: "pending" })).toBeNull());
});

describe("localToday and nextSessionDate", () => {
  it("UK today differs from Los Angeles today late in the UK night", () => {
    freeze("2026-10-11T05:00:00Z"); // UK Sun 11 Oct 06:00, LA Sat 10 Oct 22:00
    expect(fs.localToday("Europe/London")).toBe("2026-10-11");
    expect(fs.localToday("America/Los_Angeles")).toBe("2026-10-10");
    expect(fs.localToday("Not/AZone")).toBe("2026-10-11");
  });
  it("Saturday session: today in LA, next week in the UK", () => {
    freeze("2026-10-11T05:00:00Z");
    expect(fs.nextSessionDate({ weekday: 6, timezone: "America/Los_Angeles", status: "live" })).toBe("2026-10-10");
    expect(fs.nextSessionDate({ weekday: 6, timezone: "Europe/London", status: "live" })).toBe("2026-10-17");
  });
  it("same weekday as today returns today, others roll forward", () => {
    freeze("2026-10-10T12:00:00Z"); // Saturday
    expect(fs.nextSessionDate({ weekday: 6, timezone: "Europe/London", status: "live" })).toBe("2026-10-10");
    expect(fs.nextSessionDate({ weekday: 7, timezone: "Europe/London", status: "live" })).toBe("2026-10-11");
    expect(fs.nextSessionDate({ weekday: 1, timezone: "Europe/London", status: "live" })).toBe("2026-10-12");
    expect(fs.nextSessionDate({ weekday: 5, timezone: "Europe/London", status: "live" })).toBe("2026-10-16");
  });
  it("future start date wins, past start date is ignored", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(fs.nextSessionDate({ weekday: 3, timezone: "Europe/London", status: "pending", preferred_start: "2026-11-04" })).toBe("2026-11-04");
    expect(fs.nextSessionDate({ weekday: 3, timezone: "Europe/London", status: "live", starts_on: "2026-09-02" })).toBe("2026-10-14");
    expect(fs.nextSessionDate({ weekday: 6, timezone: "Europe/London", status: "live", starts_on: "2026-10-10" })).toBe("2026-10-10");
  });
});

describe("tzLabel", () => {
  const c = (timezone, weekday, start_time = "10:30:00", over = {}) => ({ timezone, weekday, start_time, status: "live", ...over });

  it.each([
    ["Europe/Paris", "CEST", "CET"], ["Europe/Berlin", "CEST", "CET"], ["Europe/Bratislava", "CEST", "CET"],
    ["Europe/Athens", "EEST", "EET"], ["Europe/Helsinki", "EEST", "EET"], ["Europe/Lisbon", "WEST", "WET"],
  ])("%s: summer %s, winter %s", (tz, summer, winter) => {
    freeze(SUMMER);
    expect(fs.tzLabel(c(tz, 3))).toBe(summer);
    freeze(WINTER);
    expect(fs.tzLabel(c(tz, 3))).toBe(winter);
  });

  it.each([
    ["Pacific/Auckland", "NZDT", "NZST"], ["Australia/Adelaide", "ACDT", "ACST"],
  ])("southern hemisphere %s: January %s, July %s", (tz, jan, jul) => {
    freeze(WINTER);
    expect(fs.tzLabel(c(tz, 3))).toBe(jan);
    freeze(SUMMER);
    expect(fs.tzLabel(c(tz, 3))).toBe(jul);
  });

  describe("around the European switch dates", () => {
    it.each(["Europe/Paris", "Europe/Athens", "Europe/Lisbon"])("%s autumn: Saturday 24 Oct summer, Sunday 25 Oct winter", (tz) => {
      freeze("2026-10-24T12:00:00Z");
      const [, w, s] = fs.TZ_DST[tz];
      expect(fs.tzLabel(c(tz, 6))).toBe(s);
      expect(fs.tzLabel(c(tz, 7))).toBe(w);
    });
    it.each(["Europe/Paris", "Europe/Athens", "Europe/Lisbon"])("%s spring: Saturday 28 Mar winter, Sunday 29 Mar summer", (tz) => {
      freeze("2026-03-28T12:00:00Z");
      const [, w, s] = fs.TZ_DST[tz];
      expect(fs.tzLabel(c(tz, 6))).toBe(w);
      expect(fs.tzLabel(c(tz, 7))).toBe(s);
    });
  });

  describe("around the southern switch dates", () => {
    it("Auckland April: Sat 4 Apr NZDT, Sun 5 Apr NZST", () => {
      freeze("2026-04-03T12:00:00Z"); // Auckland Sat 4 Apr 01:00
      expect(fs.tzLabel(c("Pacific/Auckland", 6))).toBe("NZDT");
      expect(fs.tzLabel(c("Pacific/Auckland", 7))).toBe("NZST");
    });
    it("Auckland September: Sat 26 Sep NZST, Sun 27 Sep NZDT", () => {
      freeze("2026-09-25T12:00:00Z"); // Auckland Sat 26 Sep 00:00
      expect(fs.tzLabel(c("Pacific/Auckland", 6))).toBe("NZST");
      expect(fs.tzLabel(c("Pacific/Auckland", 7))).toBe("NZDT");
    });
    it("Adelaide April: Sat 4 Apr ACDT, Sun 5 Apr ACST", () => {
      freeze("2026-04-03T12:00:00Z");
      expect(fs.tzLabel(c("Australia/Adelaide", 6))).toBe("ACDT");
      expect(fs.tzLabel(c("Australia/Adelaide", 7))).toBe("ACST");
    });
    it("Adelaide October: Sat 3 Oct ACST, Sun 4 Oct ACDT", () => {
      freeze("2026-10-02T12:00:00Z");
      expect(fs.tzLabel(c("Australia/Adelaide", 6))).toBe("ACST");
      expect(fs.tzLabel(c("Australia/Adelaide", 7))).toBe("ACDT");
    });
  });

  it("uses the season of a future start date, not of today", () => {
    freeze(SUMMER);
    expect(fs.tzLabel(c("Europe/Paris", 3, "19:00", { status: "pending", preferred_start: "2026-11-04" }))).toBe("CET");
    freeze(WINTER);
    expect(fs.tzLabel(c("Europe/Paris", 3, "19:00", { status: "pending", preferred_start: "2026-06-03" }))).toBe("CEST");
  });

  it("falls back to the winter label without a weekday or time", () => {
    freeze(SUMMER);
    expect(fs.tzLabel({ timezone: "Europe/Paris" })).toBe("CET");
    expect(fs.tzLabel({ timezone: "Europe/Paris", weekday: 3 })).toBe("CET");
  });

  it.each([
    ["Europe/London", "UK"], ["America/Chicago", "CT"], ["America/Mexico_City", "CDMX"], ["America/Guayaquil", "ECT"],
    ["America/New_York", "ET"], ["Asia/Kolkata", "IST"], ["Australia/Sydney", "AET"], ["Europe/Moscow", "MSK"],
  ])("fixed label %s -> %s in summer and winter", (tz, label) => {
    freeze(SUMMER);
    expect(fs.tzLabel(c(tz, 3))).toBe(label);
    freeze(WINTER);
    expect(fs.tzLabel(c(tz, 3))).toBe(label);
  });

  it.each([
    ["Asia/Kuala_Lumpur", "Kuala Lumpur"], ["America/Indiana/Indianapolis", "Indianapolis"], ["Mars/Base", "Base"], [null, ""], [undefined, ""],
  ])("unknown zone %s -> %s", (tz, label) => {
    freeze(SUMMER);
    expect(fs.tzLabel(c(tz, 3))).toBe(label);
  });
});

describe("title", () => {
  it.each([
    [{}, "Gita Circles (English)"],
    [{ language: "Slovak" }, "Gita Circles (Slovak)"],
    [{ language: "Spanish" }, "Gita Circulos (Espanol)"],
    [{ language: "Spanish", circle_type: "Bhakti Circle" }, "Bhakti Circles (Spanish)"],
    [{ circle_type: "Bhakti" }, "Bhakti Circles (English)"],
    [{ circle_type: "Think Sadhana" }, "Think Sadhana (English)"],
    [{ circle_type: "Gita for Beginners", language: "Hindi" }, "Gita Beginners (Hindi)"],
    [{ circle_type: "beginners bhakti" }, "Gita Beginners (English)"],
    [{ circle_type: "Gita Reading" }, "Gita Reading Circle (English)"],
    [{ circle_type: "Morning japa", language: "Greek" }, "Morning Japa (Greek)"],
    [{ circle_type: "Gita Circle", language: "Polish" }, "Gita Circles (Polish)"],
  ])("%j -> %s", (c, want) => expect(fs.title(c)).toBe(want));
});

describe("timeText and lessonText", () => {
  it("timeText combines clock, label and plural weekday", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(fs.timeText({ timezone: "Europe/Paris", weekday: 7, start_time: "10:30:00", status: "live" })).toBe("10:30am CEST | Sundays");
    expect(fs.timeText({ timezone: "Europe/London", weekday: 3, start_time: "19:30:00", status: "live" })).toBe("7:30pm UK | Wednesdays");
    freeze(WINTER);
    expect(fs.timeText({ timezone: "Europe/Paris", weekday: 7, start_time: "10:30:00", status: "live" })).toBe("10:30am CET | Sundays");
  });
  it("future start shows Starts, started or running shows Join anytime", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(fs.lessonText({ status: "pending", preferred_start: "2026-10-18", timezone: "Europe/London" })).toBe("Starts 18 Oct");
    expect(fs.lessonText({ status: "live", starts_on: "2026-10-18", timezone: "Europe/London" })).toBe("Starts 18 Oct");
    expect(fs.lessonText({ status: "live", starts_on: "2026-10-10", timezone: "Europe/London" })).toBe("Join anytime");
    expect(fs.lessonText({ status: "live", starts_on: "2026-09-01", timezone: "Europe/London" })).toBe("Join anytime");
    expect(fs.lessonText({ status: "live", timezone: "Europe/London" })).toBe("Join anytime");
    expect(fs.lessonText({ status: "paused", timezone: "Europe/London" })).toBe("Join anytime");
  });
  it("start day is judged in the circle's own zone", () => {
    freeze("2026-10-11T05:00:00Z"); // UK 11 Oct, LA still 10 Oct
    expect(fs.lessonText({ status: "approved", starts_on: "2026-10-11", timezone: "America/Los_Angeles" })).toBe("Starts 11 Oct");
    expect(fs.lessonText({ status: "approved", starts_on: "2026-10-11", timezone: "Europe/London" })).toBe("Join anytime");
  });
});

describe("hostNames, hostName, displayName", () => {
  it("imported TG names use the name segment", () => {
    expect(fs.hostNames({ name: "TG Circles | Mon | 7.30pm UK | Anjali", facilitator: person() })).toEqual(["Anjali"]);
    expect(fs.hostNames({ name: "tg circles | Tue | 8pm | Spanish | Maria  Lopez" })).toEqual(["Maria Lopez"]);
    expect(fs.hostNames({ name: "TG | Wed | 7pm | Asha | Ravi" })).toEqual(["Asha & Ravi"]);
  });
  it("automatic names and short or non TG names use the facilitators", () => {
    expect(fs.hostNames({ name: "TG Circles | Mon | 7.30pm UK | Anjali", name_auto: true, facilitator: person() })).toEqual(["Asha Example"]);
    expect(fs.hostNames({ name: "TG Circles | Anjali", facilitator: person() })).toEqual(["Asha Example"]);
    expect(fs.hostNames({ name: "Gita Circles | Mon | Anjali", facilitator: person() })).toEqual(["Asha Example"]);
    // Every remaining segment has a digit or is a language: fall back to people.
    expect(fs.hostNames({ name: "TG | Mon | 7pm | English", facilitator: person() })).toEqual(["Asha Example"]);
  });
  it("initiated name beats name, emails are left out, co-facilitators follow", () => {
    const c = {
      name: "x", facilitator: person({ initiated_name: "Ananda-rupa das" }),
      cofacilitators: [{ facilitator: person({ name: "Bela Example" }) }, { facilitator: person({ name: "c@example.org" }) }, { facilitator: null }, { facilitator: person({ name: " Chitra Example " }) }],
    };
    expect(fs.hostNames(c)).toEqual(["Ananda-rupa das", "Bela Example", "Chitra Example"]);
    expect(fs.hostName(c)).toBe("Ananda-rupa das & Bela Example & Chitra Example");
    expect(fs.displayName(c)).toBe("Ananda-rupa das, Bela Example & Chitra Example");
  });
  it("empty when nobody has a usable name", () => {
    const c = { name: "", facilitator: person({ name: "only@example.org" }) };
    expect(fs.hostNames(c)).toEqual([]);
    expect(fs.hostName(c)).toBe("Think Gita facilitator");
    expect(fs.displayName(c)).toBe("");
  });
  it("website_name overrides the card name only", () => {
    const c = { name: "", website_name: "  Isvara  ", facilitator: person() };
    expect(fs.displayName(c)).toBe("Isvara");
    expect(fs.hostName(c)).toBe("Asha Example");
    expect(fs.displayName({ ...c, website_name: "   " })).toBe("Asha Example");
  });
});

describe("photoFor", () => {
  it("circle photo, then facilitator photo, else null", () => {
    expect(fs.photoFor({ website_photo_url: " https://img.example.org/c.jpg ", facilitator: person() })).toBe("https://img.example.org/c.jpg");
    expect(fs.photoFor({ website_photo_url: "  ", facilitator: person() })).toBe("https://img.example.org/asha.jpg");
    expect(fs.photoFor({ facilitator: person({ photo_url: "" }) })).toBeNull();
    expect(fs.photoFor({})).toBeNull();
  });
});

describe("link", () => {
  it("builds the signup link with encoded name, codes, date and WhatsApp last", () => {
    const c = readyCircle({ facilitator: person({ initiated_name: "Ananda-rupa Krsna das" }), whatsapp_group_link: " https://chat.whatsapp.com/ABC?x=1 ", starts_on: "2026-10-18" });
    const url = fs.link(c);
    expect(url).toBe("https://forms.thinkgita.org/circlesignup?utm_facilitator=Ananda-rupa%20Krsna%20das&utm_course=Circle&utm_lang=Eng&utm_date=18Oct26&utm_wagrp=https://chat.whatsapp.com/ABC?x=1");
    expect(url.split("&").pop().startsWith("utm_wagrp=")).toBe(true);
  });
  it("encodes ampersands in co-facilitator names", () => {
    const c = readyCircle({ cofacilitators: [{ facilitator: person({ name: "Bela Example" }) }] });
    expect(fs.link(c)).toContain("utm_facilitator=Asha%20Example%20%26%20Bela%20Example&");
  });
  it("beginners course and language codes, including derived ones", () => {
    expect(fs.link(readyCircle({ circle_type: "Beginners", language: "Spanish" }))).toContain("utm_course=Beg&utm_lang=Esp");
    expect(fs.link(readyCircle({ language: "Tamil" }))).toContain("utm_lang=Tam");
    expect(fs.link(readyCircle({ language: "Croatian" }))).toContain("utm_lang=Cro");
    expect(fs.link(readyCircle({ language: null }))).toContain("utm_lang=Eng");
  });
  it("leaves out date and WhatsApp when unknown", () => {
    const url = fs.link(readyCircle({ starts_on: null, whatsapp_group_link: null }));
    expect(url).not.toContain("utm_date");
    expect(url).not.toContain("utm_wagrp");
  });
  it("uses the preferred start for pending circles", () => {
    expect(fs.link(readyCircle({ status: "pending", starts_on: null, preferred_start: "2026-11-04" }))).toContain("utm_date=4Nov26");
  });
});

describe("hasFrom", () => {
  const item = (fd) => ({ id: "it", fieldData: fd });
  it("empty for no item", () => expect(fs.hasFrom(null)).toEqual({}));
  it("reads photo, order, name, WhatsApp and link from the item", () => {
    const it2 = item({
      [F.authorImg]: { type: "image", value: { url: "https://framerusercontent.com/x.png" } },
      [F.lessonNumber]: { type: "string", value: " 4 " }, [F.author]: { type: "string", value: "Isvara" },
      [F.link]: { type: "link", value: "https://forms.thinkgita.org/circlesignup?utm_wagrp=https://chat.whatsapp.com/Z" },
    });
    expect(fs.hasFrom(it2)).toEqual({ photo: true, order: true, name: true, whatsapp: true, link: true });
  });
  it("blank values count as not set, link without WhatsApp", () => {
    const it2 = item({ [F.lessonNumber]: { value: "  " }, [F.author]: { value: "" }, [F.link]: { value: "https://forms.thinkgita.org/circlesignup?utm_lang=Eng" } });
    expect(fs.hasFrom(it2)).toEqual({ photo: false, order: false, name: false, whatsapp: false, link: true });
  });
});

describe("websiteMissing", () => {
  afterEach(() => vi.useRealTimers());
  const at = () => freeze("2026-10-10T12:00:00Z");

  it("a complete live circle has nothing missing", () => { at(); expect(fs.websiteMissing(readyCircle())).toEqual([]); });

  it.each([
    ["photo", { facilitator: person({ photo_url: null }) }],
    ["display name", { facilitator: person({ name: "x@example.org" }) }],
    ["WhatsApp group link", { whatsapp_group_link: null }],
    ["WhatsApp group link", { whatsapp_group_link: "chat.whatsapp.com/ABC" }],
    ["WhatsApp group link", { whatsapp_group_link: "https://chat.whatsapp.com/A B" }],
    ["weekday", { weekday: null }],
    ["weekday", { weekday: 8 }],
    ["weekday", { weekday: 0 }],
    ["start time", { start_time: null }],
    ["timezone", { timezone: "Mars/Base" }],
    ["timezone", { timezone: null }],
    ["language", { language: "" }],
    ["website order", { website_order: 0 }],
    ["website order", { website_order: null }],
  ])("missing %s", (label, over) => {
    at();
    expect(fs.websiteMissing(readyCircle(over))).toEqual([label]);
  });

  it("start date rules for circles not yet running", () => {
    at();
    expect(fs.websiteMissing(readyCircle({ status: "pending", starts_on: null }))).toEqual(["start date"]);
    expect(fs.websiteMissing(readyCircle({ status: "pending", starts_on: null, preferred_start: "2026-10-09" }))).toEqual(["start date (it is in the past)"]);
    expect(fs.websiteMissing(readyCircle({ status: "approved", starts_on: null, preferred_start: "2026-10-10" }))).toEqual([]);
    expect(fs.websiteMissing(readyCircle({ status: "approved", starts_on: "2026-11-01" }))).toEqual([]);
    expect(fs.websiteMissing(readyCircle({ status: "live", starts_on: "2020-01-01" }))).toEqual([]);
    expect(fs.websiteMissing(readyCircle({ status: "paused", starts_on: null }))).toEqual([]);
  });

  it("past start is judged in the circle's zone", () => {
    freeze("2026-10-11T05:00:00Z"); // LA still 10 Oct
    const c = readyCircle({ status: "pending", starts_on: null, preferred_start: "2026-10-10" });
    expect(fs.websiteMissing({ ...c, timezone: "America/Los_Angeles" })).toEqual([]);
    expect(fs.websiteMissing({ ...c, timezone: "Europe/London" })).toEqual(["start date (it is in the past)"]);
  });

  it("framer_has fills photo, name, WhatsApp and order", () => {
    at();
    const bare = readyCircle({ facilitator: null, whatsapp_group_link: null, website_order: null });
    expect(fs.websiteMissing(bare)).toEqual(["photo", "display name", "WhatsApp group link", "website order"]);
    expect(fs.websiteMissing({ ...bare, framer_has: { photo: true, name: true, whatsapp: true, order: true } })).toEqual([]);
    // The explicit `has` argument wins over circles.framer_has.
    expect(fs.websiteMissing({ ...bare, framer_has: { photo: true, name: true, whatsapp: true, order: true } }, {})).toHaveLength(4);
  });

  it("hand-made items (taken over, with a link) skip the start date", () => {
    at();
    const c = readyCircle({ status: "pending", starts_on: null, framer_created: false });
    expect(fs.websiteMissing(c, { link: true })).toEqual([]);
    expect(fs.websiteMissing({ ...c, preferred_start: "2026-01-01" }, { link: true })).toEqual([]);
    // Items the sync created manage their own start date.
    expect(fs.websiteMissing({ ...c, framer_created: true }, { link: true })).toEqual(["start date"]);
    expect(fs.websiteMissing(c, { link: false })).toEqual(["start date"]);
  });

  it("lists every reason in a fixed order", () => {
    at();
    expect(fs.websiteMissing({ status: "pending" })).toEqual(["photo", "display name", "WhatsApp group link", "start date", "weekday", "start time", "timezone", "language", "website order"]);
  });
});

describe("fieldsFor", () => {
  afterEach(() => vi.useRealTimers());
  const item = (fd, over = {}) => ({ id: "item-1", slug: "x", draft: false, fieldData: fd, ...over });
  const handMade = () => item({
    [F.title]: { type: "string", value: "Gita Circles (English)" }, [F.author]: { type: "string", value: "Hand Name" },
    [F.authorImg]: { type: "image", value: { url: "https://framerusercontent.com/hand.png" } },
    [F.link]: { type: "link", value: "https://forms.thinkgita.org/circlesignup?utm_facilitator=Hand" },
  });

  it("new item gets every field", () => {
    freeze("2026-10-10T12:00:00Z");
    const f = fs.fieldsFor(readyCircle());
    expect(Object.keys(f).sort()).toEqual([F.time, F.lesson, F.lessonNumber, F.authorImg, F.title, F.description, F.link, F.mainImg, F.author].sort());
    expect(f[F.time]).toEqual({ type: "string", value: "7:30pm UK | Wednesdays" });
    expect(f[F.lesson].value).toBe("Join anytime");
    expect(f[F.lessonNumber].value).toBe("2");
    expect(f[F.authorImg]).toEqual({ type: "image", value: "https://img.example.org/asha.jpg" });
    expect(f[F.title].value).toBe("Gita Circles (English)");
    expect(f[F.author].value).toBe("Asha Example");
    expect(f[F.mainImg].value).toBe(fs.BANNER.other);
    expect(f[F.link].type).toBe("link");
    expect(f[F.description].value).toBe(fs.DESCRIPTION);
  });

  it("Spanish circles get the Spanish banner", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(fs.fieldsFor(readyCircle({ language: "Spanish" }))[F.mainImg].value).toBe(fs.BANNER.spanish);
  });

  it("never sends empty values", () => {
    freeze("2026-10-10T12:00:00Z");
    const f = fs.fieldsFor(readyCircle({ facilitator: null, website_order: null, starts_on: null, status: "pending" }));
    expect(f[F.author]).toBeUndefined();
    expect(f[F.lessonNumber]).toBeUndefined();
    expect(f[F.authorImg]).toBeUndefined();
    expect(f[F.lesson]).toBeUndefined();
    for (const v of Object.values(f)) expect(v.value === "" || v.value == null).toBe(false);
  });

  it("taken-over item keeps its title, name, link and photo", () => {
    freeze("2026-10-10T12:00:00Z");
    const f = fs.fieldsFor(readyCircle({ framer_created: false }), handMade());
    expect(Object.keys(f).sort()).toEqual([F.time, F.lesson, F.lessonNumber].sort());
  });

  it("taken-over item gets the website name when one is set", () => {
    freeze("2026-10-10T12:00:00Z");
    const f = fs.fieldsFor(readyCircle({ website_name: "Isvara" }), handMade());
    expect(f[F.author].value).toBe("Isvara");
  });

  it("taken-over item without a link gets one", () => {
    freeze("2026-10-10T12:00:00Z");
    const ex = handMade();
    delete ex.fieldData[F.link];
    expect(fs.fieldsFor(readyCircle(), ex)[F.link].value).toMatch(/^https:\/\/forms\.thinkgita\.org\/circlesignup\?/);
  });

  it("Lesson rule: hand-made items of circles not yet live keep their own Lesson text", () => {
    freeze("2026-10-10T12:00:00Z");
    const pending = readyCircle({ status: "pending", starts_on: null, preferred_start: "2026-10-18" });
    expect(fs.fieldsFor(pending, handMade())[F.lesson]).toBeUndefined();
    expect(fs.fieldsFor(pending)[F.lesson].value).toBe("Starts 18 Oct");
    expect(fs.fieldsFor({ ...pending, framer_created: true }, handMade())[F.lesson].value).toBe("Starts 18 Oct");
    expect(fs.fieldsFor(readyCircle({ status: "paused", starts_on: null }), handMade())[F.lesson].value).toBe("Join anytime");
  });

  describe("photo resend logic", () => {
    const photo = "https://img.example.org/asha.jpg";
    it("item without a photo always gets one", () => {
      freeze("2026-10-10T12:00:00Z");
      const ex = handMade();
      delete ex.fieldData[F.authorImg];
      expect(fs.fieldsFor(readyCircle(), ex)[F.authorImg].value).toBe(photo);
    });
    it("own item: resent only when the photo differs from framer_photo_src", () => {
      freeze("2026-10-10T12:00:00Z");
      expect(fs.fieldsFor(readyCircle({ framer_created: true, framer_photo_src: photo }), handMade())[F.authorImg]).toBeUndefined();
      expect(fs.fieldsFor(readyCircle({ framer_created: true, framer_photo_src: "https://img.example.org/old.jpg" }), handMade())[F.authorImg].value).toBe(photo);
    });
    it("taken-over item: only an explicit circle photo replaces the hand-made one", () => {
      freeze("2026-10-10T12:00:00Z");
      expect(fs.fieldsFor(readyCircle({ framer_photo_src: null }), handMade())[F.authorImg]).toBeUndefined();
      const own = "https://img.example.org/group.jpg";
      expect(fs.fieldsFor(readyCircle({ website_photo_url: own }), handMade())[F.authorImg].value).toBe(own);
      expect(fs.fieldsFor(readyCircle({ website_photo_url: own, framer_photo_src: own }), handMade())[F.authorImg]).toBeUndefined();
    });
  });
});

describe("changedFields", () => {
  it("no existing item: everything", () => {
    const f = { a: { type: "string", value: "x" } };
    expect(fs.changedFields(f, null)).toBe(f);
  });
  it("only differing values, images only when missing (or the author photo)", () => {
    const ex = { fieldData: {
      [F.time]: { value: "7:30pm UK | Wednesdays" }, [F.title]: { value: "Old title" },
      [F.mainImg]: { value: { url: "https://framerusercontent.com/banner.png" } },
      [F.link]: { value: "https://forms.thinkgita.org/circlesignup?a=1" },
    } };
    const f = {
      [F.time]: { type: "string", value: "7:30pm UK | Wednesdays" }, [F.title]: { type: "string", value: "New title" },
      [F.mainImg]: { type: "image", value: fs.BANNER.other }, [F.authorImg]: { type: "image", value: "https://img.example.org/a.jpg" },
      [F.link]: { type: "link", value: "https://forms.thinkgita.org/circlesignup?a=1" }, [F.author]: { type: "string", value: "Asha" },
    };
    expect(Object.keys(fs.changedFields(f, ex)).sort()).toEqual([F.title, F.authorImg, F.author].sort());
    delete ex.fieldData[F.mainImg];
    expect(fs.changedFields(f, ex)[F.mainImg]).toBeDefined();
  });
});

describe("isTest, wantsItem, wantsShown, draftFor, readinessNote", () => {
  afterEach(() => vi.useRealTimers());
  it("isTest", () => {
    expect(Boolean(fs.isTest({ is_demo: true }))).toBe(true);
    expect(Boolean(fs.isTest({ name: "My TEST circle" }))).toBe(true);
    expect(Boolean(fs.isTest({ name: "Testing circle" }))).toBe(false);
    expect(Boolean(fs.isTest({ name: "Contest" }))).toBe(false);
    expect(Boolean(fs.isTest({ name: "x", licence: { is_mock: true } }))).toBe(true);
    expect(Boolean(fs.isTest({ name: "x", licence: null }))).toBe(false);
  });
  it("wantsItem", () => {
    expect(Boolean(fs.wantsItem({ status: "live" }))).toBe(true);
    expect(Boolean(fs.wantsItem({ status: "paused" }))).toBe(true);
    expect(Boolean(fs.wantsItem({ status: "pending" }))).toBe(false);
    expect(Boolean(fs.wantsItem({ status: "pending", website_visible: true }))).toBe(true);
    expect(Boolean(fs.wantsItem({ status: "approved", website_visible: true }))).toBe(true);
    expect(Boolean(fs.wantsItem({ status: "conflict", website_visible: true }))).toBe(false);
    expect(Boolean(fs.wantsItem({ status: "ended", website_visible: true }))).toBe(false);
    expect(Boolean(fs.wantsItem({ status: "live", is_demo: true }))).toBe(false);
  });
  it("wantsShown", () => {
    expect(fs.wantsShown({ status: "live", website_visible: true })).toBe(true);
    expect(fs.wantsShown({ status: "live", website_visible: false })).toBe(false);
    expect(fs.wantsShown({ status: "paused", website_visible: true })).toBe(false);
    expect(fs.wantsShown({ status: "pending", website_visible: true })).toBe(true);
    expect(fs.wantsShown({ status: "live", website_visible: true, name: "test" })).toBe(false);
  });
  it("draftFor and readinessNote", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(fs.draftFor(readyCircle())).toBe(false);
    expect(fs.readinessNote(readyCircle())).toBeNull();
    expect(fs.draftFor(readyCircle({ website_visible: false }))).toBe(true);
    expect(fs.readinessNote(readyCircle({ website_visible: false, whatsapp_group_link: null }))).toBeNull();
    const held = readyCircle({ whatsapp_group_link: null, website_order: null });
    expect(fs.draftFor(held)).toBe(true);
    expect(fs.readinessNote(held)).toBe("Not shown on the website until set: WhatsApp group link, website order");
    expect(fs.draftFor(held, { whatsapp: true, order: true })).toBe(false);
    expect(fs.readinessNote(held, { whatsapp: true, order: true })).toBeNull();
  });
});
