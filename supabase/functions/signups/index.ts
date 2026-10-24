// Circle attendees: the "Think Gita Circles Sign Up" Tally form (zxRkR8), stored in circle_signups and linked to circles.
// POST from Tally (webhook, signed with TALLY_SIGNING_SECRET): stores one sign-up.
// POST from the dashboard (signed-in admin) or with the cron secret:
//   { action: "sync", form_id? }   backfill every completed sign-up from the Tally API (TALLY_API_KEY); once per 15 minutes
//   { action: "rematch" }          try again to link sign-ups that are still waiting under "Needs matching"
// Linking a sign-up to its circle:
//   1. the hidden field circle_id (the full circle id, or its first 8 characters) from the dashboard's sign-up link
//   2. older links without it: the same WhatsApp group link, else the facilitator's name with the language, course and
//      start date. Only a single clear match is linked; anything else waits for an admin with the likely circles listed.
// Admin choices (manual, none) are never changed by a later sync or rematch.
import { createClient } from "npm:@supabase/supabase-js@2";

const SIGNING_SECRET = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";
const TALLY_API_KEY = (Deno.env.get("TALLY_API_KEY") ?? "").trim();
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// The sign-up forms whose webhook submissions are stored. Older forms can be backfilled with { action: "sync", form_id }.
const SIGNUP_FORMS = ["zxRkR8"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function validSignature(body: string, signature: string | null) {
  if (!SIGNING_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/* ---------------- Answers ---------------- */

type TallyField = { key?: string; label: string | null; type: string; value: unknown; options?: { id: string; text: string }[] };
export type Answer = { label: string; type: string; value: string };

// One Tally field as text: choices use their option text.
export function answerText(f: { value: unknown; options?: { id: string; text: string }[] }): string {
  const v = f.value;
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => f.options?.find((o) => o.id === x)?.text ?? String(x)).join(", ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(String).join(", ");
  return String(v).trim();
}

// Webhook fields to answers. Tally adds a derived "(Yes)" field per checkbox option: those are left out.
export function toAnswers(fields: TallyField[]): Answer[] {
  return (fields ?? [])
    .filter((f) => !(f.type === "CHECKBOXES" && /\([^)]*\)\s*$/.test(f.label ?? "") && typeof f.value === "boolean"))
    .map((f) => ({ label: String(f.label ?? f.key ?? "").trim(), type: f.type, value: answerText(f) }));
}

// One submission from the API in the webhook's shape. Hidden fields come as an object or one field each.
export function apiAnswers(questions: any[], submission: any): Answer[] {
  const out: Answer[] = [];
  for (const r of submission?.responses ?? []) {
    const q = (questions ?? []).find((x: any) => x.id === r.questionId);
    const type = String(q?.type ?? r.type ?? "");
    const value = r.answer ?? r.value ?? r.formattedAnswer;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) out.push({ label: k, type: type || "HIDDEN_FIELDS", value: v == null ? "" : String(v) });
      continue;
    }
    const options = q?.fields?.[0]?.options ?? q?.options;
    const label = String(q?.title ?? q?.label ?? q?.fields?.[0]?.title ?? q?.fields?.[0]?.label ?? r.questionId ?? "").trim();
    out.push({ label, type, value: answerText({ value, options }) });
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const low = (a: Answer) => a.label.toLowerCase();
const firstOf = (answers: Answer[], test: (a: Answer) => boolean) => answers.find((a) => test(a) && a.value)?.value ?? "";
const nul = (s: string) => (s && s.trim() ? s.trim() : null);
const UTM_KEYS = ["utm_facilitator", "utm_course", "utm_lang", "utm_date", "utm_wagrp", "circle_id", "circle_name"];

// The columns stored for one sign-up, from its answers.
export function signupFields(answers: Answer[]) {
  const utm: Record<string, string> = {};
  for (const a of answers) {
    const k = a.label.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (UTM_KEYS.includes(k) && a.value) utm[k] = a.value.trim();
  }
  const isHidden = (a: Answer) => UTM_KEYS.includes(a.label.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const qs = answers.filter((a) => !isHidden(a));
  const email = (firstOf(qs, (a) => a.type === "INPUT_EMAIL") || firstOf(qs, (a) => /e-?mail/.test(low(a)) && EMAIL_RE.test(a.value))).toLowerCase();
  const dob = firstOf(qs, (a) => a.type === "INPUT_DATE" || /date of birth|birthday/.test(low(a)));
  const heardIdx = qs.findIndex((a) => /hear about/.test(low(a)));
  let heard = heardIdx >= 0 ? qs[heardIdx].value : "";
  // "Other": the text box under the question (it has no title of its own, or one that says other).
  if (/^other$/i.test(heard)) {
    const next = qs.slice(heardIdx + 1).find((a) => a.type === "INPUT_TEXT");
    if (next?.value && (!next.label || /other|specify|hear about/.test(low(next)))) heard = `Other: ${next.value}`;
  }
  const yes = (re: RegExp) => {
    const a = qs.find((x) => re.test(low(x)));
    return a ? /\byes\b|^true$/i.test(a.value) : null;
  };
  return {
    first_name: nul(firstOf(qs, (a) => /first name|forename|given name/.test(low(a)))),
    last_name: nul(firstOf(qs, (a) => /last name|surname|family name/.test(low(a)))),
    email: EMAIL_RE.test(email) ? email : null,
    phone: nul(firstOf(qs, (a) => a.type === "INPUT_PHONE_NUMBER") || firstOf(qs, (a) => /whatsapp number|phone|mobile/.test(low(a)))),
    city: nul(firstOf(qs, (a) => /\bcity\b/.test(low(a)))),
    country: nul(firstOf(qs, (a) => a.type === "RESPONDENT_COUNTRY" || /^country/.test(low(a)))),
    date_of_birth: /^\d{4}-\d{2}-\d{2}/.test(dob) ? dob.slice(0, 10) : null,
    // "How familiar are you with the Bhagavad-gita (1-5)?" (since 24 Oct), earlier "Have you read the Bhagavad-gita before?"
    read_before: nul(firstOf(qs, (a) => /familiar\b.*gita|read the (bhagavad.)?gita/.test(low(a)))),
    heard_from: nul(heard),
    goals: nul(firstOf(qs, (a) => /inspiration|goals/.test(low(a)))),
    whatsapp_active: yes(/active on whatsapp/),
    consent: yes(/i agree|consent/),
    utm,
  };
}

/* ---------------- Matching ---------------- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LANG_CODE: Record<string, string> = {
  English: "Eng", Spanish: "Esp", Hindi: "Hin", Portuguese: "Por", Greek: "Gre", Italian: "Ita", French: "Fra", Slovak: "Slk", Czech: "Cze", Polish: "Pol",
};
const LANGS = [...Object.keys(LANG_CODE), "Norwegian", "Bengali", "Croatian", "Dutch", "Tamil", "German", "Russian"];
const langCode = (lang: string) => (LANG_CODE[lang] ?? (lang.slice(0, 3).charAt(0).toUpperCase() + lang.slice(1, 3).toLowerCase())).toLowerCase();
// Statuses a circle can have and still be the one somebody signed up for.
const MATCHABLE = ["approved", "live", "paused", "ended"];

// "Ananda-rupa Krsna das" -> ["ananda", "rupa", "krsna", "das"]
export const words = (s: string) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !["das", "dasi", "devi", "and", "prabhu", "mataji", "pr"].includes(w));

// The WhatsApp invite code ("https://chat.whatsapp.com/AbC12?mode=x" -> "abc12").
export function waCode(link: string | null | undefined) {
  const m = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]+)/i.exec(String(link ?? ""));
  return m ? m[1].toLowerCase() : null;
}

// "18Oct26" -> "2026-10-18"
export function parseUtmDate(s: string | null | undefined) {
  const m = /^(\d{1,2})([A-Za-z]{3})(\d{2,4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

type Person = { name?: string | null; initiated_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
export type MatchCircle = {
  id: string; name: string; name_auto?: boolean; status: string; language?: string | null; circle_type?: string | null;
  starts_on?: string | null; preferred_start?: string | null; ends_on?: string | null; whatsapp_group_link?: string | null;
  facilitator?: Person; cofacilitators?: { facilitator: Person }[];
};

// Every name the circle's hosts go by: initiated name, name, first name, and the name in an imported Zoom title.
function hostWordSets(c: MatchCircle): string[][] {
  const out: string[][] = [];
  const segs = String(c.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!c.name_auto && /^TG\b/i.test(segs[0] ?? "") && segs.length >= 3) {
    for (const s of segs.slice(2)) if (!/\d/.test(s) && !LANGS.includes(s)) for (const part of s.split(/&| and /)) out.push(words(part));
  }
  for (const p of [c.facilitator, ...(c.cofacilitators ?? []).map((x) => x.facilitator)]) {
    if (!p) continue;
    for (const n of [p.initiated_name, p.name, [p.first_name, p.last_name].filter(Boolean).join(" ")]) {
      const w = words(n ?? "");
      if (w.length && !String(n).includes("@")) out.push(w);
    }
  }
  return out.filter((w) => w.length);
}

// Does the facilitator name in the link belong to this circle? Each person named in the link ("A & B") must share their
// first word, or be wholly contained in, one of the circle's host names.
export function hostMatches(utmName: string, c: MatchCircle) {
  const people = String(utmName ?? "").split(/&| and /i).map(words).filter((w) => w.length);
  if (!people.length) return false;
  const hosts = hostWordSets(c);
  return people.some((p) => hosts.some((h) => h[0] === p[0] || p.every((w) => h.includes(w)) || h.every((w) => p.includes(w))));
}

export type Match = { circle_id: string | null; method: "link" | "auto" | null; note: string | null; candidates: string[] };

export function matchCircle(utm: Record<string, string>, circles: MatchCircle[]): Match {
  const none = (note: string | null, candidates: string[] = []): Match => ({ circle_id: null, method: null, note, candidates: candidates.slice(0, 5) });
  const one = (c: MatchCircle, method: "link" | "auto", note: string): Match => ({ circle_id: c.id, method, note, candidates: [] });

  // 1. The circle id from the link.
  const cid = String(utm.circle_id ?? "").trim().toLowerCase();
  if (cid) {
    const hit = UUID_RE.test(cid) ? circles.filter((c) => c.id === cid) : /^[0-9a-f]{8}$/.test(cid) ? circles.filter((c) => c.id.startsWith(cid)) : [];
    if (hit.length === 1) return one(hit[0], "link", "Circle id in the sign-up link");
  }
  const pool = circles.filter((c) => MATCHABLE.includes(c.status));
  // The circle name from the link (a circle id that no longer exists, for example).
  const cname = String(utm.circle_name ?? "").trim().toLowerCase();
  if (cname) {
    const hit = pool.filter((c) => c.name.trim().toLowerCase() === cname);
    if (hit.length === 1) return one(hit[0], "auto", "Circle name in the sign-up link");
  }

  // 2. Older links. Narrow by language, course and date where the link says them.
  const lang = String(utm.utm_lang ?? "").trim().toLowerCase();
  const course = String(utm.utm_course ?? "").trim().toLowerCase();
  const date = parseUtmDate(utm.utm_date);
  const fits = (c: MatchCircle) =>
    (!lang || langCode(c.language || "English") === lang) &&
    (!course || (course === "beg") === /beginner/i.test(c.circle_type ?? ""));
  const sameDate = (c: MatchCircle) => Boolean(date) && (c.starts_on === date || c.preferred_start === date);

  const wa = waCode(utm.utm_wagrp);
  if (wa) {
    const hit = pool.filter((c) => waCode(c.whatsapp_group_link) === wa);
    if (hit.length === 1) return one(hit[0], "auto", "Same WhatsApp group");
    if (hit.length > 1) {
      const narrowed = hit.filter((c) => utm.utm_facilitator && hostMatches(utm.utm_facilitator, c));
      if (narrowed.length === 1) return one(narrowed[0], "auto", "Same WhatsApp group and facilitator");
      return none(`${hit.length} circles share this WhatsApp group`, hit.map((c) => c.id));
    }
  }

  if (!utm.utm_facilitator) return none(Object.keys(utm).length ? "No facilitator in the sign-up link" : "No details from a sign-up link");
  const byHost = pool.filter((c) => hostMatches(utm.utm_facilitator, c));
  if (!byHost.length) return none(`No circle hosted by ${utm.utm_facilitator}`);
  const fitting = byHost.filter(fits);
  const dated = fitting.filter(sameDate);
  if (dated.length === 1) return one(dated[0], "auto", "Facilitator, language and start date");
  if (fitting.length === 1) return one(fitting[0], "auto", "Facilitator and language");
  if (fitting.length > 1) return none(`${fitting.length} circles by ${utm.utm_facilitator}`, (dated.length ? dated : fitting).map((c) => c.id));
  return none(`${utm.utm_facilitator} hosts a circle, but not in this language or course`, byHost.map((c) => c.id));
}

/* ---------------- Storing ---------------- */

const CIRCLE_SELECT = "id, name, name_auto, status, language, circle_type, starts_on, preferred_start, ends_on, whatsapp_group_link, " +
  "facilitator:facilitators!circles_facilitator_id_fkey(name, initiated_name, first_name, last_name), " +
  "cofacilitators:circle_cofacilitators(facilitator:facilitators(name, initiated_name, first_name, last_name))";
async function loadCircles(): Promise<MatchCircle[]> {
  const { data, error } = await db.from("circles").select(CIRCLE_SELECT).eq("is_demo", false);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MatchCircle[];
}

type Sub = { formId: string; responseId: string; submittedAt: string; answers: Answer[] };
function row(s: Sub, circles: MatchCircle[]) {
  const f = signupFields(s.answers);
  const m = matchCircle(f.utm, circles);
  return {
    response_id: s.responseId, form_id: s.formId, submitted_at: s.submittedAt, ...f, answers: s.answers,
    circle_id: m.circle_id, match_method: m.method, match_note: m.note, match_candidates: m.candidates,
    matched_by: m.method ? "system" : null, matched_at: m.method ? new Date().toISOString() : null,
  };
}
// An admin's choice stands: those rows keep their circle when the submission is stored again.
const MATCH_COLS = ["circle_id", "match_method", "match_note", "match_candidates", "matched_by", "matched_at"];
async function storeMany(subs: Sub[], circles: MatchCircle[]) {
  if (!subs.length) return { stored: 0, linked: 0, waiting: 0 };
  const { data: existing } = await db.from("circle_signups").select("response_id, match_method").in("response_id", subs.map((s) => s.responseId));
  const kept = new Set((existing ?? []).filter((r) => r.match_method === "manual" || r.match_method === "none").map((r) => r.response_id));
  const rows = subs.map((s) => {
    const r: Record<string, unknown> = row(s, circles);
    if (kept.has(s.responseId)) for (const k of MATCH_COLS) delete r[k];
    return r;
  });
  // Rows that keep an admin's match are written without the match columns, separately so the upsert columns line up.
  const keepRows = rows.filter((r) => !("circle_id" in r));
  const fresh = rows.filter((r) => "circle_id" in r);
  for (const batch of [fresh, keepRows]) {
    if (!batch.length) continue;
    const { error } = await db.from("circle_signups").upsert(batch, { onConflict: "response_id" });
    if (error) throw new Error(error.message);
  }
  return {
    stored: rows.length,
    linked: fresh.filter((r) => r.circle_id).length,
    waiting: fresh.filter((r) => !r.circle_id).length,
  };
}

/* ---------------- Tally API (backfill) ---------------- */

async function tally(path: string) {
  if (!TALLY_API_KEY) throw new Error("The Tally API key isn't set yet (Supabase secret TALLY_API_KEY).");
  const r = await fetch(`https://api.tally.so${path}`, { headers: { Authorization: `Bearer ${TALLY_API_KEY}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`Tally ${path.split("?")[0]} failed: ${r.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

const SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
async function sync(actor: string, formId?: string) {
  const form = formId ? String(formId).trim() : SIGNUP_FORMS[0];
  if (!/^[A-Za-z0-9]{4,12}$/.test(form)) throw new Error("That isn't a Tally form id");
  const { data: st } = await db.from("settings").select("signups_synced_at").eq("id", 1).maybeSingle();
  const last = st?.signups_synced_at ? Date.parse(st.signups_synced_at) : 0;
  if (last && Date.now() - last < SYNC_COOLDOWN_MS) {
    const mins = Math.max(1, Math.round((Date.now() - last) / 60000));
    throw new Error(`cooldown: synced ${mins} minute${mins === 1 ? "" : "s"} ago, try again after ${hhmm(last + SYNC_COOLDOWN_MS)}`);
  }
  await db.from("settings").update({ signups_synced_at: new Date().toISOString() }).eq("id", 1);
  const circles = await loadCircles();
  const total = { found: 0, stored: 0, linked: 0, waiting: 0 };
  for (let page = 1; page <= 100; page++) {
    const r = await tally(`/forms/${form}/submissions?page=${page}&limit=100&filter=completed`);
    const subs = (r?.submissions ?? []).filter((s: any) => s.isCompleted !== false);
    total.found += subs.length;
    const out = await storeMany(subs.map((s: any) => ({
      formId: form, responseId: String(s.id), submittedAt: s.submittedAt ?? s.createdAt ?? new Date().toISOString(),
      answers: apiAnswers(r.questions ?? [], s),
    })), circles);
    total.stored += out.stored; total.linked += out.linked; total.waiting += out.waiting;
    if (!r?.hasMore || !(r?.submissions ?? []).length) break;
  }
  await db.from("audit_log").insert({ actor, action: "signups_sync", circle_id: null, detail: { form, ...total } });
  return total;
}

// Sign-ups still waiting (no circle and no admin choice): try again, e.g. after a WhatsApp link was added to a circle.
async function rematch(actor: string) {
  const circles = await loadCircles();
  let linked = 0, checked = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("circle_signups").select("id, utm").is("circle_id", null).is("match_method", null)
      .order("submitted_at").range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      checked++;
      const m = matchCircle(s.utm ?? {}, circles);
      const patch = m.circle_id
        ? { circle_id: m.circle_id, match_method: m.method, match_note: m.note, match_candidates: [], matched_by: "system", matched_at: new Date().toISOString() }
        : { match_note: m.note, match_candidates: m.candidates };
      if (m.circle_id) linked++;
      await db.from("circle_signups").update(patch).eq("id", s.id).is("match_method", null);
    }
    if (!data || data.length < 500) break;
  }
  await db.from("audit_log").insert({ actor, action: "signups_rematch", circle_id: null, detail: { checked, linked } });
  return { checked, linked, waiting: checked - linked };
}

/* ---------------- Entry ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();

  // Tally webhook.
  const signature = req.headers.get("tally-signature");
  if (signature) {
    if (!(await validSignature(raw, signature))) return json({ error: "Bad signature" }, 401);
    try {
      const payload = JSON.parse(raw);
      const d = payload?.data ?? {};
      const formId = String(d.formId ?? "");
      if (!SIGNUP_FORMS.includes(formId)) return json({ result: "ignored", form_id: formId });
      const sub = {
        formId, responseId: String(d.responseId ?? d.submissionId ?? payload.eventId),
        submittedAt: d.createdAt ?? payload.createdAt ?? new Date().toISOString(), answers: toAnswers(d.fields ?? []),
      };
      const out = await storeMany([sub], await loadCircles());
      return json({ result: out.linked ? "linked" : "waiting" });
    } catch (e) {
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // Dashboard (admin) or cron secret.
  let actor = "";
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data: ok } = await db.rpc("framer_cron_ok", { s: cron });
    if (ok) actor = "cron";
  }
  if (!actor) {
    const auth = req.headers.get("Authorization") ?? "";
    const { data: userData } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    const email = userData?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Not signed in" }, 401);
    const { data: admin } = await db.from("admin_emails").select("email").eq("email", email).maybeSingle();
    if (!admin) return json({ error: "Admins only" }, 403);
    actor = email;
  }
  try {
    const body = raw ? JSON.parse(raw) : {};
    switch (body.action) {
      case "sync": return json(await sync(actor, body.form_id));
      case "rematch": return json(await rematch(actor));
      default: return json({ error: `Unknown action ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
