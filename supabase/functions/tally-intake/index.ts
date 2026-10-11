// Receives Think Gita "Request to Facilitate a Circle" Tally submissions,
// stores the facilitator and circle, and allocates a Zoom licence.
// Auth: Tally webhook signature (HMAC-SHA256, base64) checked against TALLY_SIGNING_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const SIGNING_SECRET = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";
// Optional: only accept submissions from this Tally form (the id at the end of the form link).
const FORM_ID = (Deno.env.get("TALLY_FORM_ID") ?? "").trim();
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

// Co-host (optional second facilitator). The form may label the fields "Co-host email" and so on, or repeat the host's
// "First Name" / "Email Address" fields after a co-host question. Either way they are split off here so the host's
// answers never mix with the co-host's.
const COHOST = /co[\s-]?host|co[\s-]?facilitat|second facilitator|other facilitator|additional facilitator/;
const PERSON = /name|e-?mail|phone|whatsapp|mobile|number/;
const isPerson = (f: TallyField) => f.type === "INPUT_EMAIL" || f.type === "INPUT_PHONE_NUMBER" || PERSON.test(lower(f));
const personKind = (f: TallyField) =>
  f.type === "INPUT_EMAIL" || /e-?mail/.test(lower(f)) ? "email"
  : f.type === "INPUT_PHONE_NUMBER" || /phone|whatsapp|mobile/.test(lower(f)) ? "phone"
  : /initiated/.test(lower(f)) ? "initiated" : /first/.test(lower(f)) ? "first" : /last|surname/.test(lower(f)) ? "last"
  : /name/.test(lower(f)) ? "name" : null;
