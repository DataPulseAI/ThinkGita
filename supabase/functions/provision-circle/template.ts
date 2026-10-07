// @ts-nocheck: shared plain-JS module (also used by the dashboard).
// Facilitator email templates: {{placeholders}} in plain text, rendered to text and simple HTML.
// This file is copied verbatim to supabase/functions/provision-circle/template.ts so the
// dashboard preview and the sent email always match. Edit here, then copy.

export const PLACEHOLDERS = [
  { key: "first_name", label: "First name", group: "Facilitator" },
  { key: "facilitator_name", label: "Full name", group: "Facilitator" },
  { key: "circle_name", label: "Circle name", group: "Circle" },
  { key: "circle_type", label: "Circle type", group: "Circle" },
  { key: "language", label: "Language", group: "Circle" },
  { key: "meeting_day", label: "Day (e.g. Wednesday)", group: "Circle" },
  { key: "meeting_time", label: "Time, facilitator's own (e.g. 19:30)", group: "Circle" },
  { key: "timezone", label: "Timezone (e.g. UK time)", group: "Circle" },
  { key: "duration", label: "Length in minutes", group: "Circle" },
  { key: "start_date", label: "First session date", group: "Circle", auto: true },
  { key: "circle_code", label: "Short circle code", group: "Circle" },
  { key: "zoom_meeting_link", label: "Zoom meeting link", group: "Zoom", auto: true },
  { key: "zoom_meeting_id", label: "Zoom meeting ID", group: "Zoom", auto: true },
  { key: "zoom_passcode", label: "Zoom passcode", group: "Zoom", auto: true },
  { key: "zoom_login_email", label: "Licence login email", group: "Zoom" },
  { key: "zoom_password", label: "Licence password (gives full account access)", group: "Zoom" },
  { key: "host_key", label: "Host key (safer alternative to password)", group: "Zoom" },
  { key: "licence_name", label: "Licence name", group: "Zoom" },
  { key: "youtube_playlist_link", label: "YouTube playlist", group: "Links" },
  { key: "drive_folder_link", label: "Google Drive folder", group: "Links" },
  { key: "whatsapp_group_link", label: "WhatsApp group (set per circle)", group: "Links" },
  { key: "participant_signup_link", label: "Participant sign-up link", group: "Links" },
  { key: "dashboard_link", label: "Circles dashboard link", group: "Links" },
  { key: "support_contact", label: "Support contact", group: "Team" },
  { key: "sender_name", label: "Sender name", group: "Team" },
];
const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));
const AUTO = new Set(PLACEHOLDERS.filter((p) => p.auto).map((p) => p.key));

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function friendlyTz(tz) {
  if (!tz) return "";
  if (tz === "Europe/London") return "UK time";
  const m = tz.match(/^Etc\/GMT([+-])(\d+)$/);
  if (m) return `GMT${m[1] === "+" ? "-" : "+"}${m[2]}`;
  return `${tz.split("/").pop().replace(/_/g, " ")} time`;
}

function longDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const wd = DAY_NAMES[((d.getUTCDay() + 6) % 7) + 1];
  return `${wd} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Expected first session before approval: first matching weekday on/after the latest of
// today, the facilitator's preferred start and the term start.
function expectedStart(circle, settings) {
  const today = new Date().toISOString().slice(0, 10);
  const from = [today, circle.preferred_start, settings?.term_start].filter(Boolean).map((s) => String(s).slice(0, 10)).sort().pop();
  const d = new Date(`${from}T12:00:00Z`);
  const cur = ((d.getUTCDay() + 6) % 7) + 1;
  d.setUTCDate(d.getUTCDate() + ((circle.weekday - cur + 7) % 7));
  return d.toISOString().slice(0, 10);
}

const firstWord = (s) => String(s ?? "").trim().split(/\s+/)[0] ?? "";
const pick = (...vals) => vals.find((v) => v != null && String(v).trim() !== "") ?? "";

export function buildVars({ circle = {}, facilitator = {}, licence = {}, settings = {}, appUrl = "" }) {
  const code = circle.id ? String(circle.id).slice(0, 8) : "";
  const nameIsEmail = /@/.test(facilitator?.name ?? "");
  const signupPattern = pick(settings?.participant_signup_link);
  return {
    first_name: pick(facilitator?.first_name, nameIsEmail ? "" : firstWord(facilitator?.name)),
    facilitator_name: pick(facilitator?.name),
    circle_name: pick(circle.name),
    circle_type: pick(circle.circle_type),
    language: pick(circle.language),
    meeting_day: circle.weekday ? DAY_NAMES[circle.weekday] : "",
    meeting_time: circle.start_time ? String(circle.start_time).slice(0, 5) : "",
    timezone: friendlyTz(circle.timezone),
    duration: circle.duration_min ? String(circle.duration_min) : "",
    start_date: longDate(circle.starts_on || (circle.weekday ? expectedStart(circle, settings) : "")),
    circle_code: code,
    zoom_meeting_link: pick(circle.join_url),
    zoom_meeting_id: pick(circle.zoom_meeting_id),
    zoom_passcode: pick(circle.passcode),
    zoom_login_email: pick(licence?.zoom_user_email),
    zoom_password: pick(licence?.zoom_password),
    host_key: pick(licence?.host_key),
    licence_name: pick(licence?.label),
    youtube_playlist_link: pick(circle.youtube_playlist_link, settings?.youtube_playlist_link),
    drive_folder_link: pick(circle.drive_folder_link, settings?.drive_folder_link),
    whatsapp_group_link: pick(circle.whatsapp_group_link),
    participant_signup_link: pick(circle.participant_signup_link, signupPattern.replace(/\{circle_code\}/g, code)),
    dashboard_link: pick(appUrl),
    support_contact: pick(settings?.support_contact),
    sender_name: pick(settings?.sender_name),
  };
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function usedPlaceholders(template) {
  const keys = new Set();
  for (const part of [template?.subject ?? "", template?.body ?? ""]) for (const m of part.matchAll(TOKEN)) keys.add(m[1]);
  return [...keys];
}

// Placeholders in the template that have no value. `beforeApproval` ignores the ones filled in on approval.
export function missingValues(template, vars, { beforeApproval = false } = {}) {
  return usedPlaceholders(template).filter((k) => KNOWN.has(k) && !vars[k] && !(beforeApproval && AUTO.has(k)));
}
export function unknownPlaceholders(template) {
  return usedPlaceholders(template).filter((k) => !KNOWN.has(k));
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// opts.missing: text used for a blank value (sent emails use a neutral phrase, the preview marks it).
export function render(template, vars, { missing = "to follow", preview = false } = {}) {
  const value = (k) => {
    if (!KNOWN.has(k)) return null;
    return vars[k] ? String(vars[k]) : null;
  };
  const subject = String(template?.subject ?? "").replace(TOKEN, (_, k) => value(k) ?? (KNOWN.has(k) ? missing : `{{${k}}}`)).replace(/[\r\n]+/g, " ").trim();
  const text = String(template?.body ?? "").replace(TOKEN, (_, k) => value(k) ?? (KNOWN.has(k) ? missing : `{{${k}}}`));

  // HTML: escape everything, then add links, headings and paragraphs.
  const lineHtml = (line) => {
    let out = "";
    let last = 0;
    for (const m of line.matchAll(TOKEN)) {
      out += esc(line.slice(last, m.index));
      const v = value(m[1]);
      if (v) out += linkify(esc(v));
      else if (preview) out += `<mark class="missing">${esc(KNOWN.has(m[1]) ? `${m[1]}: not set` : `unknown: ${m[1]}`)}</mark>`;
      else out += esc(KNOWN.has(m[1]) ? missing : m[0]);
      last = m.index + m[0].length;
    }
    out += esc(line.slice(last));
    return linkifyPlain(out);
  };
  const blocks = String(template?.body ?? "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = blocks.map((block) => {
    const lines = block.split("\n");
    const parts = lines.map((line, i) => {
      const isHeading = /^[A-Z0-9][A-Z0-9 &'’\-:]{2,}$/.test(line.trim()) && !/\{\{/.test(line);
      if (isHeading) return `<strong style="display:block;letter-spacing:.04em;color:#1d6a72;margin-top:${i ? 8 : 0}px">${esc(line.trim())}</strong>`;
      return lineHtml(line) + (i < lines.length - 1 && !/^[A-Z0-9][A-Z0-9 &'’\-:]{2,}$/.test(lines[i + 1]?.trim() ?? "") ? "<br>" : "");
    });
    return `<p style="margin:0 0 16px">${parts.join("")}</p>`;
  }).join("\n");
  const wrapped = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2a30;max-width:600px">${html}</div>`;
  return { subject, text, html: wrapped };
}

