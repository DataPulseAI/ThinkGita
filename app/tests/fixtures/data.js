// Anonymised test data for the end-to-end tests. Every name, email, phone number, link and Zoom id here is made up.
// Shapes follow the real tables (circles, licences, settings, ...) and the framer-sync responses.
// buildFixtures() returns a fresh copy for every test, so tests can change it freely.

// "Now" for every test: Wednesday 7 October 2026, 11:00 UK time (10:00 UTC).
export const NOW = "2026-10-07T10:00:00Z";
const ago = (mins) => new Date(Date.parse(NOW) - mins * 60000).toISOString();

export const ADMIN_EMAIL = "admin@example.org";
export const OTHER_ADMIN_EMAIL = "helper@example.org";
export const FACILITATOR_EMAIL = "esha.specimen@example.org";
export const BUFFER = 15;

export const LIC = { z1: "lic-01", z2: "lic-02", z3: "lic-03", z4: "lic-04" };
export const FAC = { asha: "fac-01", bram: "fac-02", chitra: "fac-03", dev: "fac-04", esha: "fac-05", farid: "fac-06" };

export const NAMES = {
  c01: "Gita Circles | Kirtana (Asha Example) | Monday 19:00 (London time)",
  c02: "Gita Circles | Bram Sample | Monday 19:30 (London time)",
  c03: "Gita Circles | Chitra Placeholder | Tuesday 18:00 (New York time)",
  c04: "Gita Circles | Dev Fictional | Monday 19:00 (London time)",
  c05: "Gita Circles | Devi (Dev Fictional) | Wednesday 12:00 (Kolkata time)",
  c06: "Gita Circles | Chitra Placeholder | Thursday 20:00 (London time)",
  c07: "Gita Circles | Bram Sample | Friday 09:00 (London time)",
  c08: "Gita Circles | Esha Specimen | Saturday 10:00 (London time)",
  c09: "Gita Circles | Farid Dummy | Sunday 15:00 (London time)",
};

const IMG = (n) => `https://images.example.org/${n}.png`;

// Slots as the database stores them: UK minutes of the week (Monday 00:00 = 0), including the buffer.
export function slotsFor(refWeekday, refStart, duration, buffer = BUFFER) {
  const [h, m] = refStart.split(":").map(Number);
  const s = (refWeekday - 1) * 1440 + h * 60 + m;
  const e = s + duration + buffer;
  return e > 10080 ? `{[${s},10080),[0,${e - 10080})}` : `{[${s},${e})}`;
}

// A circle row with sensible defaults; pass only what differs.
export function circleRow(o) {
  const ref_weekday = o.ref_weekday ?? o.weekday;
  const ref_start_time = o.ref_start_time ?? o.start_time;
  const duration_min = o.duration_min ?? 60;
  return {
    name_auto: true,
    timezone: "Europe/London",
    duration_min,
    ref_weekday,
    ref_start_time,
    slots: slotsFor(ref_weekday, ref_start_time, duration_min),
    uk_time_shifts: false,
    licence_id: null,
    conflict_reason: null,
    is_demo: false,
    source: "tally",
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    preference_used: 1,
    alt_weekday: null,
    alt_start_time: null,
    preferred_start: null,
    starts_on: null,
    ends_on: null,
    circle_type: "Beginner",
    language: "English",
    notes: null,
    join_url: null,
    zoom_meeting_id: null,
    passcode: null,
    whatsapp_group_link: null,
    participant_signup_link: null,
    youtube_playlist_link: null,
    drive_folder_link: null,
    website_visible: false,
    website_name: null,
    website_order: null,
    website_photo_url: null,
    framer_item_id: null,
    framer_created: false,
    framer_has: {},
    framer_dirty: false,
    framer_error: null,
    framer_synced_at: null,
    ...o,
  };
}

