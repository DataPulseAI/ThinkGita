// Receives Think Gita "Request to Facilitate a Circle" Tally submissions,
// stores the facilitator and circle, and allocates a Zoom licence.
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

export function text(f: TallyField | undefined): string {
  if (!f || f.value == null) return "";
  if (Array.isArray(f.value)) {
    return f.value
      .map((v) => f.options?.find((o) => o.id === v)?.text ?? String(v))
      .join(", ");
  }
  return String(f.value).trim();
}

const lower = (f: TallyField) => (f.label ?? "").toLowerCase();

// First field whose label contains any `include` keyword and no `exclude` keyword.
export function find(fields: TallyField[], include: string[], exclude: string[] = []) {
  return fields.find((f) => include.some((k) => lower(f).includes(k)) && !exclude.some((k) => lower(f).includes(k)));
}

// The form has "Day" and "Time" twice (first and second preference).
// Use "first"/"second" in the label if present, otherwise the order in the form.
export function preferencePair(fields: TallyField[], pattern: RegExp, exclude: RegExp) {
  const matches = fields.filter((f) => pattern.test(lower(f)) && !exclude.test(lower(f)));
  const first = matches.find((f) => /first|1st/.test(lower(f))) ?? matches.find((f) => !/second|2nd/.test(lower(f)));
  const second = matches.find((f) => /second|2nd/.test(lower(f))) ?? matches.find((f) => f !== first);
  return [first, second] as const;
}

const DAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

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

// Tally's timezone dropdown uses fixed "(GMT +x:00) City" labels. Map each to a real
// IANA zone so daylight saving is handled. Order matters: first keyword match wins.
const TZ_KEYWORDS: [string, string][] = [
  ["eniwetok", "Etc/GMT+12"], ["kwajalein", "Etc/GMT+12"],
  ["midway", "Pacific/Pago_Pago"], ["samoa", "Pacific/Pago_Pago"],
  ["hawaii", "Pacific/Honolulu"], ["taiohae", "Pacific/Marquesas"], ["alaska", "America/Anchorage"],
  ["pacific time", "America/Los_Angeles"], ["mountain time", "America/Denver"],
  ["central time", "America/Chicago"], ["mexico city", "America/Mexico_City"],
  ["eastern time", "America/New_York"], ["bogota", "America/Bogota"], ["lima", "America/Lima"],
  ["atlantic time", "America/Halifax"], ["la paz", "America/La_Paz"], ["caracas", "America/Caracas"],
  ["newfoundland", "America/St_Johns"],
  ["brazil", "America/Sao_Paulo"], ["buenos aires", "America/Argentina/Buenos_Aires"], ["georgetown", "America/Guyana"],
  ["mid-atlantic", "Atlantic/South_Georgia"],
  ["azores", "Atlantic/Azores"], ["cape verde", "Atlantic/Cape_Verde"],
  ["london", "Europe/London"], ["lisbon", "Europe/Lisbon"], ["casablanca", "Africa/Casablanca"],
  ["western europe", "Europe/London"], ["dublin", "Europe/Dublin"],
  ["brussels", "Europe/Brussels"], ["copenhagen", "Europe/Copenhagen"], ["madrid", "Europe/Madrid"], ["paris", "Europe/Paris"],
  ["kaliningrad", "Europe/Kaliningrad"], ["south africa", "Africa/Johannesburg"], ["cairo", "Africa/Cairo"],
  ["baghdad", "Asia/Baghdad"], ["riyadh", "Asia/Riyadh"], ["moscow", "Europe/Moscow"], ["st. petersburg", "Europe/Moscow"],
  ["nairobi", "Africa/Nairobi"],
  ["tehran", "Asia/Tehran"],
  ["abu dhabi", "Asia/Dubai"], ["muscat", "Asia/Muscat"], ["baku", "Asia/Baku"], ["tbilisi", "Asia/Tbilisi"],
  ["kabul", "Asia/Kabul"],
  ["ekaterinburg", "Asia/Yekaterinburg"], ["islamabad", "Asia/Karachi"], ["karachi", "Asia/Karachi"], ["tashkent", "Asia/Tashkent"],
  ["bombay", "Asia/Kolkata"], ["calcutta", "Asia/Kolkata"], ["madras", "Asia/Kolkata"], ["new delhi", "Asia/Kolkata"],
  ["mumbai", "Asia/Kolkata"], ["kolkata", "Asia/Kolkata"], ["chennai", "Asia/Kolkata"],
  ["kathmandu", "Asia/Kathmandu"],
  ["almaty", "Asia/Almaty"], ["dhaka", "Asia/Dhaka"], ["colombo", "Asia/Colombo"],
  ["yangon", "Asia/Yangon"], ["mandalay", "Asia/Yangon"],
  ["bangkok", "Asia/Bangkok"], ["hanoi", "Asia/Bangkok"], ["jakarta", "Asia/Jakarta"],
  ["beijing", "Asia/Shanghai"], ["perth", "Australia/Perth"], ["singapore", "Asia/Singapore"], ["hong kong", "Asia/Hong_Kong"],
  ["eucla", "Australia/Eucla"],
  ["tokyo", "Asia/Tokyo"], ["seoul", "Asia/Seoul"], ["osaka", "Asia/Tokyo"], ["sapporo", "Asia/Tokyo"], ["yakutsk", "Asia/Yakutsk"],
  ["adelaide", "Australia/Adelaide"], ["darwin", "Australia/Darwin"],
  ["eastern australia", "Australia/Sydney"], ["guam", "Pacific/Guam"], ["vladivostok", "Asia/Vladivostok"],
  ["lord howe", "Australia/Lord_Howe"],
  ["magadan", "Asia/Magadan"], ["solomon", "Pacific/Guadalcanal"], ["new caledonia", "Pacific/Noumea"],
  ["norfolk", "Pacific/Norfolk"],
  ["auckland", "Pacific/Auckland"], ["wellington", "Pacific/Auckland"], ["fiji", "Pacific/Fiji"], ["kamchatka", "Asia/Kamchatka"],
  ["chatham", "Pacific/Chatham"],
  ["apia", "Pacific/Apia"], ["nukualofa", "Pacific/Tongatapu"],
  ["line islands", "Pacific/Kiritimati"], ["tokelau", "Pacific/Fakaofo"],
];

