// Admin-only actions that touch Zoom and email.
// POST { action: "provision" | "cancel" | "end_on" | "resend" | "reschedule" | "move_licence" | "handover" | "sync_licences"
//          | "set_host_key" | "rename" | "list_zoom_meetings" | "sync_attendance" | "invite_admin" | "test_email",
//        circle_id?, patch?, facilitator?, date?, licence_id?, template_key?, template? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildVars, render, DEFAULT_TEMPLATES } from "./template.ts";
import nodemailer from "npm:nodemailer@6.9.16";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID") ?? "";
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET") ?? "";
// Email goes out through the team's Gmail account (an app password, not the account password).
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const EMAIL_FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") ?? "Think Gita Circles";
const EMAIL_READY = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
const EMAIL_MISSING = "Email isn't set up yet (GMAIL_USER / GMAIL_APP_PASSWORD)";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const MAX_OCCURRENCES = 50;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });


// ---------- Zoom ----------
let zoomToken: string | null = null;
let zoomTokenExpires = 0;
async function zoom(path: string, init: RequestInit = {}) {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error("Zoom credentials are not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)");
  }
  if (!zoomToken || Date.now() > zoomTokenExpires) {
    const r = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
      { method: "POST", headers: { Authorization: "Basic " + btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`) } },
    );
    if (!r.ok) throw new Error(`Zoom auth failed: ${r.status} ${await r.text()}`);
    const t = await r.json();
    zoomToken = t.access_token;
    zoomTokenExpires = Date.now() + ((t.expires_in ?? 3600) - 120) * 1000;
  }
  const r = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${zoomToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 204) return null;
  const body = await r.text();
  if (!r.ok) throw new Error(`Zoom ${path} failed: ${r.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

// ---------- Dates ----------
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
// Today's date in the UK (not UTC), so late-evening actions use the right day.
function ukToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
// First date on/after `from` that falls on ISO weekday (1 = Mon .. 7 = Sun).
function firstOccurrence(from: string, weekday: number) {
  const d = new Date(`${from}T12:00:00Z`);
  const cur = ((d.getUTCDay() + 6) % 7) + 1;
  d.setUTCDate(d.getUTCDate() + ((weekday - cur + 7) % 7));
  return isoDate(d);
}
// Today's date in the circle's own timezone (an evening session in the Americas is still "today" there after UK midnight).
function localToday(tz?: string | null) {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: tz || "Europe/London" }); } catch { return ukToday(); }
}
// Zoom wants the series end in UTC: 23:59 on the last day in the circle's own timezone, so a late-evening session in the
// Americas (after midnight UTC) is not cut off.
function endUtc(date: string, tz?: string | null) {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 23, 59);
  let offset = 0;
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz || "Europe/London", timeZoneName: "longOffset" })
      .formatToParts(new Date(wall)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const mm = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
    if (mm) offset = (mm[1] === "-" ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3] ?? 0));
  } catch { /* unknown zone: treat as UTC */ }
  return new Date(wall - offset * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function weeksBetween(a: string, b: string) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / (7 * 86400000)) + 1;
}

// ---------- Email ----------
// Text comes from the editable templates (dashboard Emails tab); template.ts escapes all values.
type TemplateKey = "approved" | "updated";
async function loadTemplate(key: TemplateKey) {
  const { data } = await db.from("email_templates").select("subject, body").eq("key", key).maybeSingle();
  return data ?? DEFAULT_TEMPLATES[key];
}
let mailer: ReturnType<typeof nodemailer.createTransport> | null = null;
type EmailMeta = { kind: string; circle?: { id?: string; name?: string } | null; actor: string };
// Every attempt is written to email_log (Setup, Sent emails), including skipped and failed ones.
type EmailBody = { html?: string; text?: string; replyTo?: string };
async function logEmail(meta: EmailMeta, to: string | null, subject: string | null, status: "sent" | "failed" | "skipped", error?: string, messageId?: string, body: EmailBody = {}) {
  await db.from("email_log").insert({
    kind: meta.kind, to_email: to, subject, circle_id: meta.circle?.id ?? null, circle_name: meta.circle?.name ?? null,
    sent_by: meta.actor, status, error: error ?? null, message_id: messageId ?? null,
    from_address: GMAIL_USER ? `${EMAIL_FROM_NAME} <${GMAIL_USER}>` : null, reply_to: body.replyTo ?? null,
    body_html: body.html ?? null, body_text: body.text ?? null,
  }).then(({ error: e }) => e && console.error("email_log insert failed", e.message));
}
async function sendEmail(to: string, subject: string, html: string, text: string, meta: EmailMeta, replyTo?: string) {
  mailer ??= nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  try {
    const info = await mailer.sendMail({ from: { name: EMAIL_FROM_NAME, address: GMAIL_USER }, to, subject, html, text, ...(replyTo ? { replyTo } : {}) });
    await logEmail(meta, to, subject, "sent", undefined, info?.messageId, { html, text, replyTo });
    return "sent";
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 200);
    await logEmail(meta, to, subject, "failed", msg, undefined, { html, text, replyTo });
    return `failed: ${msg}`;
  }
}
// The admin who triggers an email signs it (their name under Settings > Admins).
async function adminName(email: string) {
  const { data } = await db.from("admin_emails").select("name").eq("email", email).maybeSingle();
  return data?.name ?? "";
}
async function sendDetailsEmail(key: TemplateKey, circle: any, facilitator: any, licence: any, actor: string) {
  const meta: EmailMeta = { kind: key, circle, actor };
  if (!EMAIL_READY) { await logEmail(meta, facilitator?.email ?? null, null, "skipped", "Email isn't set up (GMAIL_USER / GMAIL_APP_PASSWORD)"); return "skipped (GMAIL_USER / GMAIL_APP_PASSWORD not set)"; }
  if (!facilitator?.email) { await logEmail(meta, null, null, "skipped", "Circle has no facilitator email"); return "skipped (no facilitator)"; }
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  const template = await loadTemplate(key);
  const vars = buildVars({ circle, facilitator, licence, settings, appUrl: APP_URL, sender: await adminName(actor) });
  const { subject, html, text } = render(template, vars);
  return await sendEmail(facilitator.email, subject, html, text, meta, settings?.support_contact || undefined);
}

