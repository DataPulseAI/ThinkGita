// signups: the circle sign-up form's answers and linking each sign-up to its circle. Made-up people only.
import { describe, it, expect } from "vitest";
import * as su from "../../../supabase/functions/signups/index.ts";

// A webhook submission as Tally sends it (labels from the live form, values made up).
const webhookFields = (hidden = {}) => [
  ...Object.entries(hidden).map(([k, v]) => ({ key: `h_${k}`, label: k, type: "HIDDEN_FIELDS", value: v })),
  { key: "q1", label: "First Name", type: "INPUT_TEXT", value: "Mira" },
  { key: "q2", label: "Last Name", type: "INPUT_TEXT", value: "Example" },
  { key: "q3", label: "WhatsApp Number", type: "INPUT_PHONE_NUMBER", value: "+447700900123" },
  { key: "q4", label: "Email Address", type: "INPUT_EMAIL", value: "Mira@Example.org " },
  { key: "q5", label: "Date of Birth", type: "INPUT_DATE", value: "1990-05-04" },
  { key: "q6", label: "City you're based in", type: "INPUT_TEXT", value: "Leeds" },
  { key: "q7", label: "Have you read the Bhagavad-gita before?", type: "DROPDOWN", value: ["o1"], options: [{ id: "o1", text: "Just once" }] },
  { key: "q8", label: "How did you hear about Think Gita Circles", type: "DROPDOWN", value: ["o9"], options: [{ id: "o9", text: "Other" }] },
  { key: "q9", label: "", type: "INPUT_TEXT", value: "A poster" },
  { key: "q10", label: "Country", type: "RESPONDENT_COUNTRY", value: "GB" },
  { key: "q11", label: "What are your inspirations and goals for participating in Gita circles?", type: "TEXTAREA", value: "Calm" },
  { key: "q12", label: "Are you active on WhatsApp", type: "CHECKBOXES", value: ["y"], options: [{ id: "y", text: "Yes" }] },
  { key: "q12y", label: "Are you active on WhatsApp (Yes)", type: "CHECKBOXES", value: true },
  { key: "q13", label: "I agree for my data collection and to be contacted by the organisers on Whatsapp and Email.", type: "CHECKBOXES", value: [], options: [{ id: "y", text: "Yes" }] },
];

describe("signupFields", () => {
  it("reads the person, their answers and the hidden link fields", () => {
    const f = su.signupFields(su.toAnswers(webhookFields({ utm_facilitator: "Asha Example", utm_lang: "Eng", circle_id: "abc", other: "x" })));
    expect(f).toMatchObject({
      first_name: "Mira", last_name: "Example", email: "mira@example.org", phone: "+447700900123", city: "Leeds", country: "GB",
      date_of_birth: "1990-05-04", read_before: "Just once", heard_from: "Other: A poster", goals: "Calm",
      whatsapp_active: true, consent: false,
    });
    expect(f.utm).toEqual({ utm_facilitator: "Asha Example", utm_lang: "Eng", circle_id: "abc" });
  });
  it("reads the form's current wording (24 Oct): Gita familiarity, 'this course'", () => {
    const answers = [
      { label: "circle_id", type: "HIDDEN_FIELDS", value: "11111111-1111-4111-8111-111111111111" },
      { label: "How familiar are you with the Bhagavad-gita (1-5)?", type: "MULTIPLE_CHOICE", value: "Read it a little and/or attended a course/talk" },
      { label: "How did you hear about this course", type: "DROPDOWN", value: "My Course Facilitator" },
      { label: "What are your inspirations and goals for participating in this course?", type: "TEXTAREA", value: "Clarity" },
    ];
    const f = su.signupFields(answers);
    expect(f).toMatchObject({ read_before: "Read it a little and/or attended a course/talk", heard_from: "My Course Facilitator", goals: "Clarity" });
    expect(f.utm).toEqual({ circle_id: "11111111-1111-4111-8111-111111111111" });
  });
  it("API submissions: hidden fields arrive as one object", () => {
    const questions = [{ id: "h", type: "HIDDEN_FIELDS" }, { id: "e", type: "INPUT_EMAIL", title: "Email Address" }];
    const sub = { responses: [{ questionId: "h", answer: { utm_wagrp: "https://chat.whatsapp.com/AB1", circle_name: "X" } }, { questionId: "e", answer: "a@example.org" }] };
    const f = su.signupFields(su.apiAnswers(questions, sub));
    expect(f.email).toBe("a@example.org");
    expect(f.utm).toEqual({ utm_wagrp: "https://chat.whatsapp.com/AB1", circle_name: "X" });
    expect(f.whatsapp_active).toBeNull();
    expect(f.date_of_birth).toBeNull();
  });
});

