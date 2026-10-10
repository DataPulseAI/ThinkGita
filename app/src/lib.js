import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const UK_TZ = "Europe/London";

export const hhmm = (t) => (t ? t.slice(0, 5) : "");
export const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const endTime = (t, dur) => {
  const m = toMin(t) + dur;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Short readable name for an IANA zone, e.g. "America/New_York" -> "New York".
export const tzName = (tz) => (tz ? tz.split("/").pop().replace(/_/g, " ") : "");

// UK reference time (used for scheduling). Falls back to local fields for older rows.
export const ukDay = (c) => c.ref_weekday ?? c.weekday;
export const ukStart = (c) => c.ref_start_time ?? c.start_time;
export const isUk = (c) => !c.timezone || c.timezone === UK_TZ;

export const ukWhen = (c) => `${DAYS[ukDay(c)]} ${hhmm(ukStart(c))}–${endTime(ukStart(c), c.duration_min)}`;
export const localWhen = (c) => `${DAYS[c.weekday]} ${hhmm(c.start_time)} ${tzName(c.timezone)} time`;

// Timezones offered in the editor (same set the Tally mapping produces).
export const TIMEZONES = [
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Brussels", "Europe/Madrid",
  "Europe/Copenhagen", "Africa/Johannesburg", "Africa/Cairo", "Africa/Nairobi", "Europe/Moscow",
  "Asia/Riyadh", "Asia/Dubai", "Asia/Tehran", "Asia/Karachi", "Asia/Kolkata", "Asia/Kathmandu",
  "Asia/Dhaka", "Asia/Colombo", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai",
  "Asia/Tokyo", "Australia/Perth", "Australia/Adelaide", "Australia/Sydney", "Pacific/Auckland", "Pacific/Fiji",
  "America/St_Johns", "America/Halifax", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires", "America/Mexico_City", "America/Bogota", "America/Lima",
];

// Calls the admin edge function with the signed-in user's token.
export async function adminAction(action, circle_id, extra = {}) {
  const { data, error } = await supabase.functions.invoke("provision-circle", { body: { action, circle_id, ...extra } });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context.json();
      msg = body.error ?? msg;
    } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  return data;
}

export const STATUS_LABEL = {
  pending: "Awaiting approval",
  conflict: "Clash: no licence",
  approved: "Approved",
  live: "Live",
  paused: "Paused",
  ended: "Ended",
  rejected: "Rejected",
};

// "2026-10-08" -> "Thu 8 Oct 2026"
export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Ready-to-paste message with a circle's joining details (e.g. for WhatsApp).
// Participants' version leaves out the host key.
export function circleMessage(c, hostKey, { forFacilitator = true } = {}) {
  const lines = [
    `*${c.name}*`,
    `Every ${DAY_NAMES[c.weekday]}, ${hhmm(c.start_time)}–${endTime(c.start_time, c.duration_min)} (${tzName(c.timezone)} time)`,
    c.starts_on && `From ${fmtDate(c.starts_on)}${c.ends_on ? ` to ${fmtDate(c.ends_on)}` : ""}`,
    "",
    c.join_url ? `Join Zoom: ${c.join_url}` : "Join link: to follow",
    c.zoom_meeting_id && `Meeting ID: ${c.zoom_meeting_id}`,
    c.passcode && `Passcode: ${c.passcode}`,
  ];
  if (forFacilitator) {
    lines.push("", `Host key: ${hostKey ?? "ask the ThinkGita team"} (private: for you only, don't share it)`, "To host: join, open Participants, choose Claim host and enter the host key.");
  }
  return lines.filter((l) => l !== false && l !== undefined && l !== null).join("\n");
}

// Common change requests a facilitator can make. `fields` drive the form; times are in the facilitator's own timezone.
export const REQUEST_TYPES = {
  change_time: { label: "Change day or time", fields: ["weekday", "start_time", "from"] },
  change_start: { label: "Change start date", fields: ["from"] },
  pause: { label: "Pause for a few weeks", fields: ["from", "until"] },
  handover: { label: "Hand over to another facilitator", fields: ["name", "email"] },
  stop: { label: "Stop the circle", fields: ["from"] },
  other: { label: "Something else", fields: [] },
};

// One-line, human summary of a structured request.
export function requestSummary(type, d = {}) {
  const from = d.from ? ` from ${fmtDate(d.from)}` : "";
  switch (type) {
    case "change_time": return `Move to ${DAY_NAMES[d.weekday] ?? "?"}s at ${hhmm(d.start_time) || "?"}${from}`;
    case "change_start": return `Start on ${fmtDate(d.from) || "?"}`;
    case "pause": return `Pause from ${fmtDate(d.from) || "?"} until ${fmtDate(d.until) || "?"}`;
    case "handover": return `Hand over to ${d.name || d.email || "?"}${d.name && d.email ? ` (${d.email})` : ""}`;
    case "stop": return `Stop the circle${from}`;
    default: return "Other request";
  }
}