// Everyone on a circle: the facilitator plus any co-facilitators (one email each, personalised).
async function circleTeam(circleId: string, primary: any) {
  const { data } = await db.from("circle_cofacilitators").select("facilitator:facilitators(*)").eq("circle_id", circleId);
  const seen = new Set<string>();
  return [primary, ...(data ?? []).map((r: any) => r.facilitator)]
    .filter((f) => f?.email && !seen.has(f.email) && seen.add(f.email));
}
async function sendDetailsToTeam(key: TemplateKey, circle: any, primary: any, licence: any, actor: string) {
  const team = await circleTeam(circle.id, primary);
  if (!team.length) return await sendDetailsEmail(key, circle, null, licence, actor); // logged as skipped
  const results: string[] = [];
  for (const f of team) results.push(await sendDetailsEmail(key, circle, f, licence, actor));
  const bad = results.find((x) => x !== "sent");
  return !bad ? "sent" : team.length > 1 ? `${results.filter((x) => x === "sent").length} of ${team.length} sent; ${bad}` : bad;
}

// Send a rendered template (saved or unsaved draft) for one circle to the admin's own inbox.
async function testEmail(circleId: string, actor: string, key: TemplateKey, draft?: { subject?: string; body?: string }) {
  if (!EMAIL_READY) throw new Error(EMAIL_MISSING);
  const c = await loadCircle(circleId);
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  const template = draft?.subject != null && draft?.body != null ? draft : await loadTemplate(key);
  const vars = buildVars({ circle: c, facilitator: c.facilitator, licence: c.licence, settings, appUrl: APP_URL, sender: await adminName(actor) });
  const { subject, html, text } = render(template as { subject: string; body: string }, vars);
  const result = await sendEmail(actor, `[TEST] ${subject}`, html, text, { kind: "test", circle: c, actor });
  if (result !== "sent") throw new Error(`Test email ${result}`);
  await audit(actor, "test_email", c.id, { template: key });
  return { email: result, to: actor };
}

// Sign-in invite (sent by Supabase Auth through its SMTP settings). Logged in Sent emails as "invite".
async function inviteFacilitator(email: string, meta?: EmailMeta) {
  const { error } = await db.auth.admin.inviteUserByEmail(email, APP_URL ? { redirectTo: APP_URL } : undefined);
  const result = !error ? "invited" : /already/i.test(error.message) ? "already has an account" : `invite failed: ${error.message}`;
  if (meta && result !== "already has an account") {
    const hint = /timeout|deadline/i.test(error?.message ?? "")
      ? " (Supabase couldn't reach the mail server in time: check Authentication, Emails, SMTP settings)" : "";
    await logEmail({ ...meta, kind: "invite" }, email, "Sign-in invite", error ? "failed" : "sent", error ? `${error.message}${hint}` : undefined);
  }
  return result;
}

// Invite a newly added admin so they can set a password and sign in.
async function inviteAdmin(actor: string, email: string) {
  const e = String(email ?? "").trim().toLowerCase();
  const { data: row } = await db.from("admin_emails").select("email").eq("email", e).maybeSingle();
  if (!row) throw new Error("Add them as an admin first");
  const result = await inviteFacilitator(e, { kind: "invite", actor });
  await audit(actor, "invite_admin", null, { email: e, result });
  return { invite: result };
}

async function audit(actor: string, action: string, circle_id: string | null, detail: unknown) {
  await db.from("audit_log").insert({ actor, action, circle_id, detail });
}