const fac = (name, extra = {}) => ({ name, initiated_name: null, first_name: null, last_name: null, ...extra });
const circle = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Gita Circles | Asha Example | Monday 19:00 (UK)", name_auto: true, status: "live",
  language: "English", circle_type: "Gita Circle", starts_on: "2026-09-07", preferred_start: null, ends_on: null,
  whatsapp_group_link: "https://chat.whatsapp.com/AAA111", facilitator: fac("Asha Example"), cofacilitators: [], ...over,
});
const A = circle();
const B = circle({ id: "22222222-2222-4222-8222-222222222222", name: "Gita Circles | Bela | Tuesday", whatsapp_group_link: "https://chat.whatsapp.com/BBB222", facilitator: fac("Bela Example", { initiated_name: "Bhakti Lata devi dasi" }) });
const C = circle({ id: "33333333-3333-4333-8333-333333333333", name: "Gita Circulos", language: "Spanish", starts_on: "2026-10-18", whatsapp_group_link: null });
const circles = [A, B, C];

describe("matchCircle", () => {
  it("uses the circle id from the link (full or the first 8 characters)", () => {
    expect(su.matchCircle({ circle_id: A.id }, circles)).toMatchObject({ circle_id: A.id, method: "link" });
    expect(su.matchCircle({ circle_id: "22222222" }, circles)).toMatchObject({ circle_id: B.id, method: "link" });
  });
  it("falls back to the circle name when the id is unknown", () => {
    expect(su.matchCircle({ circle_id: "99999999-9999-4999-8999-999999999999", circle_name: A.name }, circles)).toMatchObject({ circle_id: A.id, method: "auto" });
  });
  it("matches the WhatsApp group, ignoring extra bits on the link", () => {
    expect(su.matchCircle({ utm_wagrp: "https://chat.whatsapp.com/bbb222?mode=ac_t", utm_facilitator: "Someone Else" }, circles))
      .toMatchObject({ circle_id: B.id, method: "auto", note: "Same WhatsApp group" });
  });
  it("matches the facilitator by initiated name or first word, with language", () => {
    expect(su.matchCircle({ utm_facilitator: "Bhakti Lata devi dasi", utm_lang: "Eng" }, circles).circle_id).toBe(B.id);
    expect(su.matchCircle({ utm_facilitator: "Asha", utm_lang: "Eng", utm_course: "Circle" }, circles).circle_id).toBe(A.id);
  });
  it("uses the start date to pick between a facilitator's circles", () => {
    const list = [...circles, circle({ id: "44444444-4444-4444-8444-444444444444", name: "Second", language: "Spanish", facilitator: fac("Asha Example"), starts_on: "2027-01-10", whatsapp_group_link: null })];
    const m = su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Esp", utm_date: "18Oct26" }, list);
    expect(m).toMatchObject({ circle_id: C.id, note: "Facilitator, language and start date" });
  });
  it("leaves unclear ones for an admin, with the likely circles", () => {
    const two = [A, circle({ id: "55555555-5555-4555-8555-555555555555", name: "Other Asha", whatsapp_group_link: null })];
    const m = su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng" }, two);
    expect(m.circle_id).toBeNull();
    expect(m.candidates).toEqual([A.id, "55555555-5555-4555-8555-555555555555"]);
    expect(su.matchCircle({ utm_facilitator: "Nobody Known" }, circles)).toMatchObject({ circle_id: null, candidates: [] });
    expect(su.matchCircle({}, circles)).toMatchObject({ circle_id: null, note: "No details from a sign-up link" });
  });
  it("wrong language: not linked, the facilitator's circles suggested", () => {
    const m = su.matchCircle({ utm_facilitator: "Bela Example", utm_lang: "Esp" }, circles);
    expect(m).toMatchObject({ circle_id: null, candidates: [B.id] });
  });
  it("ignores circles that never ran (pending, rejected)", () => {
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng" }, [circle({ status: "rejected" })]).circle_id).toBeNull();
  });
  it("reads names from imported Zoom titles", () => {
    const imp = circle({ name: "TG Circles | Mon | 7.30pm UK | Anjali", name_auto: false, facilitator: null, whatsapp_group_link: null });
    expect(su.matchCircle({ utm_facilitator: "Anjali", utm_lang: "Eng" }, [imp]).circle_id).toBe(imp.id);
  });
});

describe("small helpers", () => {
  it("parses link dates and WhatsApp codes", () => {
    expect(su.parseUtmDate("4Nov26")).toBe("2026-11-04");
    expect(su.parseUtmDate("nonsense")).toBeNull();
    expect(su.waCode("https://chat.whatsapp.com/invite/AbC9?x=1")).toBe("abc9");
    expect(su.waCode(null)).toBeNull();
  });
});

