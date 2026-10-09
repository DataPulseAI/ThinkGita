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
    `Join Zoom: ${c.join_url}`,
    `Meeting ID: ${c.zoom_meeting_id}`,
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
  const { data, error } = await supabase.functions.invoke("framer-sync", { body: { action: "sync", all } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  return data;
}