async function loadCircle(id: string) {
  const { data, error } = await db
    .from("circles")
    .select("*, facilitator:facilitators!circles_facilitator_id_fkey(*), licence:licences(*)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Testing only: fake meeting for licences marked is_mock. Never calls Zoom.
function mockMeeting() {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b % 10).join("");
  return {
    id: `MOCK${digits}`,
    join_url: `https://zoom.us/j/${digits}?mock=1`,
    password: `mock${digits.slice(0, 4)}`,
  };
}

// ---------- Actions ----------
async function provision(circleId: string, actor: string, notify = true) {
  const c = await loadCircle(circleId);
  if (c.status !== "pending") throw new Error(c.status === "approved" ? "This circle is already being approved" : `Circle is ${c.status}, not awaiting approval`);
  if (!c.licence) throw new Error("Circle has no licence assigned");
  if (!c.licence.active) throw new Error(`${c.licence.label} is inactive. Re-check licences first.`);
  if (!c.licence.is_mock && !c.licence.zoom_user_email) throw new Error(`${c.licence.label} has no Zoom user email set`);
  if (!c.facilitator) throw new Error("Circle has no facilitator");

  // Claim the circle so a double click can't create two Zoom meetings.
  const { data: claimed } = await db.from("circles").update({ status: "approved" })
    .eq("id", c.id).eq("status", "pending").select("id");
  if (!claimed?.length) throw new Error("This circle is already being approved");
  const release = () => db.from("circles").update({ status: "pending" }).eq("id", c.id).eq("status", "approved");
  try {

  const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
  const today = localToday(c.timezone);
  // Start from the latest of: today, term start, facilitator's preferred start date.
  const from = [today, s.term_start, c.preferred_start].filter(Boolean).sort().pop() as string;
  const startsOn = firstOccurrence(from, c.weekday);
  const recurrence: Record<string, unknown> = {
    type: 2,
    repeat_interval: 1,
    weekly_days: String((c.weekday % 7) + 1), // Zoom: 1 = Sunday .. 7 = Saturday
  };
  let endsOn: string | null = null;
  if (s.term_end) {
    if (s.term_end < startsOn) throw new Error("The term ends before this circle's first session. Check the term dates in Settings.");
    if (weeksBetween(startsOn, s.term_end) > MAX_OCCURRENCES) {
      throw new Error(`Term is longer than ${MAX_OCCURRENCES} weeks; shorten term_end in Settings`);
    }
    recurrence.end_date_time = endUtc(s.term_end, c.timezone);
    endsOn = s.term_end;
  } else {
    recurrence.end_times = MAX_OCCURRENCES;
    const d = new Date(`${startsOn}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * (MAX_OCCURRENCES - 1));
    endsOn = isoDate(d);
  }

  const meeting = c.licence.is_mock ? mockMeeting() : await zoom(`/users/${encodeURIComponent(c.licence.zoom_user_email)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      topic: c.name,
      type: 8,
      start_time: `${startsOn}T${c.start_time.slice(0, 5)}:00`,
      timezone: c.timezone,
      duration: c.duration_min,
      recurrence,
      settings: {
        join_before_host: true,
        jbh_time: 0,
        waiting_room: false,
        mute_upon_entry: true,
        host_video: false,
        participant_video: false,
        approval_type: 2,
        auto_recording: "none",
      },
    }),
  });

  const { data: updated, error } = await db
    .from("circles")
    .update({
      status: "live",
      zoom_meeting_id: String(meeting.id),
      join_url: meeting.join_url,
      passcode: meeting.password ?? null,
      starts_on: startsOn,
      ends_on: endsOn,
    })
    .eq("id", c.id)
    .select("*")
    .single();
  if (error) {
    // Don't leave an orphan Zoom meeting behind.
    if (!c.licence.is_mock) await zoom(`/meetings/${meeting.id}`, { method: "DELETE" }).catch(() => {});
    throw new Error(`Saving failed, so the Zoom meeting was removed again: ${error.message}`);
  }

  let invite = "not sent (approved without email)";
  let email = "not sent (approved without email)";
  if (notify) {
    const team = await circleTeam(c.id, c.facilitator);
    const invites: string[] = [];
    for (const f of team) invites.push(await inviteFacilitator(f.email, { kind: "invite", circle: c, actor }));
    invite = invites.find((x) => x.startsWith("invite failed")) ?? invites[0] ?? "no facilitator";
    email = await sendDetailsToTeam("approved", updated, c.facilitator, c.licence, actor);
  } else {
    await logEmail({ kind: "approved", circle: updated, actor }, c.facilitator?.email ?? null, null, "skipped", "Approved without emailing (admin's choice). Use Resend details when ready.");
  }
  await audit(actor, "provision", c.id, { meeting_id: meeting.id, invite, email, notify, mock: Boolean(c.licence.is_mock) });
  return { status: "live", meeting_id: meeting.id, join_url: meeting.join_url, invite, email, mock: Boolean(c.licence.is_mock) };
  } catch (e) {
    await release();
    throw e;
  }
}

async function cancel(circleId: string, actor: string) {
  const c = await loadCircle(circleId);
  if (c.zoom_meeting_id && !String(c.zoom_meeting_id).startsWith("MOCK")) {
    try {
      await zoom(`/meetings/${c.zoom_meeting_id}`, { method: "DELETE" });
    } catch (e) {
      if (!String(e).includes("404")) throw e;
    }
  }
  await db.from("circles").update({ status: "ended", licence_id: null }).eq("id", c.id);
  await audit(actor, "cancel", c.id, { meeting_id: c.zoom_meeting_id });
  return { status: "ended" };
}

async function resend(circleId: string, actor: string) {
  const c = await loadCircle(circleId);
  if (c.status !== "live") throw new Error("Only live circles have details to send");
  const email = await sendDetailsToTeam("approved", c, c.facilitator, c.licence, actor);
  await audit(actor, "resend", c.id, { email });
  return { email };
}