// Pushes circles marked as changed to the website (Framer CMS) and publishes. all: re-push every circle.
export async function websiteSync(all = false) {
  return framerCall({ action: "sync", all });
}
// Publishes the website now (used when an earlier publish failed and is waiting to retry).
export async function websitePublish() {
  return framerCall({ action: "publish" });
}
// Read-only: every Course item in Framer as it is now (all fields), and for linked circles what the sync would write.
export async function websiteSnapshot() {
  return framerCall({ action: "snapshot" });
}
// Read-only: every circle that could be listed, with its card as the sync would write it and what it is missing.
export async function websitePreview() {
  return framerCall({ action: "preview" });
}
// Show/hide or reorder a hand-made website item that no circle is linked to.
export async function websiteSetItem(id, change) {
  return framerCall({ action: "set_item", id, ...change });
}
async function framerCall(body) {
  const { data, error } = await supabase.functions.invoke("framer-sync", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  return data;
}

// ---------- Circle names ----------
// JavaScript copy of the naming rules in supabase/migrations/20261010000026_circle_names.sql, used by the circle
// editor to show what a name becomes before saving. The database trigger is what actually renames; a unit test
// checks this zone list matches the migration's.
// [label, zone, use]: "both" = zone shown with this label and label read back as this zone,
// "label" = zone shown with this label only, "zone" = label read back as this zone only (aliases).
export const ZONE_LABELS = [
  ["UK", "Europe/London", "both"], ["CET", "Europe/Paris", "both"],
  ...["Brussels", "Madrid", "Berlin", "Rome", "Amsterdam", "Copenhagen", "Stockholm", "Oslo", "Vienna", "Zurich", "Prague",
    "Warsaw", "Budapest", "Zagreb", "Bratislava"].map((c) => ["CET", `Europe/${c}`, "label"]),
  ["CEST", "Europe/Paris", "zone"], ["Polska", "Europe/Warsaw", "zone"],
  ["Ireland", "Europe/Dublin", "both"], ["Portugal", "Europe/Lisbon", "both"],
  ["EET", "Europe/Athens", "both"], ["EET", "Europe/Bucharest", "label"], ["EET", "Europe/Helsinki", "label"], ["EET", "Africa/Cairo", "label"],
  ["MSK", "Europe/Moscow", "both"], ["SAST", "Africa/Johannesburg", "both"], ["EAT", "Africa/Nairobi", "both"], ["WAT", "Africa/Lagos", "both"],
  ["Dubai", "Asia/Dubai", "both"], ["GST", "Asia/Dubai", "zone"], ["PKT", "Asia/Karachi", "both"], ["IST", "Asia/Kolkata", "both"],
  ["Nepal", "Asia/Kathmandu", "both"], ["Dhaka", "Asia/Dhaka", "both"], ["Sri Lanka", "Asia/Colombo", "both"], ["Bangkok", "Asia/Bangkok", "both"],
  ["SGT", "Asia/Singapore", "both"], ["HKT", "Asia/Hong_Kong", "both"], ["China", "Asia/Shanghai", "both"], ["JST", "Asia/Tokyo", "both"],
  ["Korea", "Asia/Seoul", "both"], ["KST", "Asia/Seoul", "zone"], ["AWST", "Australia/Perth", "both"], ["Adelaide", "Australia/Adelaide", "both"],
  ["Sydney", "Australia/Sydney", "both"], ["AEST", "Australia/Sydney", "zone"], ["AEDT", "Australia/Sydney", "zone"],
  ["NZ", "Pacific/Auckland", "both"], ["Fiji", "Pacific/Fiji", "both"], ["Newfoundland", "America/St_Johns", "both"], ["AT", "America/Halifax", "both"],
  ["EST", "America/New_York", "both"], ["ET", "America/New_York", "zone"], ["EDT", "America/New_York", "zone"],
  ["CT", "America/Chicago", "both"], ["CST", "America/Chicago", "zone"], ["CDT", "America/Chicago", "zone"],
  ["MT", "America/Denver", "both"], ["MDT", "America/Denver", "zone"], ["MST", "America/Phoenix", "both"],
  ["PT", "America/Los_Angeles", "both"], ["PST", "America/Los_Angeles", "zone"], ["PDT", "America/Los_Angeles", "zone"],
  ["Alaska", "America/Anchorage", "both"], ["Hawaii", "Pacific/Honolulu", "both"], ["BRT", "America/Sao_Paulo", "both"],
  ["ART", "America/Argentina/Buenos_Aires", "both"], ["CDMX", "America/Mexico_City", "both"], ["COT", "America/Bogota", "both"],
  ["PET", "America/Lima", "both"], ["ECT", "America/Guayaquil", "both"], ["VET", "America/Caracas", "both"], ["CLT", "America/Santiago", "both"],
];

// "UK", "CT", "IST"; otherwise "GMT-5" or the place name ("Tehran").
export function zoneLabel(tz) {
  if (!tz) return "";
  const row = ZONE_LABELS.find(([, z, use]) => z === tz && use !== "zone");
  if (row) return row[0];
  const m = /^Etc\/GMT([+-])(\d+)$/.exec(tz);
  if (m) return `GMT${m[1] === "+" ? "-" : "+"}${m[2]}`;
  return tz.replace(/^.*\//, "").replace(/_/g, " ");
}
export const zoneForLabel = (label) =>
  ZONE_LABELS.find(([l, , use]) => l.toLowerCase() === String(label ?? "").trim().toLowerCase() && use !== "label")?.[1] ?? null;

// "17:00" -> "5pm", "19:30" -> "7.30pm" ("7:30pm" with sep ":").
export function timeLabel(t, sep = ".") {
  const [h, m] = String(t).split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `${sep}${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

// Minutes east of UTC for a zone at an instant.
function zoneOffset(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}
// Wall clock time in `to` for a wall clock time in `from` on the circle's next session date (UTC today, like the database).
function convertTime(weekday, start, from, to) {
  const today = new Date();
  const iso = ((today.getUTCDay() + 6) % 7) + 1;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + ((weekday - iso + 7) % 7)));
  const [h, m] = String(start).split(":").map(Number);
  const wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
  let at = wall - zoneOffset(from, wall) * 60000;
  at = wall - zoneOffset(from, at) * 60000;
  const local = new Date(at + zoneOffset(to, at) * 60000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

const NAME_DAY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/;
const NAME_TIME = /^(\d{1,2})(?:([.:])(\d{2}))?\s*([ap]m)\s*(.*)$/i;
// Is this an imported "TG <type> | <Day> | <time> <zone> | <host>" name (the kind that follows the schedule)?
export function followsSchedule(name) {
  const segs = String(name ?? "").trim().split(/\s*\|\s*/);
  return segs.length >= 3 && /^TG(\s|$)/i.test(segs[0]) && NAME_DAY.test(segs[1].toLowerCase()) && NAME_TIME.test(segs[2]);
}
// The name after a schedule change (before/after: { weekday, start_time, timezone }). Other names come back as they are.
export function followSchedule(name, before = {}, after = {}) {
  const tz0 = before.timezone || UK_TZ;
  const tz1 = after.timezone || UK_TZ;
  const start0 = hhmm(before.start_time);
  const start1 = hhmm(after.start_time);
  const dayChanged = Number(before.weekday) !== Number(after.weekday);
  const tzChanged = tz0 !== tz1;
  const timeChanged = start0 !== start1 || tzChanged;
  if (!name || !after.weekday || !start1 || !(dayChanged || timeChanged) || !followsSchedule(name)) return name;
  try {
    const segs = String(name).trim().split(/\s*\|\s*/);
    if (dayChanged) segs[1] = segs[1].length > 5 ? DAY_NAMES[after.weekday] : DAYS[after.weekday];
    if (timeChanged) {
      const m = NAME_TIME.exec(segs[2]);
      const label = tzChanged ? zoneLabel(tz1) : m[5].trim();
      segs[2] = [timeLabel(start1, m[2] ?? "."), label].filter(Boolean).join(" ");
      for (let i = 3; i < segs.length; i++) {
        const x = NAME_TIME.exec(segs[i]);
        const other = x && zoneForLabel(x[5]);
        if (other) segs[i] = [timeLabel(convertTime(after.weekday, start1, tz1, other), x[2] ?? "."), x[5].trim()].filter(Boolean).join(" ");
      }
    }
    return segs.join(" | ");
  } catch (_) {
    return name;
  }
}

// What the database will call a new circle (circle_auto_name): "Gita Circles | Host | Wednesday 19:30 (UK time)".
export function autoNamePreview({ host, weekday, start_time, timezone }) {
  const tz = timezone || UK_TZ;
  const m = /^Etc\/GMT([+-])(\d+)$/.exec(tz);
  const zone = tz === UK_TZ ? "UK time" : m ? `GMT${m[1] === "+" ? "-" : "+"}${m[2]}` : `${tzName(tz)} time`;
  return `Gita Circles | ${String(host ?? "").trim() || "New host"} | ${DAY_NAMES[weekday] ?? ""} ${hhmm(start_time)} (${zone})`;
}
