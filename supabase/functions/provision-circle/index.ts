// Admin-only actions that touch Zoom and email.
// POST { action: "provision" | "cancel" | "resend" | "sync_licences", circle_id? }
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID") ?? "";
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const MAX_OCCURRENCES = 50;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---------- Zoom ----------
let zoomToken: string | null = null;
async function zoom(path: string, init: RequestInit = {}) {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error("Zoom credentials are not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)");
  }
  if (!zoomToken) {
    const r = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
      { method: "POST", headers: { Authorization: "Basic " + btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`) } },
    );
    if (!r.ok) throw new Error(`Zoom auth failed: ${r.status} ${await r.text()}`);
    zoomToken = (await r.json()).access_token;
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
// First date on/after `from` that falls on ISO weekday (1 = Mon .. 7 = Sun).
function firstOccurrence(from: string, weekday: number) {
  const d = new Date(`${from}T12:00:00Z`);
  const cur = ((d.getUTCDay() + 6) % 7) + 1;
  d.setUTCDate(d.getUTCDate() + ((weekday - cur + 7) % 7));
  return isoDate(d);
}
function weeksBetween(a: string, b: string) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / (7 * 86400000)) + 1;
}

// ---------- Email ----------
async function sendDetailsEmail(circle: any, facilitator: any, licence: any) {
  if (!RESEND_API_KEY || !EMAIL_FROM) return "skipped (RESEND_API_KEY / EMAIL_FROM not set)";
  const when = `${DAY_NAMES[circle.weekday]}s at ${circle.start_time.slice(0, 5)} (${circle.timezone})`;
  const html = `
    <p>Hi ${facilitator.name},</p>
    <p>Your circle <b>${circle.name}</b> is set up on Zoom. It runs every ${when} for ${circle.duration_min} minutes,
    from ${circle.starts_on} until ${circle.ends_on ?? "further notice"}.</p>
    <p><b>Join link:</b> <a href="${circle.join_url}">${circle.join_url}</a><br/>
    <b>Meeting ID:</b> ${circle.zoom_meeting_id}<br/>
    <b>Passcode:</b> ${circle.passcode ?? "none"}<br/>
    <b>Host key:</b> ${licence.host_key ?? "ask the ThinkGita team"}</p>
    <p>To run the session: join with the link, open <i>Participants</i>, choose <i>Claim host</i> and enter the host key.
    The link stays the same every week, so you can pin it in your WhatsApp group.</p>
    ${APP_URL ? `<p>You can always see these details at <a href="${APP_URL}">${APP_URL}</a> by signing in with this email address.</p>` : ""}
    <p>Thank you for leading a circle.</p>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: facilitator.email, subject: `Your circle: ${circle.name}`, html }),
  });
  return r.ok ? "sent" : `failed: ${r.status} ${await r.text()}`;
}

async function inviteFacilitator(email: string) {
  const { error } = await db.auth.admin.inviteUserByEmail(email, APP_URL ? { redirectTo: APP_URL } : undefined);
  if (!error) return "invited";
  if (/already/i.test(error.message)) return "already has an account";
  return `invite failed: ${error.message}`;
}

async function audit(actor: string, action: string, circle_id: string | null, detail: unknown) {
  await db.from("audit_log").insert({ actor, action, circle_id, detail });
}

async function loadCircle(id: string) {
  const { data, error } = await db
    .from("circles")
    .select("*, facilitator:facilitators(*), licence:licences(*)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Actions ----------
async function provision(circleId: string, actor: string) {
  const c = await loadCircle(circleId);
  if (!["pending", "approved"].includes(c.status)) throw new Error(`Circle is ${c.status}, not pending`);
  if (!c.licence) throw new Error("Circle has no licence assigned");
  if (!c.licence.zoom_user_email) throw new Error(`${c.licence.label} has no Zoom user email set`);
  if (!c.facilitator) throw new Error("Circle has no facilitator");

  const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
  const today = isoDate(new Date());
  const from = s.term_start && s.term_start > today ? s.term_start : today;
  const startsOn = firstOccurrence(from, c.weekday);
  const recurrence: Record<string, unknown> = {
    type: 2,
    repeat_interval: 1,
    weekly_days: String((c.weekday % 7) + 1), // Zoom: 1 = Sunday .. 7 = Saturday
  };
  let endsOn: string | null = null;
  if (s.term_end) {
    if (weeksBetween(startsOn, s.term_end) > MAX_OCCURRENCES) {
      throw new Error(`Term is longer than ${MAX_OCCURRENCES} weeks; shorten term_end in Settings`);
    }
    recurrence.end_date_time = `${s.term_end}T23:59:00Z`;
    endsOn = s.term_end;
  } else {
    recurrence.end_times = MAX_OCCURRENCES;
    const d = new Date(`${startsOn}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * (MAX_OCCURRENCES - 1));
    endsOn = isoDate(d);
  }

  const meeting = await zoom(`/users/${encodeURIComponent(c.licence.zoom_user_email)}/meetings`, {
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
  if (error) throw new Error(`Meeting ${meeting.id} created but saving failed: ${error.message}`);

  const invite = await inviteFacilitator(c.facilitator.email);
  const email = await sendDetailsEmail(updated, c.facilitator, c.licence);
  await audit(actor, "provision", c.id, { meeting_id: meeting.id, invite, email });
  return { status: "live", meeting_id: meeting.id, join_url: meeting.join_url, invite, email };
}

async function cancel(circleId: string, actor: string) {
  const c = await loadCircle(circleId);
  if (c.zoom_meeting_id) {
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
  const email = await sendDetailsEmail(c, c.facilitator, c.licence);
  await audit(actor, "resend", c.id, { email });
  return { email };
}

async function syncLicences(actor: string) {
  const { data: licences } = await db.from("licences").select("*").not("zoom_user_email", "is", null);
  const results = [];
  for (const l of licences ?? []) {
    try {
      const u = await zoom(`/users/${encodeURIComponent(l.zoom_user_email)}`);
      const patch: Record<string, unknown> = { zoom_user_id: u.id };
      if (u.host_key) patch.host_key = u.host_key;
      await db.from("licences").update(patch).eq("id", l.id);
      results.push({ label: l.label, ok: true, licensed: u.type === 2, host_key: Boolean(u.host_key) });
    } catch (e) {
      results.push({ label: l.label, ok: false, error: String(e) });
    }
  }
  await audit(actor, "sync_licences", null, results);
  return { results };
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
    const { action, circle_id } = await req.json();
    switch (action) {
      case "provision": return json(await provision(circle_id, email));
      case "cancel": return json(await cancel(circle_id, email));
      case "resend": return json(await resend(circle_id, email));
      case "sync_licences": return json(await syncLicences(email));
      default: return json({ error: `Unknown action ${action}` }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 400);
  }
});