// Change day/time/length/timezone of a LIVE circle. Moves the existing Zoom meeting,
// so the join link stays the same. Reverts the database if Zoom refuses the change.
const RESCHEDULE_FIELDS = ["weekday", "start_time", "duration_min", "timezone", "preferred_start"];
async function reschedule(circleId: string, actor: string, patch: Record<string, unknown>) {
  const c = await loadCircle(circleId);
  if (c.status !== "live") throw new Error("Only live circles are rescheduled here; edit other circles directly");
  // Only fields that actually differ (a repeated save must not move the meeting or email again).
  const norm = (k: string, v: unknown) => (v == null ? "" : k === "start_time" ? String(v).slice(0, 5) : String(v));
  const clean = Object.fromEntries(Object.entries(patch ?? {})
    .filter(([k, v]) => RESCHEDULE_FIELDS.includes(k) && norm(k, v) !== norm(k, c[k])));
  if (!Object.keys(clean).length) return { status: "live", unchanged: true, email: "not needed (nothing changed)" };
  const old = Object.fromEntries(RESCHEDULE_FIELDS.map((k) => [k, c[k]]));

  const { data: updated, error } = await db.from("circles").update(clean).eq("id", c.id).select("*").single();
  if (error) {
    throw new Error(/no_licence_clash/.test(error.message)
      ? `${c.licence?.label} already has 2 meetings at that time. Pick another time, or move the circle to another licence first.`
      : error.message);
  }

  const today = localToday(updated.timezone ?? c.timezone);
  // Never pull a not-yet-started circle earlier than planned.
  const from = [today, updated.preferred_start, c.starts_on].filter(Boolean).sort().pop() as string;
  const startsOn = firstOccurrence(from, updated.weekday);

  if (!c.licence?.is_mock && c.zoom_meeting_id && !String(c.zoom_meeting_id).startsWith("MOCK")) {
    const recurrence: Record<string, unknown> = { type: 2, repeat_interval: 1, weekly_days: String((updated.weekday % 7) + 1) };
    if (c.ends_on) recurrence.end_date_time = endUtc(c.ends_on, updated.timezone ?? c.timezone);
    else recurrence.end_times = MAX_OCCURRENCES;
    try {
      await zoom(`/meetings/${c.zoom_meeting_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          topic: updated.name,
          start_time: `${startsOn}T${String(updated.start_time).slice(0, 5)}:00`,
          timezone: updated.timezone,
          duration: updated.duration_min,
          recurrence,
        }),
      });
    } catch (e) {
      await db.from("circles").update(old).eq("id", c.id);
      throw e;
    }
  }

  const { data: final } = await db.from("circles").update({ starts_on: startsOn }).eq("id", c.id).select("*").single();
  const email = await sendDetailsToTeam("updated", final, c.facilitator, c.licence, actor);
  await audit(actor, "reschedule", c.id, { from: old, to: clean, email });
  return { status: "live", starts_on: startsOn, email };
}

// Keep the Zoom meeting title in line with the circle name (names follow host, day and time).
async function renameMeeting(circleId: string) {
  const c = await loadCircle(circleId);
  if (c.status !== "live" || !c.zoom_meeting_id || String(c.zoom_meeting_id).startsWith("MOCK")) return { renamed: false };
  await zoom(`/meetings/${c.zoom_meeting_id}`, { method: "PATCH", body: JSON.stringify({ topic: c.name }) });
  return { renamed: true, name: c.name };
}

// Give a circle to a different facilitator, and invite them if the circle is live.
async function handover(circleId: string, actor: string, person: { name?: string; email?: string }) {
  const email = String(person?.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email for the new facilitator is needed");
  const c = await loadCircle(circleId);
  // Reuse an existing facilitator as-is; only create one if new.
  let { data: fac } = await db.from("facilitators").select("*").eq("email", email).maybeSingle();
  if (!fac) {
    const { data: created, error } = await db.from("facilitators")
      .insert({ email, name: person?.name?.trim() || email }).select("*").single();
    if (error) throw new Error(error.message);
    fac = created;
  }
  await db.from("circles").update({ facilitator_id: fac.id }).eq("id", c.id);
  let invite = "not needed yet (circle not live)";
  let sent = "";
  if (c.status === "live") {
    await renameMeeting(c.id).catch(() => {});
    invite = await inviteFacilitator(email, { kind: "invite", circle: c, actor });
    const fresh = await loadCircle(c.id); // name may now follow the new host
    sent = await sendDetailsEmail("approved", fresh, fac, fresh.licence, actor);
  }
  await audit(actor, "handover", c.id, { from: c.facilitator?.email, to: email, invite, email: sent });
  return { invite, email: sent };
}

// End a circle on a given date: the Zoom series stops after that date (same link until then).
// A date today or earlier ends it now.
async function endOn(circleId: string, actor: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) throw new Error("A valid end date is needed");
  const c = await loadCircle(circleId);
  if (date <= localToday(c.timezone)) return cancel(circleId, actor);
  if (c.status !== "live") {
    await db.from("circles").update({ ends_on: date }).eq("id", c.id);
    await audit(actor, "end_on", c.id, { date });
    return { status: c.status, ends_on: date };
  }
  if (!c.licence?.is_mock && c.zoom_meeting_id && !String(c.zoom_meeting_id).startsWith("MOCK")) {
    await zoom(`/meetings/${c.zoom_meeting_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        recurrence: { type: 2, repeat_interval: 1, weekly_days: String((c.weekday % 7) + 1), end_date_time: endUtc(date, c.timezone) },
      }),
    });
  }
  await db.from("circles").update({ ends_on: date }).eq("id", c.id);
  await audit(actor, "end_on", c.id, { date });
  return { status: "live", ends_on: date };
}