export function toTimezone(label: string, fallback: string): { tz: string; exact: boolean } {
  const s = label.toLowerCase();
  if (/^[a-z]+\/[a-z_\/]+$/i.test(label.trim())) return { tz: label.trim(), exact: true };
  for (const [k, tz] of TZ_KEYWORDS) if (s.includes(k)) return { tz, exact: true };
  // Whole-hour offset with no recognised city: fixed offset (no daylight saving).
  const m = s.match(/gmt\s*([+-])\s*(\d{1,2}):00/);
  if (m && Number(m[2]) > 0) return { tz: `Etc/GMT${m[1] === "+" ? "-" : "+"}${Number(m[2])}`, exact: false };
  if (/gmt\s*(0|\+0|-0)?:?00?\)/.test(s) || /\(gmt\)/.test(s)) return { tz: "Europe/London", exact: false };
  return { tz: fallback, exact: false };
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

  const firstName = text(find(fields, ["first name"]));
  const lastName = text(find(fields, ["last name", "surname"]));
  const initiated = text(find(fields, ["initiated"]));
  const email = text(fields.find((f) => f.type === "INPUT_EMAIL") ?? find(fields, ["email"])).toLowerCase();
  const phone = text(fields.find((f) => f.type === "INPUT_PHONE_NUMBER") ?? find(fields, ["phone", "whatsapp", "mobile"]));
  const specify = text(find(fields, ["please specify"]));
  const circleType = text(find(fields, ["wish to facilitate", "facilitate a"]));
  const [day1, day2] = preferencePair(fields, /\bday\b/, /today|birthday|date/);
  const [time1, time2] = preferencePair(fields, /\btime\b/, /zone/);
  const tzLabel = text(find(fields, ["time zone", "timezone"]));
  const language = text(find(fields, ["language"]));
  const startRaw = text(find(fields, ["start date", "preferred start"]));

  const weekday = parseDay(text(day1));
  const start = parseTime(text(time1));
  const altWeekday = parseDay(text(day2));
  const altStart = parseTime(text(time2));
  const { tz, exact: tzExact } = toTimezone(tzLabel, settings.default_timezone);
  const preferredStart = /^\d{4}-\d{2}-\d{2}/.test(startRaw) ? startRaw.slice(0, 10) : null;

  const problems: string[] = [];
  if (!email) problems.push("email missing");
  if (!weekday) problems.push(`could not read first preference day from "${text(day1)}"`);
  if (!start) problems.push(`could not read first preference time from "${text(time1)}"`);
  if (problems.length) {
    await audit("intake_failed", { submissionId, problems, fields });
    // 200 so Tally does not retry; the failure is visible in Settings > Activity.
    return json({ ok: false, problems });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const displayName = initiated ? `${initiated} (${fullName || email})` : fullName || email;

  const { data: fac, error: facErr } = await db
    .from("facilitators")
    .upsert({
      name: displayName, email, phone: phone || null,
      first_name: firstName || null, last_name: lastName || null, initiated_name: initiated || null,
    }, { onConflict: "email" })
    .select("id")
    .single();
  if (facErr) {
    await audit("intake_failed", { submissionId, error: facErr.message });
    return json({ error: facErr.message }, 500);
  }

  const notes = [
    specify && `Specified: ${specify}`,
    !tzExact && tzLabel && `Timezone "${tzLabel}" was not recognised exactly; check it.`,
  ].filter(Boolean).join("\n") || null;

  const { data: circle, error: circErr } = await db
    .from("circles")
    .insert({
      name: `${initiated || fullName || email}${circleType ? ` (${circleType})` : ""}`,
      facilitator_id: fac.id,
      weekday,
      start_time: start,
      alt_weekday: altWeekday && altStart ? altWeekday : null,
      alt_start_time: altWeekday && altStart ? altStart : null,
      duration_min: settings.default_duration_min,
      timezone: tz,
      timezone_label: tzLabel || null,
      circle_type: circleType || null,
      language: language || null,
      preferred_start: preferredStart,
      notes,
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
  await audit("intake", {
    submissionId, status: allocated?.status, preference_used: allocated?.preference_used,
    timezone: tz, error: allocErr?.message,
  }, circle.id);

  return json({ ok: true, circle_id: circle.id, status: allocated?.status });
});