describe("reading link details", () => {
  it("accepts older spellings of the hidden fields", () => {
    const u = su.utmFrom([
      { label: "UTM Facilitator", type: "HIDDEN_FIELDS", value: "Asha" },
      { label: "utm-wagrp", type: "HIDDEN_FIELDS", value: "https://chat.whatsapp.com/AB1" },
      { label: "circleid", type: "HIDDEN_FIELDS", value: "abcd1234" },
      { label: "First Name", type: "INPUT_TEXT", value: "Mira" },
    ]);
    expect(u).toEqual({ utm_facilitator: "Asha", utm_wagrp: "https://chat.whatsapp.com/AB1", circle_id: "abcd1234" });
  });
  it("reads utm values from a passed-along page address, keeping the WhatsApp link whole", () => {
    const u = su.utmFrom([{ label: "url", type: "HIDDEN_FIELDS",
      value: "https://forms.thinkgita.org/circlesignup?utm_facilitator=Ananda%20das&utm_lang=Eng&utm_wagrp=https://chat.whatsapp.com/XY9?mode=r" }]);
    expect(u).toEqual({ utm_facilitator: "Ananda das", utm_lang: "Eng", utm_wagrp: "https://chat.whatsapp.com/XY9?mode=r" });
  });
  it("question answers that merely mention a facilitator are not link details", () => {
    expect(su.utmKey("Who is your facilitator?")).toBeNull();
    expect(su.utmKey("utm_course")).toBe("utm_course");
  });
});

describe("matching by when they signed up", () => {
  const old = circle({ id: "66666666-6666-4666-8666-666666666666", name: "Spring", status: "ended", starts_on: "2026-01-12", ends_on: "2026-04-27", whatsapp_group_link: null });
  const now = circle({ id: "77777777-7777-4777-8777-777777777777", name: "Autumn", starts_on: "2026-09-07", ends_on: null, whatsapp_group_link: null });
  it("picks the facilitator's circle that was running at the time", () => {
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng" }, [old, now], "2026-02-03T10:00:00Z"))
      .toMatchObject({ circle_id: old.id, note: "Facilitator and language, running when they signed up" });
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng" }, [old, now], "2026-08-20T10:00:00Z").circle_id).toBe(now.id);
  });
  it("without a sign-up date, still leaves it for an admin", () => {
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng" }, [old, now]).circle_id).toBeNull();
  });
  it("runningAt allows a little before the start and after the end", () => {
    expect(su.runningAt(old, "2025-12-01")).toBe(true);
    expect(su.runningAt(old, "2025-10-01")).toBe(false);
    expect(su.runningAt(old, "2026-05-05")).toBe(true);
    expect(su.runningAt(old, "2026-06-30")).toBe(false);
  });
  it("matches the website name too", () => {
    const c = circle({ facilitator: fac("Real Name"), website_name: "Kirtana", whatsapp_group_link: null });
    expect(su.matchCircle({ utm_facilitator: "Kirtana", utm_lang: "Eng" }, [c]).circle_id).toBe(c.id);
  });
});

describe("learning from WhatsApp groups and older link formats", () => {
  const a = circle({ whatsapp_group_link: null });
  const b = circle({ id: "88888888-8888-4888-8888-888888888888", name: "Other Asha", whatsapp_group_link: null });
  it("a group links when every linked sign-up from it went to one circle", () => {
    const groups = su.learnGroups([
      { utm: { utm_wagrp: "https://chat.whatsapp.com/GIc?mc_cid=1" }, circle_id: a.id },
      { utm: { utm_wagrp: "https://chat.whatsapp.com/gic" }, circle_id: a.id },
      { utm: { utm_wagrp: "https://chat.whatsapp.com/MIXED" }, circle_id: a.id },
      { utm: { utm_wagrp: "https://chat.whatsapp.com/MIXED" }, circle_id: b.id },
    ]);
    expect([...groups]).toEqual([["gic", a.id]]);
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_wagrp: "https://chat.whatsapp.com/GIc" }, [a, b], null, groups))
      .toMatchObject({ circle_id: a.id, note: "Same WhatsApp group as other sign-ups for this circle" });
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_wagrp: "https://chat.whatsapp.com/MIXED" }, [a, b], null, groups).circle_id).toBeNull();
  });
  it("month-only dates pick the circle starting that month", () => {
    expect(su.parseUtmMonth("aug26")).toBe("2026-08");
    expect(su.parseUtmMonth("18Oct26")).toBe("2026-10");
    expect(su.parseUtmMonth("soon")).toBeNull();
    const aug = circle({ starts_on: "2026-08-03", whatsapp_group_link: null });
    const oct = circle({ id: "99999999-9999-4999-8999-999999999990", name: "October", starts_on: "2026-10-05", whatsapp_group_link: null });
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng", utm_date: "aug26" }, [aug, oct]))
      .toMatchObject({ circle_id: aug.id, note: "Facilitator, language and start month" });
  });
  it("BGB means the beginners course", () => {
    const beg = circle({ circle_type: "Beginners", whatsapp_group_link: null });
    const reg = circle({ id: "99999999-9999-4999-8999-999999999991", name: "Regular", whatsapp_group_link: null });
    expect(su.matchCircle({ utm_facilitator: "Asha Example", utm_lang: "Eng", utm_course: "BGB" }, [beg, reg]).circle_id).toBe(beg.id);
  });
  it("a name run together still matches by its first word", () => {
    const c = circle({ facilitator: fac("Ananda-rupa Krsna das"), whatsapp_group_link: null, language: "Spanish" });
    expect(su.matchCircle({ utm_facilitator: "Ananda-rupaKrsnadas", utm_lang: "Esp" }, [c]).circle_id).toBe(c.id);
  });
});