export function splitCohost(fields: TallyField[]) {
  // Tally adds a derived "(Yes)" checkbox field per option: skip those.
  const gateIdx = fields.findIndex((f) => COHOST.test(lower(f)) && !/\((yes|no)\)\s*$/.test(lower(f)));
  if (gateIdx < 0) {
    // No co-host question: a second set of person fields (say a second "First Name" after the host's email) is still
    // the co-host's.
    const seen: string[] = [];
    let start = -1;
    for (let i = 0; i < fields.length && start < 0; i++) {
      const k = isPerson(fields[i]) ? personKind(fields[i]) : null;
      if (k && seen.includes(k) && seen.includes("email")) start = i;
      else if (k) seen.push(k);
    }
    if (start < 0) return { host: fields, cohost: [] as TallyField[], gate: undefined };
    const cohost = fields.filter((f, i) => i >= start && isPerson(f) && personKind(f) !== null);
    return { host: fields.filter((f) => !cohost.includes(f)), cohost, gate: undefined };
  }
  // When the co-host's fields are labelled ("Co-Facilitator Phone Number"), only labelled fields are theirs: the
  // host's own fields can come after the question too (the live form asks it before the host's phone number).
  // Otherwise, fields after the question that repeat one of the host's (a second "Email Address") mean the person
  // fields after it are the co-host's.
  const labelled = fields.some((f) => COHOST.test(lower(f)) && isPerson(f) && personKind(f) !== null);
  const before = new Set(fields.slice(0, gateIdx).filter(isPerson).map(personKind));
  const after = (f: TallyField, i: number) => i > gateIdx && isPerson(f) && personKind(f) !== null;
  const repeated = !labelled && fields.some((f, i) => after(f, i) && before.has(personKind(f)));
  const cohost = fields.filter((f, i) => COHOST.test(lower(f)) || (repeated && after(f, i)));
  return { host: fields.filter((f) => !cohost.includes(f)), cohost, gate: fields[gateIdx] };
}
export type Cohost = { email: string; first_name: string | null; last_name: string | null; initiated_name: string | null; phone: string | null; photo_url?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The co-host's details, or why they couldn't be used. null when there is no co-host.
export function parseCohost(cohost: TallyField[], gate?: TallyField): { cohost: Cohost | null; problem: string | null } {
  if (!cohost.length) return { cohost: null, problem: null };
  const answer = gate && !isPerson(gate) ? text(gate) : "";
  if (/^(no|false)\b/i.test(answer)) return { cohost: null, problem: null };
  const pick = (kind: string) => text(cohost.find((f) => personKind(f) === kind && text(f)));
  let first = pick("first"), last = pick("last");
  const full = pick("name");
  if (!first && !last && full) { const w = full.split(/\s+/); first = w[0]; last = w.slice(1).join(" "); }
  // A free-text answer ("Priya, priya@example.org") still gives an email.
  const typed = pick("email").toLowerCase();
  const found = cohost.map((f) => text(f).match(/[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}/i)?.[0]).find(Boolean)?.toLowerCase() ?? "";
  const email = EMAIL_RE.test(typed) ? typed : found || typed;
  const out = { email, first_name: first || null, last_name: last || null, initiated_name: pick("initiated") || null, phone: pick("phone") || null };
  const named = [out.initiated_name, [first, last].filter(Boolean).join(" ")].filter(Boolean).join(" / ");
  if (!email && !named && !out.phone) return { cohost: null, problem: null };
  if (!EMAIL_RE.test(email)) return { cohost: null, problem: `Co-host ${named || "given"} but ${email ? `"${email}" is not a valid email` : "no email"}: add them by hand.` };
  return { cohost: out, problem: null };
}
const cohostLabel = (c: Cohost) => {
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return `${c.initiated_name ? `${c.initiated_name}${full ? ` (${full})` : ""}` : full || c.email}`;
};

// Photo upload on the form ("Please upload a non-devotional picture of yourself"). Tally's file links are signed and
// expire, so the photo is copied into our own public facilitator-photos bucket straight away.
const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX = 5 * 1024 * 1024;
type TallyFile = { url?: string; name?: string; mimeType?: string; size?: number };
export function photoFile(fields: TallyField[]): TallyFile | null {
  const f = fields.find((x) => x.type === "FILE_UPLOAD" && /picture|photo|image|headshot/.test(lower(x)));
  const file = Array.isArray(f?.value) ? (f!.value as TallyFile[])[0] : null;
  return file?.url ? file : null;
}
// Copies a form photo into <folder>/ of the photo bucket. Returns its public link, or why it couldn't be used.
export async function copyPhoto(file: TallyFile, folder: string): Promise<{ url?: string; problem?: string }> {
  const what = file.name ? `"${file.name}"` : "The photo";
  const declared = String(file.mimeType ?? "").toLowerCase();
  if (declared && !PHOTO_TYPES[declared]) return { problem: `${what} from the form is ${declared.replace("image/", "").toUpperCase()}; only JPEG, PNG or WebP can be shown. Add a photo by hand.` };
  if (Number(file.size) > PHOTO_MAX) return { problem: `${what} from the form is over 5 MB. Add a smaller photo by hand.` };
  try {
    const res = await fetch(String(file.url));
    if (!res.ok) return { problem: `${what} from the form couldn't be downloaded (${res.status}). Add a photo by hand.` };
    const type = (res.headers.get("content-type") ?? declared).split(";")[0].trim().toLowerCase();
    const ext = PHOTO_TYPES[type];
    if (!ext) return { problem: `${what} from the form isn't a JPEG, PNG or WebP image. Add a photo by hand.` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > PHOTO_MAX) return { problem: `${what} from the form is over 5 MB. Add a smaller photo by hand.` };
    const path = `${folder}/${Date.now()}.${ext}`;
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type === "image/jpg" ? "image/jpeg" : type, cacheControl: "31536000", upsert: false });
    if (error) return { problem: `${what} from the form couldn't be saved: ${error.message}` };
    return { url: db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (e) {
    return { problem: `${what} from the form couldn't be copied: ${e instanceof Error ? e.message : String(e)}` };
  }
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
  // "7:30-8:30pm": the am/pm at the end applies to the start too.
  const ampm = m[3] ?? s.match(/(am|pm)/)?.[1];
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
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
  // Dhaka before Almaty: Tally's "(GMT+6) Almaty, Dhaka" option means UTC+6, and Almaty itself moved to UTC+5 in 2024.
  ["dhaka", "Asia/Dhaka"], ["almaty", "Asia/Almaty"], ["colombo", "Asia/Colombo"],
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

// Photos from earlier forms: circles from Tally whose facilitator has no photo but whose form had one. Tally's links
// expire, so older ones may no longer download; those are reported, not retried. Run by hand with the cron secret.
export async function copyFormPhotos() {
  const { data: rows } = await db.from("circles").select("id, raw_submission, facilitator:facilitators!circles_facilitator_id_fkey(id, photo_url)")
    .eq("source", "tally").order("created_at", { ascending: false }).limit(200);
  const results: { circle_id: string; result: string }[] = [];
  const done = new Set<string>();
  for (const c of rows ?? []) {
    const fac = (c as any).facilitator;
    if (!fac || fac.photo_url || done.has(fac.id)) continue;
    const { host } = splitCohost((c as any).raw_submission?.data?.fields ?? []);
    const file = photoFile(host);
    if (!file) continue;
    done.add(fac.id);
    const r = await copyPhoto(file, fac.id);
    if (r.url) await db.from("facilitators").update({ photo_url: r.url }).eq("id", fac.id).is("photo_url", null);
    results.push({ circle_id: c.id, result: r.url ? "copied" : r.problem ?? "not copied" });
  }
  await audit("form_photos", { results });
  return { results };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const { data: ok } = await db.rpc("framer_cron_ok", { s: cronSecret });
    if (ok !== true) return json({ error: "Forbidden" }, 403);
    const action = (await req.json().catch(() => ({})))?.action;
    if (action === "copy_photos") return json(await copyFormPhotos());
    return json({ error: "Unknown action" }, 400);
  }
  const body = await req.text();

  if (!SIGNING_SECRET) return json({ error: "TALLY_SIGNING_SECRET not configured" }, 500);
  if (!(await validSignature(body, req.headers.get("tally-signature")))) {
    return json({ error: "invalid signature" }, 401);
  }

  const payload = JSON.parse(body);
  const data = payload?.data ?? {};
  if (payload?.eventType && payload.eventType !== "FORM_RESPONSE") return json({ ok: true, ignored: payload.eventType });
  if (FORM_ID && data.formId && data.formId !== FORM_ID) {
    await audit("intake_ignored", { reason: "different form", formId: data.formId, formName: data.formName });
    return json({ ok: true, ignored: "different form" });
  }
  const allFields: TallyField[] = data.fields ?? [];
  const { host: fields, cohost: cohostFields, gate } = splitCohost(allFields);
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
    await audit("intake_failed", { submissionId, problems, fields: allFields });
    // 200 so Tally does not retry; the failure is visible in Settings > Activity.
    return json({ ok: false, problems });
  }

  let { cohost, problem: cohostProblem } = parseCohost(cohostFields, gate);
  if (cohost && cohost.email === email) { cohost = null; cohostProblem = "Co-host email is the same as the host's, so no co-host was added."; }

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const displayName = initiated ? `${initiated} (${fullName || email})` : fullName || email;

  // Existing facilitators are never overwritten by a public form; only empty fields are filled in.
  let { data: fac } = await db.from("facilitators").select("*").eq("email", email).maybeSingle();
  if (fac) {
    const fill: Record<string, string> = {};
    if (!fac.phone && phone) fill.phone = phone;
    if (!fac.first_name && firstName) fill.first_name = firstName;
    if (!fac.last_name && lastName) fill.last_name = lastName;
    if (!fac.initiated_name && initiated) fill.initiated_name = initiated;
    if (Object.keys(fill).length) await db.from("facilitators").update(fill).eq("id", fac.id);
  } else {
    const { data: created, error: facErr } = await db.from("facilitators").insert({
      name: displayName, email, phone: phone || null,
      first_name: firstName || null, last_name: lastName || null, initiated_name: initiated || null,
    }).select("*").single();
    if (facErr) {
      await audit("intake_failed", { submissionId, error: facErr.message });
      return json({ error: facErr.message }, 500);
    }
    fac = created;
  }

  // Their photo from the form, when they don't have one yet (a form never replaces a photo already on file).
  let photoProblem: string | null = null;
  const hostPhoto = photoFile(fields);
  if (hostPhoto && !fac.photo_url) {
    const r = await copyPhoto(hostPhoto, fac.id);
    if (r.url) await db.from("facilitators").update({ photo_url: r.url }).eq("id", fac.id);
    else photoProblem = r.problem ?? null;
  }
  // A co-host's photo is kept with their details until approval, in a folder of its own.
  const cohostPhoto = cohost ? photoFile(cohostFields) : null;
  if (cohost && cohostPhoto) {
    const r = await copyPhoto(cohostPhoto, `cohost-${String(submissionId).replace(/[^A-Za-z0-9_-]/g, "")}`);
    if (r.url) cohost.photo_url = r.url;
    else photoProblem = [photoProblem, `Co-host: ${r.problem}`].filter(Boolean).join("\n");
  }

  // Flag likely duplicates: same facilitator already has a circle that isn't ended or rejected.
  const { data: existing } = await db.from("circles").select("name")
    .eq("facilitator_id", fac.id).not("status", "in", "(ended,rejected)");

  const notes = [
    specify && `Specified: ${specify}`,
    !tzExact && tzLabel && `Timezone "${tzLabel}" was not recognised exactly; check it.`,
    existing?.length && `Possible duplicate: this facilitator already has ${existing.map((c) => `"${c.name}"`).join(", ")}.`,
    cohost && `Co-host: ${cohostLabel(cohost)}, ${cohost.email}. Added as a co-facilitator when the circle is approved.`,
    cohostProblem,
    photoProblem,
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
      pending_cohost: cohost,
    })
    .select("id")
    .single();

  if (circErr) {
    if (circErr.code === "23505") {
      // Tally retry of a submission we already have: make sure it isn't stuck without a licence.
      const { data: prev } = await db.from("circles").select("id,status").eq("tally_submission_id", submissionId).maybeSingle();
      if (prev?.status === "conflict") await db.rpc("allocate_circle", { p_circle: prev.id });
      return json({ ok: true, duplicate: true });
    }
    await audit("intake_failed", { submissionId, error: circErr.message });
    return json({ error: circErr.message }, 500);
  }

  const { data: allocated, error: allocErr } = await db.rpc("allocate_circle", { p_circle: circle.id });
  await audit("intake", {
    submissionId, status: allocated?.status, preference_used: allocated?.preference_used,
    timezone: tz, error: allocErr?.message, cohost: cohost?.email ?? (cohostProblem ? "not added" : undefined),
  }, circle.id);

  return json({ ok: true, circle_id: circle.id, status: allocated?.status });
});