// Move a LIVE circle to another licence: new meeting on the new licence's Zoom user,
// facilitator emailed the new link, old meeting deleted. The join link changes.
async function moveLicence(circleId: string, actor: string, licenceId: string) {
  const c = await loadCircle(circleId);
  if (c.status !== "live") throw new Error("Only live circles are moved here; for others pick the licence in the circle panel");
  const { data: target } = await db.from("licences").select("*").eq("id", licenceId).maybeSingle();
  if (!target) throw new Error("Choose a licence to move to");
  if (!target.active) throw new Error(`${target.label} is inactive`);
  if (!target.is_mock && !target.zoom_user_email) throw new Error(`${target.label} has no Zoom user email set`);

  const { error: moveErr } = await db.from("circles").update({ licence_id: target.id }).eq("id", c.id);
  if (moveErr) {
    throw new Error(/no_licence_clash/.test(moveErr.message) ? `${target.label} already has 2 meetings at this circle's time` : moveErr.message);
  }

  const today = localToday(c.timezone);
  const from = [today, c.starts_on].filter(Boolean).sort().pop() as string;
  const startsOn = firstOccurrence(from, c.weekday);
  const recurrence: Record<string, unknown> = { type: 2, repeat_interval: 1, weekly_days: String((c.weekday % 7) + 1) };
  if (c.ends_on) recurrence.end_date_time = endUtc(c.ends_on, c.timezone);
  else recurrence.end_times = MAX_OCCURRENCES;

  let meeting;
  try {
    meeting = target.is_mock ? mockMeeting() : await zoom(`/users/${encodeURIComponent(target.zoom_user_email)}/meetings`, {
      method: "POST",
      body: JSON.stringify({
        topic: c.name, type: 8, start_time: `${startsOn}T${String(c.start_time).slice(0, 5)}:00`,
        timezone: c.timezone, duration: c.duration_min, recurrence,
        settings: { join_before_host: true, jbh_time: 0, waiting_room: false, mute_upon_entry: true,
          host_video: false, participant_video: false, approval_type: 2, auto_recording: "none" },
      }),
    });
  } catch (e) {
    await db.from("circles").update({ licence_id: c.licence_id }).eq("id", c.id);
    throw e;
  }

  const { data: updated } = await db.from("circles").update({
    zoom_meeting_id: String(meeting.id), join_url: meeting.join_url, passcode: meeting.password ?? null, starts_on: startsOn,
  }).eq("id", c.id).select("*").single();

  if (c.zoom_meeting_id && !String(c.zoom_meeting_id).startsWith("MOCK")) {
    await zoom(`/meetings/${c.zoom_meeting_id}`, { method: "DELETE" }).catch(() => {});
  }
  const email = await sendDetailsToTeam("updated", updated, c.facilitator, target, actor);
  await audit(actor, "move_licence", c.id, { from: c.licence?.label, to: target.label, old_meeting: c.zoom_meeting_id, new_meeting: meeting.id, email });
  return { licence: target.label, join_url: meeting.join_url, email };
}

// Pull every licensed Zoom user into Licences: existing licences are matched by Zoom user ID or email
// and get their host key refreshed; new users fill empty licence slots (labels kept) or get a new licence.
// Nothing is deleted or deactivated: licences whose Zoom user wasn't found are reported instead.
async function syncLicences(actor: string) {
  const users: any[] = [];
  let token = "";
  do {
    const page = await zoom(`/users?status=active&page_size=300${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`)
      .catch((e) => {
        throw new Error(/4711|scope|invalid access token/i.test(String(e))
          ? "The Zoom app can't list users. Add the user:read:list_users:admin scope (or user:read:admin) and re-activate the app."
          : String(e));
      });
    users.push(...(page?.users ?? []));
    token = page?.next_page_token ?? "";
  } while (token);
  const licensed = users.filter((u) => u.type === 2);

  const { data: rows } = await db.from("licences").select("*").order("sort_order").order("label");
  const licences = rows ?? [];
  const results: Record<string, unknown>[] = [];
  const used = new Set<string>();
  let nextSort = Math.max(0, ...licences.map((l) => l.sort_order ?? 0)) + 1;
  const labels = new Set(licences.map((l) => l.label));
  const newLabel = () => {
    for (let i = 1; ; i++) { const l = `Licence ${String(i).padStart(2, "0")}`; if (!labels.has(l)) { labels.add(l); return l; } }
  };

  for (const u of licensed) {
    const email = String(u.email).toLowerCase();
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.display_name || "";
    let hostKey: string | null = null;
    let hostKeyNote = "";
    try {
      const detail = await zoom(`/users/${encodeURIComponent(u.id)}`);
      hostKey = detail?.host_key ?? null;
      if (!hostKey) hostKeyNote = "Zoom didn't include a host key";
    } catch (e) {
      hostKeyNote = /4711|scope/i.test(String(e)) ? "missing scope user:read:user:admin" : String(e).slice(0, 160);
    }
    const patch: Record<string, unknown> = { zoom_user_id: u.id, zoom_user_email: email };
    if (hostKey) patch.host_key = hostKey;

    let match = licences.find((l) => !used.has(l.id) && (l.zoom_user_id === u.id || (l.zoom_user_email ?? "").toLowerCase() === email));
    let action = "updated";
    if (!match) {
      match = licences.find((l) => !used.has(l.id) && !l.zoom_user_email && !l.zoom_user_id && !l.is_mock);
      action = "linked to an empty licence";
    }
    if (match) {
      const { error } = await db.from("licences").update(patch).eq("id", match.id);
      if (error) { results.push({ label: match.label, email, name, ok: false, error: error.message }); continue; }
      used.add(match.id);
      results.push({ label: match.label, email, name, ok: true, action, host_key: Boolean(hostKey), host_key_note: hostKeyNote });
    } else {
      const label = newLabel();
      const { data: created, error } = await db.from("licences")
        .insert({ ...patch, label, sort_order: nextSort++, active: true }).select("id").single();
      if (error) { results.push({ label, email, name, ok: false, error: error.message }); continue; }
      used.add(created.id);
      results.push({ label, email, name, ok: true, action: "added", host_key: Boolean(hostKey), host_key_note: hostKeyNote });
    }
  }

  for (const l of licences) {
    if (used.has(l.id) || l.is_mock) continue;
    results.push({
      label: l.label, email: l.zoom_user_email, ok: false,
      action: l.zoom_user_email ? "not found as a licensed Zoom user" : "no Zoom user (empty slot)",
    });
  }
  const summary = { zoom_users: users.length, licensed: licensed.length, results };
  await audit(actor, "sync_licences", null, summary);
  return summary;
}

