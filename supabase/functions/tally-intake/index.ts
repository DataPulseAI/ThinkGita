// Receives Tally form submissions, stores the circle, and allocates a Zoom licence.
// Auth: Tally webhook signature (HMAC-SHA256, base64) checked against TALLY_SIGNING_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const SIGNING_SECRET = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type TallyField = {
  key: string;
  label: string | null;
  type: string;
  value: unknown;
  options?: { id: string; text: string }[];
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function validSignature(body: string, signature: string | null) {
  if (!SIGNING_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function text(f: TallyField | undefined): string {
  if (!f || f.value == null) return "";
  if (Array.isArray(f.value)) {
    return f.value
      .map((v) => f.options?.find((o) => o.id === v)?.text ?? String(v))
      .join(", ");
  }
  return String(f.value).trim();
}

// Find a field by label keywords. `exclude` stops "Circle name" matching "your name".
function find(fields: TallyField[], include: string[], exclude: string[] = [], type?: string) {
  if (type) {
    const byType = fields.find((f) => f.type === type);
    if (byType) return byType;
  }
  return fields.find((f) => {
    const l = (f.label ?? "").toLowerCase();
    return include.some((k) => l.includes(k)) && !exclude.some((k) => l.includes(k));
  });
}

const DAYS: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

export function parseDay(raw: string): number | null {
  const s = raw.toLowerCase();
  for (const [k, v] of Object.entries(DAYS)) if (s.includes(k)) return v;
  return null;
}

export function parseTime(raw: string): string | null {
  const s = raw.toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(\d{1,2})(?::|\.)?(\d{2})?(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseDuration(raw: string, fallback: number): number {
  const s = raw.toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return fallback;
  if (s.includes("hour") || s.includes("hr") || n <= 4) return Math.round(n * 60);
  return Math.round(n);
}

async function audit(action: string, detail: unknown, circle_id: string | null = null) {
  await db.from("audit_log").insert({ actor: "tally", action, circle_id, detail });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const body = await req.text();

  if (!SIGNING_SECRET) return json({ error: "TALLY_SIGNING_SECRET not configured" }, 500);
  if (!(await validSignature(body, req.headers.get("tally-signature")))) {
    return json({ error: "invalid signature" }, 401);
  }

  const payload = JSON.parse(body);
  const data = payload?.data ?? {};
  const fields: TallyField[] = data.fields ?? [];
  const submissionId: string = data.responseId ?? data.submissionId ?? payload.eventId;

  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();

  const circleName = text(find(fields, ["circle name", "group name", "name of circle", "name of your circle"]));
  const facName = text(find(fields, ["your name", "full name", "facilitator", "sanchalak", "name"], ["circle", "group"]));
  const email = text(find(fields, ["email"], [], "INPUT_EMAIL")).toLowerCase();
  const phone = text(find(fields, ["phone", "whatsapp", "mobile"], [], "INPUT_PHONE_NUMBER"));
  const dayRaw = text(find(fields, ["day"], ["today"]));
  const timeRaw = text(find(fields, ["time"], ["timezone", "time zone"], "INPUT_TIME"));
  const durRaw = text(find(fields, ["duration", "how long", "length"]));
  const tzRaw = text(find(fields, ["timezone", "time zone"]));

  const weekday = parseDay(dayRaw);
  const start = parseTime(timeRaw);
  const duration = durRaw ? parseDuration(durRaw, settings.default_duration_min) : settings.default_duration_min;

  const problems: string[] = [];
  if (!email) problems.push("email missing");
  if (!weekday) problems.push(`could not read day from "${dayRaw}"`);
  if (!start) problems.push(`could not read time from "${timeRaw}"`);
  if (problems.length) {
    await audit("intake_failed", { submissionId, problems, fields });
    // 200 so Tally does not retry; the failure is visible in the dashboard activity log.
    return json({ ok: false, problems });
  }

  const { data: fac, error: facErr } = await db
    .from("facilitators")
    .upsert({ name: facName || email, email, phone: phone || null }, { onConflict: "email" })
    .select("id")
    .single();
  if (facErr) {
    await audit("intake_failed", { submissionId, error: facErr.message });
    return json({ error: facErr.message }, 500);
  }

  const { data: circle, error: circErr } = await db
    .from("circles")
    .insert({
      name: circleName || `${facName || email}'s circle`,
      facilitator_id: fac.id,
      weekday,
      start_time: start,
      duration_min: duration,
      timezone: tzRaw && tzRaw.includes("/") ? tzRaw : settings.default_timezone,
      source: "tally",
      tally_submission_id: submissionId,
      raw_submission: payload,
    })
    .select("id")
    .single();

  if (circErr) {
    if (circErr.code === "23505") return json({ ok: true, duplicate: true }); // Tally retry
    await audit("intake_failed", { submissionId, error: circErr.message });
    return json({ error: circErr.message }, 500);
  }

  const { data: allocated, error: allocErr } = await db.rpc("allocate_circle", { p_circle: circle.id });
  await audit("intake", { submissionId, status: allocated?.status, error: allocErr?.message }, circle.id);

  return json({ ok: true, circle_id: circle.id, status: allocated?.status });
});