export function buildFixtures() {
  const licences = [
    { id: LIC.z1, label: "Zoom 01", active: true, is_mock: false, sort_order: 1, zoom_user_email: "zoom01@example.org", zoom_user_id: "zu-01", host_key: "111111", attendance_scanned_to: ago(60) },
    { id: LIC.z2, label: "Zoom 02", active: true, is_mock: false, sort_order: 2, zoom_user_email: "zoom02@example.org", zoom_user_id: "zu-02", host_key: "222222", attendance_scanned_to: ago(60) },
    { id: LIC.z3, label: "Zoom 03", active: true, is_mock: false, sort_order: 3, zoom_user_email: "zoom03@example.org", zoom_user_id: "zu-03", host_key: null, attendance_scanned_to: ago(60) },
    { id: LIC.z4, label: "Zoom 04", active: false, is_mock: false, sort_order: 4, zoom_user_email: null, zoom_user_id: null, host_key: null, attendance_scanned_to: null },
  ];

  const facilitators = [
    { id: FAC.asha, name: "Asha Example", initiated_name: "Kirtana", email: "asha.example@example.org", phone: "+44 7700 900001", photo_url: IMG("asha") },
    { id: FAC.bram, name: "Bram Sample", email: "bram.sample@example.org", phone: "+44 7700 900002", photo_url: null },
    { id: FAC.chitra, name: "Chitra Placeholder", email: "chitra.placeholder@example.org", phone: "+1 555 0100", photo_url: null },
    { id: FAC.dev, name: "Dev Fictional", initiated_name: "Devi", email: "dev.fictional@example.org", phone: "+91 90000 00004", photo_url: IMG("dev") },
    { id: FAC.esha, name: "Esha Specimen", email: FACILITATOR_EMAIL, phone: "+44 7700 900005", photo_url: null },
    { id: FAC.farid, name: "Farid Dummy", email: "farid.dummy@example.org", phone: null, photo_url: null },
  ];

  const circles = [
    // Live, on Zoom 01, listed on the website, with a co-facilitator. Shares Zoom 01 with c02 on Mondays.
    circleRow({
      id: "c01", name: NAMES.c01, status: "live", facilitator_id: FAC.asha, weekday: 1, start_time: "19:00:00", duration_min: 75,
      licence_id: LIC.z1, starts_on: "2026-09-07", ends_on: "2027-06-28", join_url: "https://zoom.example.org/j/100000001?pwd=fake",
      zoom_meeting_id: "100000001", passcode: "fake01", whatsapp_group_link: "https://chat.whatsapp.com/EXAMPLE01",
      website_visible: true, website_name: "Kirtana", website_order: 1, framer_item_id: "fi-c01", framer_created: true,
      framer_has: { photo: true, name: true, whatsapp: true, order: true, link: true }, framer_synced_at: ago(30), source: "import",
    }),
    // Live, overlaps c01 on Zoom 01 (2 at once). Everything set but switched off: "Ready to show".
    circleRow({
      id: "c02", name: NAMES.c02, status: "live", facilitator_id: FAC.bram, weekday: 1, start_time: "19:30:00", duration_min: 60,
      licence_id: LIC.z1, starts_on: "2026-09-07", ends_on: "2027-06-28", join_url: "https://zoom.example.org/j/100000002?pwd=fake",
      zoom_meeting_id: "100000002", passcode: "fake02", language: "Hindi", whatsapp_group_link: "https://chat.whatsapp.com/EXAMPLE02",
      website_order: 2, website_photo_url: IMG("bram-group"),
    }),
    // Pending on Zoom 02, New York time (UK 23:00 Tuesday). Missing photo, WhatsApp link and order.
    circleRow({
      id: "c03", name: NAMES.c03, status: "pending", facilitator_id: FAC.chitra, weekday: 2, start_time: "18:00:00",
      timezone: "America/New_York", ref_weekday: 2, ref_start_time: "23:00:00", uk_time_shifts: true, licence_id: LIC.z2,
      language: "Spanish", preferred_start: "2026-10-20", timezone_label: "(GMT-05:00) Eastern Time",
    }),
    // Clash: no licence free.
    circleRow({
      id: "c04", name: NAMES.c04, status: "conflict", facilitator_id: FAC.dev, weekday: 1, start_time: "19:00:00",
      conflict_reason: "No licence free on Monday at 19:00 (UK)", preference_used: 1,
    }),
    // Live, Kolkata time (UK 07:30 Wednesday), switched on but missing the website order: "On, but held back".
    circleRow({
      id: "c05", name: NAMES.c05, status: "live", facilitator_id: FAC.dev, weekday: 3, start_time: "12:00:00", duration_min: 90,
      timezone: "Asia/Kolkata", ref_weekday: 3, ref_start_time: "07:30:00", licence_id: LIC.z2, starts_on: "2026-09-09", ends_on: "2027-06-30",
      join_url: "https://zoom.example.org/j/100000005?pwd=fake", zoom_meeting_id: "100000005", passcode: "fake05", language: "Hindi",
      whatsapp_group_link: "https://chat.whatsapp.com/EXAMPLE05", website_visible: true, framer_item_id: "fi-c05", framer_created: true,
      framer_error: "Not shown on the website until set: website order",
    }),
    circleRow({
      id: "c06", name: NAMES.c06, status: "ended", facilitator_id: FAC.chitra, weekday: 4, start_time: "20:00:00",
      starts_on: "2026-03-05", ends_on: "2026-07-30",
    }),
    circleRow({
      id: "c07", name: NAMES.c07, status: "paused", facilitator_id: FAC.bram, weekday: 5, start_time: "09:00:00", licence_id: LIC.z3,
      starts_on: "2026-09-11", ends_on: "2027-07-02",
    }),
    // Pending on Zoom 03, missing only a photo. Esha (the test facilitator) runs it.
    circleRow({
      id: "c08", name: NAMES.c08, status: "pending", facilitator_id: FAC.esha, weekday: 6, start_time: "10:00:00", licence_id: LIC.z3,
      preferred_start: "2026-10-24", whatsapp_group_link: "https://chat.whatsapp.com/EXAMPLE08", website_order: 4,
    }),
    circleRow({
      id: "c09", name: NAMES.c09, status: "rejected", facilitator_id: FAC.farid, weekday: 7, start_time: "15:00:00",
    }),
  ];

  const circle_cofacilitators = [{ circle_id: "c01", facilitator_id: FAC.esha }];

  const settings = {
    id: 1, buffer_minutes: BUFFER, default_duration_min: 75, default_timezone: "Europe/London", term_start: null, term_end: null,
    drive_folder_link: "https://drive.example.org/shared-folder", support_contact: "circles@example.org", youtube_playlist_link: null,
    participant_signup_link: "https://signup.example.org/?circle={circle_code}",
    framer_auto_publish: true, framer_publish_pending: false, framer_publish_error: null, framer_publish_tried_at: null,
    framer_published_at: ago(120), framer_fail_count: 0, framer_last_error: null, framer_failed_at: null,
  };

  const change_requests = [
    {
      id: "req-01", circle_id: "c01", request_type: "change_time", details: { weekday: 2, start_time: "19:00", from: "2026-10-13" },
      message: "Move to Tuesdays at 19:00 from Tue 13 Oct 2026", status: "open", requested_by: "asha.example@example.org", created_at: ago(600),
    },
    {
      id: "req-02", circle_id: "c02", request_type: "other", details: {}, message: "Could we share the slides in the group?",
      status: "done", requested_by: "bram.sample@example.org", created_at: ago(5000),
    },
  ];

  const admin_emails = [
    { email: ADMIN_EMAIL, name: "Alex Admin", is_super: true },
    { email: OTHER_ADMIN_EMAIL, name: "Helen Helper", is_super: false },
  ];

  const zoomSnapshot = {
    accounts: [
      {
        label: "Zoom 01", email: "zoom01@example.org", active: true, meetings: [
          { id: "100000001", topic: NAMES.c01, type: "weekly/recurring", repeats: "weekly on Monday", next: "2026-10-12T18:00:00Z", duration: 75, ends: "2027-06-28T18:00:00Z", sessions_left: 38, circle: NAMES.c01, timezone: "Europe/London" },
          { id: "100000002", topic: NAMES.c02, type: "weekly/recurring", repeats: "weekly on Monday", next: "2026-10-12T18:30:00Z", duration: 60, ends: "2027-06-28T18:30:00Z", sessions_left: 38, circle: NAMES.c02, timezone: "Europe/London" },
        ],
      },
      {
        label: "Zoom 02", email: "zoom02@example.org", active: true, meetings: [
          { id: "100000005", topic: NAMES.c05, type: "weekly/recurring", repeats: "weekly on Wednesday", next: "2026-10-14T06:30:00Z", duration: 90, circle: NAMES.c05, timezone: "Asia/Kolkata" },
          { id: "900000001", topic: "Team planning call", type: "one-off", start_time: "2026-10-09T09:00:00Z", duration: 30, circle: null, timezone: "Europe/London" },
        ],
      },
      { label: "Zoom 03", email: "zoom03@example.org", active: true, meetings: [] },
    ],
  };

  const audit_log = [
    { id: 1, at: ago(30), actor: ADMIN_EMAIL, action: "circle_deleted", circle_id: null, detail: { name: "Gita Circles | Old Sample | Thursday 10:00 (London time)", status: "ended" } },
    { id: 2, at: ago(35), actor: OTHER_ADMIN_EMAIL, action: "circle_edited", circle_id: "c02", detail: { name: NAMES.c02, changes: { website_visible: { from: false, to: true }, start_time: { from: "19:00:00", to: "19:30:00" }, licence_id: { from: null, to: LIC.z1 } } } },
    { id: 3, at: ago(40), actor: "cron", action: "framer_sync", circle_id: null, detail: { errors: [], hidden: 0, created: 0, skipped: 1, updated: 0, published: false } },
    { id: 4, at: ago(41), actor: ADMIN_EMAIL, action: "cancel", circle_id: null, detail: { meeting_id: "100000099" } },
    { id: 5, at: ago(42), actor: OTHER_ADMIN_EMAIL, action: "framer_item", circle_id: null, detail: { id: "hm-1", order: 1, published: true } },
    { id: 6, at: ago(47), actor: "cron", action: "framer_sync", circle_id: null, detail: { errors: [], hidden: 0, created: 0, updated: 1, published: true } },
    { id: 7, at: ago(120), actor: "tally", action: "circle_created", circle_id: "c08", detail: { name: NAMES.c08, source: "tally", status: "pending" } },
    { id: 8, at: ago(90), actor: ADMIN_EMAIL, action: "zoom_meetings_snapshot", circle_id: null, detail: zoomSnapshot },
    { id: 9, at: ago(60), actor: "cron", action: "sync_attendance", circle_id: null, detail: { more: false, sessions_added: 2 } },
  ];

  const email_log = [
    { id: "em-01", sent_at: ago(1500), kind: "approved", to_email: "asha.example@example.org", subject: "Your ThinkGita circle is ready", circle_id: "c01", circle_name: NAMES.c01, sent_by: ADMIN_EMAIL, status: "sent", error: null,
      from_address: "ThinkGita Circles <circles@example.org>", reply_to: "circles@example.org", message_id: "<m1@example.org>", body_html: "<p>Hello Asha, your circle is ready.</p>", body_text: "Hello Asha, your circle is ready." },
    { id: "em-02", sent_at: ago(3000), kind: "approved", to_email: "dev.fictional@example.org", subject: "Your ThinkGita circle is ready", circle_id: "c05", circle_name: NAMES.c05, sent_by: ADMIN_EMAIL, status: "failed", error: "SMTP timeout",
      from_address: "ThinkGita Circles <circles@example.org>", reply_to: null, message_id: null, body_html: "<p>Hello Dev.</p>", body_text: "Hello Dev." },
    { id: "em-03", sent_at: ago(4000), kind: "approved", to_email: null, subject: null, circle_id: "c03", circle_name: NAMES.c03, sent_by: ADMIN_EMAIL, status: "skipped", error: "no facilitator email",
      from_address: null, reply_to: null, message_id: null, body_html: null, body_text: null },
  ];

  // Attendance: seven weekly sessions of c01 and two of a meeting that is not a circle.
  const mondays = ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
  const attendance_sessions = [
    ...mondays.map((d, i) => ({ id: `s-c01-${i + 1}`, circle_id: "c01", zoom_meeting_id: "100000001", started_at: `${d}T18:00:00Z`, topic: NAMES.c01, circle_name: NAMES.c01, licence_label: "Zoom 01", participant_count: 0 })),
    { id: "s-ext-1", circle_id: null, zoom_meeting_id: "900000001", started_at: "2026-09-25T09:00:00Z", topic: "Team planning call", circle_name: null, licence_label: "Zoom 02", participant_count: 0 },
    { id: "s-ext-2", circle_id: null, zoom_meeting_id: "900000001", started_at: "2026-10-02T09:00:00Z", topic: "Team planning call", circle_name: null, licence_label: "Zoom 02", participant_count: 0 },
  ];
  const who = {
    p1: ["Participant One", "p1@example.org", [1, 2, 3, 4, 5, 6, 7]],
    p2: ["Participant Two", null, [2, 3, 5, 7]],
    p3: ["Participant Three", null, [6, 7]],
    p4: ["Participant Four", null, [1, 2, 3]], // came 3 times, then stopped: dropped off
  };
  const attendance = [];
  for (const [key, [name, email, sessions]] of Object.entries(who)) {
    for (const n of sessions) attendance.push({ session_id: `s-c01-${n}`, person_key: key, name, email, minutes: 70 });
  }
  attendance.push(
    { session_id: "s-ext-1", person_key: "x1", name: "Guest Person", email: null, minutes: 30 },
    { session_id: "s-ext-2", person_key: "x1", name: "Guest Person", email: null, minutes: 25 },
    // The licence host account joins too; the dashboard leaves it out.
    { session_id: "s-c01-7", person_key: "zoom01@example.org", name: "Zoom 01", email: "zoom01@example.org", minutes: 75 },
  );

  // framer-sync "snapshot": every Course item in Framer.
  const DESC = "Start your growth journey with a like-minded community and an expert facilitator";
  const item = (id, draft, circle, all) => ({ id, slug: id, draft, circle, all: { Description: DESC, MainImg: IMG("banner"), AuthorImg: IMG(`author-${id}`), ...all } });
  const framer_items = [
    item("fi-c01", false, { id: "c01", name: NAMES.c01, status: "live", website_visible: true, created: true, missing: [] },
      { MainTitle: "Gita Circles (English)", Time: "7pm UK | Mondays", Lesson: "Join anytime", AuthorName: "Kirtana", LessonNumber: "1" }),
    item("hm-1", false, null, { MainTitle: "Gita Circles (Slovak)", Time: "10:30am CEST | Sundays", Lesson: "Starts 18 Oct", AuthorName: "Hand Made Host", LessonNumber: "3" }),
    item("fi-c05", true, { id: "c05", name: NAMES.c05, status: "live", website_visible: true, created: true, missing: ["website order"] },
      { MainTitle: "Gita Circles (Hindi)", Time: "12pm IST | Wednesdays", Lesson: "Join anytime", AuthorName: "Devi", LessonNumber: null }),
    item("hm-2", true, null, { MainTitle: "Gita Circles (Czech)", Time: "8pm CET | Tuesdays", Lesson: "Starts 13 Oct", AuthorName: "Hidden Host", LessonNumber: "4" }),
    item("old", true, null, { MainTitle: "Data science", AuthorImg: null }),
  ];
  // framer-sync "preview": every circle that could be listed, with its card and what it is missing.
  const card = (id, status, visible, missing, extra) => ({
    id, circle: NAMES[id], status, visible, item: null, created: false, draft: !visible || missing.length > 0, missing,
    title: "Gita Circles (English)", description: DESC, time: "7pm UK | Mondays", lesson: "Join anytime", author: "", photo: null, banner: IMG("banner"), order: null, link: null, ...extra,
  });
  const framer_preview = [
    card("c01", "live", true, [], { item: "fi-c01", author: "Kirtana", photo: IMG("asha"), order: 1 }),
    card("c02", "live", false, [], { title: "Gita Circles (Hindi)", author: "Bram Sample", photo: IMG("bram-group"), order: 2, time: "7:30pm UK | Mondays" }),
    card("c03", "pending", false, ["photo", "WhatsApp group link", "website order"], { title: "Gita Circles (Spanish)", author: "Chitra Placeholder" }),
    card("c05", "live", true, ["website order"], { item: "fi-c05", title: "Gita Circles (Hindi)", author: "Devi", photo: IMG("dev") }),
    card("c08", "pending", false, ["photo"], { author: "Esha Specimen", order: 4 }),
  ];

  return {
    licences, facilitators, circles, circle_cofacilitators, settings: [settings], change_requests, admin_emails,
    audit_log, email_log, email_templates: [], attendance_sessions, attendance, framer_items, framer_preview,
  };
}