// Zoom's API no longer returns existing host keys, but it can set one. For one licence:
// make a random 6-digit key, set it on the Zoom user, then save it here. The user's old key stops working.
async function setHostKey(actor: string, licenceId: string) {
  const { data: l } = await db.from("licences").select("*").eq("id", licenceId).maybeSingle();
  if (!l) throw new Error("Licence not found");
  if (!l.zoom_user_id && !l.zoom_user_email) throw new Error(`${l.label} has no Zoom user yet. Run Sync from Zoom first.`);
  const key = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
  try {
    await zoom(`/users/${encodeURIComponent(l.zoom_user_id ?? l.zoom_user_email)}`, { method: "PATCH", body: JSON.stringify({ host_key: key }) });
  } catch (e) {
    throw new Error(/4711|scope/i.test(String(e)) ? "The Zoom app needs the user:update:user:admin scope to set host keys." : String(e));
  }
  const { error } = await db.from("licences").update({ host_key: key }).eq("id", l.id);
  if (error) throw new Error(`Set in Zoom (${key}) but not saved here: ${error.message}. Type it into the licence manually.`);
  await audit(actor, "set_host_key", null, { licence: l.label, replaced: Boolean(l.host_key) });
  return { label: l.label, host_key: key };
}

// Every scheduled meeting on every licence's Zoom account (active or not), with weekly series expanded
// to their day, time and next date. Flags which meetings this system created. Snapshot kept in the audit log.
const ZOOM_DAYS = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
async function listZoomMeetings(actor: string) {
  const { data: licences } = await db.from("licences").select("id, label, zoom_user_id, zoom_user_email, active")
    .not("zoom_user_email", "is", null).order("sort_order");
  const { data: ours } = await db.from("circles").select("id, name, status, zoom_meeting_id").not("zoom_meeting_id", "is", null);
  const byMeeting = new Map((ours ?? []).map((c) => [String(c.zoom_meeting_id), c]));
  const accounts = [];
  for (const l of licences ?? []) {
    const meetings: any[] = [];
    try {
      let token = "";
      do {
        const page = await zoom(`/users/${encodeURIComponent(l.zoom_user_id ?? l.zoom_user_email)}/meetings?type=scheduled&page_size=300${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`);
        meetings.push(...(page?.meetings ?? []));
        token = page?.next_page_token ?? "";
      } while (token);
    } catch (e) {
      const msg = /4711|scope/i.test(String(e)) ? "The Zoom app needs the meeting:read:list_meetings:admin scope" : String(e).slice(0, 200);
      accounts.push({ label: l.label, email: l.zoom_user_email, active: l.active, error: msg, meetings: [] });
      continue;
    }
    const rows = [];
    for (const m of meetings) {
      const row: Record<string, unknown> = {
        id: String(m.id), topic: m.topic, type: m.type === 8 ? "weekly/recurring" : m.type === 3 ? "recurring, no fixed time" : "one-off",
        start_time: m.start_time ?? null, duration: m.duration ?? null, timezone: m.timezone ?? null,
      };
      if (m.type === 8) {
        try {
          const d = await zoom(`/meetings/${m.id}`);
          const r = d?.recurrence ?? {};
          const days = String(r.weekly_days ?? "").split(",").filter(Boolean).map((n: string) => ZOOM_DAYS[Number(n)]).join(", ");
          const next = (d?.occurrences ?? []).find((o: any) => o.status !== "deleted" && Date.parse(o.start_time) > Date.now());
          Object.assign(row, {
            repeats: r.type === 2 ? `weekly${days ? ` on ${days}` : ""}${r.repeat_interval > 1 ? ` (every ${r.repeat_interval} weeks)` : ""}` : r.type === 1 ? "daily" : r.type === 3 ? "monthly" : "recurring",
            next: next?.start_time ?? null,
            ends: r.end_date_time ?? (r.end_times ? `after ${r.end_times} sessions` : null),
            sessions_left: (d?.occurrences ?? []).filter((o: any) => Date.parse(o.start_time) > Date.now()).length,
          });
        } catch { /* keep the summary row */ }
      }
      const circle = byMeeting.get(String(m.id));
      if (circle) Object.assign(row, { circle: circle.name, circle_status: circle.status });
      rows.push(row);
    }
    accounts.push({ label: l.label, email: l.zoom_user_email, active: l.active, meetings: rows });
  }
  const summary = { taken_at: new Date().toISOString(), accounts };
  await audit(actor, "zoom_meetings_snapshot", null, summary);
  return summary;
}