// Turn bare URLs in already-escaped text into links (skips text already inside a tag).
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#1d6a72">$1</a>');
}
function linkifyPlain(html) {
  return html.split(/(<[^>]+>[^<]*<\/a>|<[^>]+>)/).map((part) => (part.startsWith("<") ? part : linkify(part))).join("");
}

export const DEFAULT_TEMPLATES = {
  approved: {
    subject: "You're approved! Your Think Gita Circle is ready, {{first_name}}",
    body: `Dear {{first_name}},

Congratulations! Your application to facilitate a Think Gita Circle has been approved, and we're delighted to welcome you.

Your Circle has already been set up, and everything you need to run it is below. Please save this email for reference.

YOUR CIRCLE
Circle name: {{circle_name}}
Meeting day and time: {{meeting_day}} at {{meeting_time}} ({{timezone}})
First session: {{start_date}}

ZOOM
Meeting link: {{zoom_meeting_link}}
Meeting ID: {{zoom_meeting_id}}
Passcode: {{zoom_passcode}}
Host login: {{zoom_login_email}}
Host password: {{zoom_password}}
Please sign in with this host account to start each session.

CONTENT AND RESOURCES
YouTube playlist: {{youtube_playlist_link}}
Google Drive folder: {{drive_folder_link}}
Please request access to the Drive folder and we'll approve it on our end.

COMMUNICATION
WhatsApp group: {{whatsapp_group_link}}
This is your Circle's group for reminders, updates and discussion.

PARTICIPANT SIGN-UP
Your sign-up link: {{participant_signup_link}}
Please share this exact link when inviting people. Everyone who registers through it is automatically linked to your Circle.

GETTING STARTED

1. Sign in to Zoom with the host login above and check that your meeting opens.
2. Open the Google Drive folder and read through the facilitator guide and session materials.
3. Join the WhatsApp group and post a short welcome message.
4. Share your sign-up link with your network, community and social channels.

If anything is missing or not working, reply to this email or contact {{support_contact}} and we'll sort it out.

Thank you for stepping forward to lead a Circle. We're glad to have you with us.

Warm regards,
{{sender_name}}
Think Gita Circles Team`,
  },
  updated: {
    subject: "Your Think Gita Circle details have changed, {{first_name}}",
    body: `Dear {{first_name}},

Some details of your Circle have changed. Your up-to-date details are below. Please use these from now on.

YOUR CIRCLE
Circle name: {{circle_name}}
Meeting day and time: {{meeting_day}} at {{meeting_time}} ({{timezone}})
Next session: {{start_date}}

ZOOM
Meeting link: {{zoom_meeting_link}}
Meeting ID: {{zoom_meeting_id}}
Passcode: {{zoom_passcode}}
Host login: {{zoom_login_email}}
Host password: {{zoom_password}}

If the meeting link has changed, please share the new one in your WhatsApp group: {{whatsapp_group_link}}

If anything looks wrong, reply to this email or contact {{support_contact}}.

Warm regards,
{{sender_name}}
Think Gita Circles Team`,
  },
};