// ---------- Attendance (any admin) ----------
// Zoom past-meeting UUIDs that start with "/" or contain "//" must be encoded twice.
const encUuid = (u: string) => (u.startsWith("/") || u.includes("//") ? encodeURIComponent(encodeURIComponent(u)) : encodeURIComponent(u));
const ATTENDANCE_BATCH = 60; // new sessions per run, to stay inside the function time limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPORT_DAYS = 180; // Zoom reports reach back about six months
const SCOPE_HELP = "The Zoom app needs the report:read:user:admin and report:read:list_meeting_participants:admin scopes";

// Merge rejoins: one row per person (email if Zoom has it, otherwise the display name). Waiting room entries are ignored.
function mergePeople(parts: any[]) {
  const byPerson = new Map<string, any>();
  for (const p of parts) {
    if (p.status === "in_waiting_room") continue;
    const email = String(p.user_email ?? "").trim().toLowerCase();
    const name = String(p.name ?? "").trim();
    const key = email || name.toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const cur = byPerson.get(key) ?? { person_key: key, name, email: email || null, first_join: p.join_time, last_leave: p.leave_time, seconds: 0 };
    cur.seconds += Number(p.duration ?? 0);
    if (p.join_time && (!cur.first_join || p.join_time < cur.first_join)) cur.first_join = p.join_time;
    if (p.leave_time && (!cur.last_leave || p.leave_time > cur.last_leave)) cur.last_leave = p.leave_time;
    if (!cur.name && name) cur.name = name;
    byPerson.set(key, cur);
  }
  return [...byPerson.values()];
}

async function allPages(path: string, key: string) {
  const out: any[] = [];
  let token = "";
  do {
    const page = await zoom(`${path}${path.includes("?") ? "&" : "?"}page_size=300${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`);
    out.push(...(page?.[key] ?? []));
    token = page?.next_page_token ?? "";
  } while (token);
  return out;
}

// Every past meeting held on every licence account (Zoom usage reports, last six months), with who joined.
// Meetings made by this system are linked to their circle; anything else is kept under its Zoom topic.
// Stored in Supabase for good: Zoom drops reports after about six months, this copy stays.
// Incremental: each account keeps a cursor (attendance_scanned_to). A sync starts a few days before it,
// skips sessions already stored, and moves the cursor forward one 30-day window at a time as each window
// completes. A run stops after ATTENDANCE_BATCH sessions or ~100 seconds and the next run carries on.
const RUN_BUDGET_MS = 100_000;
async function syncAttendance(actor: string) {
  // One sync at a time (several open tabs would otherwise race each other). The lock expires after 3 minutes.
  const { data: lock } = await db.from("settings").update({ attendance_sync_lock: new Date().toISOString() })
    .eq("id", 1).or(`attendance_sync_lock.is.null,attendance_sync_lock.lt.${new Date(Date.now() - 180_000).toISOString()}`).select("id");
  if (!lock?.length) return { busy: true, sessions_added: 0, more: false, problems: [] };
  try {
    return await syncAttendanceRun(actor);
  } finally {
    await db.from("settings").update({ attendance_sync_lock: null }).eq("id", 1);
  }
}

// Which of these Zoom session UUIDs are already stored (looked up per batch: no 1,000-row cap).
async function storedUuids(uuids: string[]) {
  const have = new Set<string>();
  for (let i = 0; i < uuids.length; i += 100) {
    const { data } = await db.from("attendance_sessions").select("zoom_uuid").in("zoom_uuid", uuids.slice(i, i + 100));
    for (const r of data ?? []) have.add(r.zoom_uuid);
  }
  return have;
}

async function syncAttendanceRun(actor: string) {
  const startedRun = Date.now();
  const { data: licences } = await db.from("licences").select("id, label, zoom_user_id, zoom_user_email, attendance_scanned_to")
    .not("zoom_user_email", "is", null).order("sort_order");
  const { data: circles } = await db.from("circles").select("id, name, zoom_meeting_id").not("zoom_meeting_id", "is", null);
  const circleByMeeting = new Map((circles ?? []).map((c) => [String(c.zoom_meeting_id), c]));
  const seen = new Set<string>();
  const problems: string[] = [];
  const today = new Date();
  const earliest = new Date(today.getTime() - REPORT_DAYS * 86400e3);
  let added = 0, people = 0, more = false, windows = 0;

  // Record one past meeting and who joined it. Returns false if it should be retried on a later sync.
  async function record(m: any, l: any) {
    let parts: any[] = [];
    try {
      parts = await allPages(`/report/meetings/${encUuid(m.uuid)}/participants`, "participants");
    } catch (e) {
      const msg = String(e);
      if (/4711|scope/i.test(msg)) throw new Error(SCOPE_HELP);
      // 404: Zoom kept no participant report (for example nobody joined). Recorded as an empty session.
      if (!/404|3001/.test(msg)) { problems.push(`${m.topic} ${m.start_time}: ${msg.slice(0, 120)}`); return false; }
    }
    const rows = mergePeople(parts);
    const circle = circleByMeeting.get(String(m.id));
    const endedAt = m.end_time ?? rows.map((r) => r.last_leave).filter(Boolean).sort().pop() ?? null;
    const { data: session, error } = await db.from("attendance_sessions").insert({
      circle_id: circle?.id ?? null, circle_name: circle?.name ?? m.topic ?? null, topic: m.topic ?? null,
      licence_label: l.label, host_email: l.zoom_user_email,
      zoom_meeting_id: String(m.id), zoom_uuid: m.uuid,
      started_at: m.start_time, ended_at: endedAt, participant_count: rows.length,
    }).select("id").single();
    if (error) {
      if (error.code === "23505") { seen.add(m.uuid); return true; } // already stored
      problems.push(`${m.topic}: ${error.message}`); return false;
    }
    if (rows.length) {
      const { error: e2 } = await db.from("attendance").insert(rows.map((r) => ({
        session_id: session.id, person_key: r.person_key, name: r.name || null, email: r.email,
        first_join: r.first_join ?? null, last_leave: r.last_leave ?? null, minutes: Math.round(r.seconds / 60),
      })));
      if (e2) problems.push(`${m.topic}: ${e2.message}`);
    }
    seen.add(m.uuid);
    added++;
    people += rows.length;
    return true;
  }

  accounts: for (const l of licences ?? []) {
    let from = l.attendance_scanned_to ? new Date(Date.parse(l.attendance_scanned_to) - 3 * 86400e3) : earliest;
    if (from < earliest) from = earliest;
    let clean = true; // the cursor only moves past windows with nothing left to retry
    while (from <= today) {
      const to = new Date(Math.min(from.getTime() + 29 * 86400e3, today.getTime()));
      let meetings: any[];
      try {
        meetings = await allPages(`/report/users/${encodeURIComponent(l.zoom_user_id ?? l.zoom_user_email)}/meetings?type=past&from=${isoDate(from)}&to=${isoDate(to)}`, "meetings");
      } catch (e) {
        const msg = String(e);
        if (/4711|scope/i.test(msg)) throw new Error(SCOPE_HELP);
        if (/paid|pro/i.test(msg) && /only|require/i.test(msg)) throw new Error("Zoom only provides meeting reports on paid (Pro or higher) accounts");
        if (!/404|1001/.test(msg)) problems.push(`${l.label}: ${msg.slice(0, 120)}`); // 1001: user no longer exists
        continue accounts;
      }
      windows++;
      const stored = await storedUuids(meetings.map((m) => m.uuid).filter(Boolean));
      const fresh = meetings.filter((m) => m.uuid && !seen.has(m.uuid) && !stored.has(m.uuid))
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
      for (const m of fresh) {
        if (added >= ATTENDANCE_BATCH || Date.now() - startedRun > RUN_BUDGET_MS) { more = true; break accounts; }
        if (!(await record(m, l))) clean = false;
        await sleep(150);
      }
      if (clean) await db.from("licences").update({ attendance_scanned_to: isoDate(to) }).eq("id", l.id);
      from = new Date(to.getTime() + 86400e3);
      await sleep(150);
    }
  }

  const summary = { sessions_added: added, attendances_added: people, windows_checked: windows, more, problems: problems.slice(0, 10) };
  await audit(actor, "sync_attendance", null, summary);
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Caller must be a signed-in admin.
  const auth = req.headers.get("Authorization") ?? "";
  const { data: userData } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  const email = userData?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Not signed in" }, 401);
  const { data: admin } = await db.from("admin_emails").select("email").eq("email", email).maybeSingle();
  if (!admin) return json({ error: "Admins only" }, 403);

  try {
    const { action, circle_id, patch, facilitator, date, licence_id, template_key, template, notify } = await req.json();
    switch (action) {
      case "provision": return json(await provision(circle_id, email, notify !== false));
      case "cancel": return json(await cancel(circle_id, email));
      case "resend": return json(await resend(circle_id, email));
      case "sync_licences": return json(await syncLicences(email));
      case "reschedule": return json(await reschedule(circle_id, email, patch));
      case "handover": return json(await handover(circle_id, email, facilitator));
      case "end_on": return json(await endOn(circle_id, email, date));
      case "move_licence": return json(await moveLicence(circle_id, email, licence_id));
      case "sync_attendance": return json(await syncAttendance(email));
      case "list_zoom_meetings": return json(await listZoomMeetings(email));
      case "rename": return json(await renameMeeting(circle_id));
      case "set_host_key": return json(await setHostKey(email, licence_id));
      case "invite_admin": return json(await inviteAdmin(email, facilitator?.email));
      case "test_email": return json(await testEmail(circle_id, email, template_key === "updated" ? "updated" : "approved", template));
      default: return json({ error: `Unknown action ${action}` }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 400);
  }
});
