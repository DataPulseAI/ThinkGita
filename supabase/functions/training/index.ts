// Facilitator training: the application and training forms from Tally, and the final Certified / Not certified email.
// POST from Tally (webhook, signed with TALLY_SIGNING_SECRET): stores the submission.
//   Application form: creates or updates the trainee (and copies their photo).
//   Training forms: linked to the trainee by the hidden field `tid` (the trainee id, added to each form link), else by
//   email; anything else waits under "Needs matching" on the Training page.
// POST from the dashboard (signed-in admin) or with the cron secret:
//   { action: "probe" }                        is the Tally API key set, and which forms can it see
//   { action: "sync", form_key? }              backfill every submission from the Tally API (TALLY_API_KEY)
//   { action: "file", response_id }            fresh answers (and so fresh file links) for one submission, e.g. to play a video
//   { action: "send_form", emails: [{ trainee_id, form_key, subject, text, html }] }
//                                              send trainees a training form (their next one), up to 50 at a time
//   { action: "decide", trainee_id, decision: "certified" | "not_certified", send, subject?, text?, html? }
//                                              record the outcome and (optionally) send the email the admin wrote
//                                              (rendered on the dashboard with emailTemplate.js render())
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const SIGNING_SECRET = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";
const TALLY_API_KEY = (Deno.env.get("TALLY_API_KEY") ?? "").trim();
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const EMAIL_FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") ?? "Think Gita Circles";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type TallyFile = { url?: string; name?: string; mimeType?: string; size?: number };
type TallyField = { key?: string; label: string | null; type: string; value: unknown; options?: { id: string; text: string }[] };
// What is stored for each answer: the question, its type, the answer as text, and any uploaded files.
export type Answer = { label: string; type: string; value: string; files?: TallyFile[] };
type FormRow = { key: string; label: string; form_id: string | null; name_match: string | null };

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

const isFile = (v: unknown) => Boolean(v && typeof v === "object" && "url" in (v as object));
// One Tally field as text: choices use their option text, files are listed by name.
export function answerText(f: { value: unknown; options?: { id: string; text: string }[] }): string {
  const v = f.value;
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v.map((x) => (isFile(x) ? String((x as TallyFile).name ?? "file") : f.options?.find((o) => o.id === x)?.text ?? String(x))).join(", ");
  }
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(String).join(", ");
  return String(v).trim();
}

// Webhook fields to stored answers. Tally adds a derived "(Yes)" field per checkbox option: those are left out.
export function toAnswers(fields: TallyField[]): Answer[] {
  return (fields ?? [])
    .filter((f) => !(f.type === "CHECKBOXES" && /\([^)]*\)\s*$/.test(f.label ?? "") && typeof f.value === "boolean"))
    .map((f) => {
      const files = Array.isArray(f.value) ? (f.value as unknown[]).filter(isFile).map((x) => {
        const { url, name, mimeType, size } = x as TallyFile;
        return { url, name, mimeType, size };
      }) : [];
      return { label: String(f.label ?? f.key ?? "").trim(), type: f.type, value: answerText(f), ...(files.length ? { files } : {}) };
    });
}

const low = (a: Answer) => a.label.toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstOf = (answers: Answer[], test: (a: Answer) => boolean) => answers.find((a) => test(a) && a.value)?.value ?? "";

// The person on a form: email (the email question first), names and phone.
export function person(answers: Answer[]) {
  const email = (firstOf(answers, (a) => a.type === "INPUT_EMAIL") || firstOf(answers, (a) => /e-?mail/.test(low(a)) && EMAIL_RE.test(a.value))).toLowerCase();
  const initiated = firstOf(answers, (a) => /initiated|spiritual name/.test(low(a)));
  const first = firstOf(answers, (a) => /first name|forename|given name/.test(low(a)) && !/initiated/.test(low(a)));
  const last = firstOf(answers, (a) => /last name|surname|family name/.test(low(a)));
  const full = first || last ? "" : firstOf(answers, (a) => /^(full )?name\b|your name/.test(low(a)) && !/initiated/.test(low(a)));
  const words = full.split(/\s+/).filter(Boolean);
  const phone = firstOf(answers, (a) => a.type === "INPUT_PHONE_NUMBER") || firstOf(answers, (a) => /phone|whatsapp|mobile/.test(low(a)));
  return {
    email: EMAIL_RE.test(email) ? email : "",
    first_name: first || words[0] || "",
    last_name: last || words.slice(1).join(" "),
    initiated_name: initiated,
    phone,
  };
}

// The trainee id carried in the form link (?tid=...), from the hidden field.
export function trainingId(answers: Answer[]): string | null {
  const v = answers.find((a) => /^(tid|trainee[ _-]?id)$/i.test(a.label))?.value?.trim() ?? "";
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

// Which training form a submission came from: its Tally form id, else its name (until the id is known).
export function formFor(forms: FormRow[], formId: string, formName: string): FormRow | null {
  const byId = forms.find((f) => f.form_id && f.form_id === formId);
  if (byId) return byId;
  const name = String(formName ?? "").toLowerCase();
  return forms.find((f) => !f.form_id && f.name_match && new RegExp(f.name_match, "i").test(name)) ?? null;
}

/* ---------------- Photo (application form) ---------------- */

const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX = 5 * 1024 * 1024;
export function photoOf(answers: Answer[]): TallyFile | null {
  const a = answers.find((x) => x.type === "FILE_UPLOAD" && /picture|photo|image|headshot/.test(low(x)) && x.files?.length);
  return a?.files?.[0]?.url ? a.files[0] : null;
}
// Tally's file links expire, so the photo is copied into our public bucket. Returns its link, or null.
async function copyPhoto(file: TallyFile, folder: string): Promise<string | null> {
  const declared = String(file.mimeType ?? "").toLowerCase();
  if ((declared && !PHOTO_TYPES[declared]) || Number(file.size) > PHOTO_MAX) return null;
  try {
    const res = await fetch(String(file.url));
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? declared).split(";")[0].trim().toLowerCase();
    const ext = PHOTO_TYPES[type];
    if (!ext) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > PHOTO_MAX) return null;
    const path = `${folder}/${Date.now()}.${ext}`;
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type === "image/jpg" ? "image/jpeg" : type, cacheControl: "31536000", upsert: false });
    if (error) return null;
    return db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/* ---------------- Storing a submission ---------------- */

type Submission = { formId: string; formName: string; responseId: string; submittedAt: string; answers: Answer[] };
export type Stored = { result: "ignored" | "trainee" | "matched" | "unmatched"; form?: string; trainee_id?: string | null; matched_by?: string | null; created?: boolean };

async function trainingForms(): Promise<FormRow[]> {
  const { data, error } = await db.from("training_forms").select("key, label, form_id, name_match").order("sort");
  if (error) throw new Error(`training_forms: ${error.message}`);
  return (data ?? []) as FormRow[];
}

export async function store(s: Submission, forms?: FormRow[]): Promise<Stored> {
  const list = forms ?? await trainingForms();
  const form = formFor(list, s.formId, s.formName);
  if (!form) return { result: "ignored" };
  // Learn the form id the first time a form is recognised by its name.
  if (!form.form_id && s.formId) {
    await db.from("training_forms").update({ form_id: s.formId }).eq("key", form.key);
    form.form_id = s.formId;
  }
  const p = person(s.answers);
  if (form.key === "application") return { ...(await storeApplication(s, p)), form: form.key };

  // Training form: the id in the link, else the email.
  let trainee_id: string | null = null;
  let matched_by: string | null = null;
  const tid = trainingId(s.answers);
  if (tid) {
    const { data } = await db.from("trainees").select("id").eq("id", tid).maybeSingle();
    if (data) { trainee_id = data.id; matched_by = "tid"; }
  }
  if (!trainee_id && p.email) {
    // Their application email, else another email an admin has linked to them (Needs matching).
    const { data } = await db.from("trainees").select("id, status, created_at").eq("email", p.email).order("created_at", { ascending: false });
    let list = data ?? [];
    if (!list.length) {
      const { data: other } = await db.from("trainees").select("id, status, created_at").contains("other_emails", [p.email]).order("created_at", { ascending: false });
      list = other ?? [];
    }
    const pick = list.find((t: any) => t.status !== "rejected") ?? list[0];
    if (pick) { trainee_id = pick.id; matched_by = "email"; }
  }
  const row = {
    form_key: form.key, response_id: s.responseId, submitted_at: s.submittedAt, email: p.email || null,
    name: [p.initiated_name, [p.first_name, p.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" / ") || null,
    fields: s.answers,
  };
  const { data: existing } = await db.from("training_submissions").select("id, trainee_id, matched_by").eq("response_id", s.responseId).maybeSingle();
  if (existing) {
    // A re-sync refreshes the answers (and Tally's file links); a match made by an admin is kept.
    const keep = existing.matched_by === "admin" || (existing.trainee_id && !trainee_id);
    const patch = keep ? row : { ...row, trainee_id, matched_by };
    const { error } = await db.from("training_submissions").update(patch).eq("id", existing.id);
    if (error) throw new Error(`training_submissions: ${error.message}`);
    const tId = keep ? existing.trainee_id : trainee_id;
    return { result: tId ? "matched" : "unmatched", form: form.key, trainee_id: tId, matched_by: keep ? existing.matched_by : matched_by, created: false };
  }
  const { error } = await db.from("training_submissions").insert({ ...row, trainee_id, matched_by });
  if (error) throw new Error(`training_submissions: ${error.message}`);
  return { result: trainee_id ? "matched" : "unmatched", form: form.key, trainee_id, matched_by, created: true };
}

// Application: one trainee per person. The same response updates the same trainee; a new application from an email
// already on file updates that trainee's details (their training progress stays).
async function storeApplication(s: Submission, p: ReturnType<typeof person>): Promise<Stored> {
  if (!p.email) return { result: "unmatched", trainee_id: null };
  let { data: t } = await db.from("trainees").select("id, photo_url, application_response_id").eq("application_response_id", s.responseId).maybeSingle();
  if (!t) {
    const { data: same } = await db.from("trainees").select("id, photo_url, application_response_id").eq("email", p.email).order("created_at", { ascending: false });
    t = (same ?? [])[0] ?? null;
  }
  const details = {
    email: p.email, first_name: p.first_name || null, last_name: p.last_name || null, initiated_name: p.initiated_name || null,
    phone: p.phone || null, application_response_id: s.responseId, application_submitted_at: s.submittedAt, application: s.answers,
  };
  let created = false;
  if (t) {
    const { error } = await db.from("trainees").update(details).eq("id", t.id);
    if (error) throw new Error(`trainees: ${error.message}`);
  } else {
    const { data, error } = await db.from("trainees").insert(details).select("id, photo_url").single();
    if (error) throw new Error(`trainees: ${error.message}`);
    t = { ...data, application_response_id: s.responseId };
    created = true;
  }
  const file = photoOf(s.answers);
  if (file && !t!.photo_url) {
    const url = await copyPhoto(file, `trainee-${t!.id}`);
    if (url) await db.from("trainees").update({ photo_url: url }).eq("id", t!.id);
  }
  // Also kept as a submission, so every form a person sent is in one list.
  const { data: sub } = await db.from("training_submissions").select("id").eq("response_id", s.responseId).maybeSingle();
  const row = { form_key: "application", response_id: s.responseId, submitted_at: s.submittedAt, email: p.email, trainee_id: t!.id, matched_by: "email", fields: s.answers,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.initiated_name || null };
  if (sub) await db.from("training_submissions").update(row).eq("id", sub.id);
  else await db.from("training_submissions").insert(row);
  return { result: "trainee", trainee_id: t!.id, created };
}

/* ---------------- Tally API (backfill) ---------------- */

async function tally(path: string) {
  if (!TALLY_API_KEY) throw new Error("The Tally API key isn't set yet (Supabase secret TALLY_API_KEY).");
  const r = await fetch(`https://api.tally.so${path}`, { headers: { Authorization: `Bearer ${TALLY_API_KEY}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`Tally ${path.split("?")[0]} failed: ${r.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

async function tallyForms(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await tally(`/forms?page=${page}&limit=100`);
    const items = r?.items ?? r?.forms ?? (Array.isArray(r) ? r : []);
    out.push(...items.map((f: any) => ({ id: String(f.id), name: String(f.name ?? f.title ?? "") })));
    if (!r?.hasMore || !items.length) break;
  }
  return out;
}

// One submission from the API in the webhook's shape. Questions carry the labels; hidden fields come as an object
// ({ tid: "..." }) or as one field per hidden field.
export function apiAnswers(questions: any[], submission: any): Answer[] {
  const out: Answer[] = [];
  for (const r of submission?.responses ?? []) {
    const q = (questions ?? []).find((x: any) => x.id === r.questionId);
    const type = String(q?.type ?? r.type ?? "");
    const value = r.answer ?? r.value ?? r.formattedAnswer;
    if (value && typeof value === "object" && !Array.isArray(value) && !isFile(value)) {
      for (const [k, v] of Object.entries(value)) out.push({ label: k, type: type || "HIDDEN_FIELDS", value: v == null ? "" : String(v) });
      continue;
    }
    const options = q?.fields?.[0]?.options ?? q?.options;
    const files = Array.isArray(value) ? value.filter(isFile).map(({ url, name, mimeType, size }: TallyFile) => ({ url, name, mimeType, size })) : [];
    const label = String(q?.title ?? q?.label ?? q?.fields?.[0]?.title ?? q?.fields?.[0]?.label ?? r.questionId ?? "").trim();
    out.push({ label, type, value: answerText({ value, options }), ...(files.length ? { files } : {}) });
  }
  return out;
}

async function probe() {
  if (!TALLY_API_KEY) return { has_key: false };
  const forms = await tallyForms();
  const known = await trainingForms();
  return {
    has_key: true,
    forms: forms.map((f) => ({ ...f, training_form: formFor(known, f.id, f.name)?.key ?? null })),
  };
}

// Backfill: every completed submission of every training form (or one form). Safe to run again: known responses are
// refreshed, not duplicated. Applications go first so training forms can be matched to them.
const SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
async function sync(onlyKey?: string) {
  // A full sync is about one Tally request per 100 submissions per form. Webhooks bring new forms in, so a full sync is
  // only for catching up, and runs at most once every 15 minutes.
  if (!onlyKey) {
    const { data: st } = await db.from("settings").select("training_synced_at").eq("id", 1).maybeSingle();
    const last = st?.training_synced_at ? Date.parse(st.training_synced_at) : 0;
    if (last && Date.now() - last < SYNC_COOLDOWN_MS) {
      const mins = Math.max(1, Math.round((Date.now() - last) / 60000));
      throw new Error(`cooldown: synced ${mins} minute${mins === 1 ? "" : "s"} ago, try again after ${hhmm(last + SYNC_COOLDOWN_MS)}`);
    }
    await db.from("settings").update({ training_synced_at: new Date().toISOString() }).eq("id", 1);
  }
  const forms = await trainingForms();
  const tallyList = await tallyForms();
  for (const f of forms) {
    if (f.form_id) continue;
    const found = tallyList.find((t) => f.name_match && new RegExp(f.name_match, "i").test(t.name));
    if (found) { f.form_id = found.id; await db.from("training_forms").update({ form_id: found.id }).eq("key", f.key); }
  }
  const summary: Record<string, { found: number; new: number; unmatched: number }> = {};
  const problems: string[] = [];
  for (const f of forms) {
    if (onlyKey && f.key !== onlyKey) continue;
    if (!f.form_id) { problems.push(`${f.label}: not found in Tally`); continue; }
    const name = tallyList.find((t) => t.id === f.form_id)?.name ?? f.label;
    const s = (summary[f.key] = { found: 0, new: 0, unmatched: 0 });
    try {
      for (let page = 1; page <= 50; page++) {
        const r = await tally(`/forms/${f.form_id}/submissions?page=${page}&limit=100&filter=completed`);
        const subs = r?.submissions ?? [];
        for (const sub of subs) {
          if (sub.isCompleted === false) continue;
          s.found++;
          const out = await store({ formId: f.form_id, formName: name, responseId: String(sub.id), submittedAt: sub.submittedAt ?? sub.createdAt ?? new Date().toISOString(), answers: apiAnswers(r.questions ?? [], sub) }, forms);
          if (out.created) s.new++;
          if (out.result === "unmatched") s.unmatched++;
        }
        if (!r?.hasMore || !subs.length) break;
      }
    } catch (e) {
      problems.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { forms: summary, problems };
}

// Tally's file links expire. Fetches one submission again (the single-submission endpoint, else the form's list) and
// stores its answers with fresh links. Returns the answers.
async function refreshFile(responseId: string) {
  if (!responseId) throw new Error("Which submission?");
  const { data: sub } = await db.from("training_submissions").select("id, form_key, trainee_id").eq("response_id", responseId).maybeSingle();
  if (!sub) throw new Error("Submission not found.");
  const { data: form } = await db.from("training_forms").select("form_id").eq("key", sub.form_key).maybeSingle();
  if (!form?.form_id) throw new Error("This form isn't linked to Tally yet.");
  let answers: Answer[] | null = null;
  try {
    const r = await tally(`/forms/${form.form_id}/submissions/${encodeURIComponent(responseId)}`);
    const one = r?.submission ?? r;
    if (one?.responses) answers = apiAnswers(r?.questions ?? [], one);
  } catch { /* not available: look through the list below */ }
  for (let page = 1; !answers && page <= 50; page++) {
    const r = await tally(`/forms/${form.form_id}/submissions?page=${page}&limit=100&filter=completed`);
    const found = (r?.submissions ?? []).find((x: any) => String(x.id) === responseId);
    if (found) answers = apiAnswers(r.questions ?? [], found);
    if (!r?.hasMore || !(r?.submissions ?? []).length) break;
  }
  if (!answers) throw new Error("Tally no longer has this submission.");
  await db.from("training_submissions").update({ fields: answers }).eq("id", sub.id);
  if (sub.form_key === "application" && sub.trainee_id) await db.from("trainees").update({ application: answers }).eq("id", sub.trainee_id);
  return { answers };
}

/* ---------------- Emails ---------------- */

let mailer: ReturnType<typeof nodemailer.createTransport> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLACEHOLDER_LEFT = /\{\{\s*[a-z_]+\s*\}\}/;
// Gmail saying "slow down" (rate or daily limit) or refusing the login: stop the batch rather than fail every email left.
export function stopSending(err: any): boolean {
  const code = Number(err?.responseCode ?? 0);
  const msg = String(err?.response ?? err?.message ?? "");
  if (err?.code === "EAUTH" || [421, 450, 451, 452, 454].includes(code)) return true;
  return /rate limit|sending limit|too many|quota|try again later|4\.7\.28|5\.4\.5/i.test(msg);
}
const SEND_PAUSE_MS = 750;
// Training emails in any 24 hours, kept well under Gmail's daily limit so circle emails still go out.
export const DAILY_CAP = 300;
const plainHtml = (text: string) => `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>`;

// Training forms to trainees. The dashboard renders each email (their name, the form and their personal link); this
// sends them one by one, and records every attempt in training_sends and Sent emails.
async function sendForms(actor: string, body: any) {
  const emails = Array.isArray(body?.emails) ? body.emails : [];
  if (!emails.length) throw new Error("Nothing to send.");
  if (emails.length > 50) throw new Error("Send at most 50 at a time.");
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error("Email isn't set up yet (GMAIL_USER / GMAIL_APP_PASSWORD).");
  const { data: forms } = await db.from("training_forms").select("key");
  const known = new Set((forms ?? []).map((f: any) => f.key));
  mailer ??= nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  const results: { trainee_id: string; form_key: string; status: "sent" | "failed" | "not_sent"; error?: string }[] = [];
  let stopped = "";
  const { count: today } = await db.from("email_log").select("id", { count: "exact", head: true })
    .eq("kind", "training_form").eq("status", "sent").gte("sent_at", new Date(Date.now() - 86400e3).toISOString());
  let room = Math.max(0, DAILY_CAP - Number(today ?? 0));
  for (const [i, e] of emails.entries()) {
    if (!stopped && room <= 0) stopped = `the daily limit of ${DAILY_CAP} training emails in 24 hours has been reached`;
    if (stopped) { results.push({ trainee_id: String(e?.trainee_id ?? ""), form_key: String(e?.form_key ?? ""), status: "not_sent", error: stopped }); continue; }
    const trainee_id = String(e?.trainee_id ?? ""), form_key = String(e?.form_key ?? "");
    const subject = String(e?.subject ?? "").replace(/[\r\n]+/g, " ").trim();
    const text = String(e?.text ?? "").trim();
    const fail = (error: string) => results.push({ trainee_id, form_key, status: "failed", error });
    if (!known.has(form_key) || form_key === "application") { fail("Unknown training form."); continue; }
    if (!subject || !text) { fail("The email has no subject or message."); continue; }
    if (PLACEHOLDER_LEFT.test(subject + text)) { fail("The email still has a {{placeholder}} in it."); continue; }
    const { data: t } = await db.from("trainees").select("id, email").eq("id", trainee_id).maybeSingle();
    if (!t?.email) { fail("Trainee not found."); continue; }
    const html = String(e?.html ?? "").trim() || plainHtml(text);
    const log = { kind: "training_form", to_email: t.email, subject, sent_by: actor, trainee_id: t.id,
      from_address: `${EMAIL_FROM_NAME} <${GMAIL_USER}>`, body_html: html, body_text: text };
    if (i > 0) await sleep(SEND_PAUSE_MS);
    try {
      const info = await mailer.sendMail({ from: { name: EMAIL_FROM_NAME, address: GMAIL_USER }, to: t.email, subject, html, text });
      await db.from("email_log").insert({ ...log, status: "sent", message_id: info?.messageId ?? null });
      await db.from("training_sends").insert({ trainee_id: t.id, form_key, to_email: t.email, sent_by: actor, status: "sent" });
      results.push({ trainee_id, form_key, status: "sent" });
      room--;
    } catch (err) {
      const msg = String((err as Error).message ?? err).slice(0, 200);
      await db.from("email_log").insert({ ...log, status: "failed", error: msg });
      await db.from("training_sends").insert({ trainee_id: t.id, form_key, to_email: t.email, sent_by: actor, status: "failed", error: msg });
      fail(msg);
      if (stopSending(err)) stopped = `Gmail asked us to stop for now (${msg.slice(0, 120)})`;
    }
  }
  const sent = results.filter((r) => r.status === "sent").length;
  const notSent = results.filter((r) => r.status === "not_sent").length;
  await db.from("audit_log").insert({ actor, action: "training_forms_sent", circle_id: null,
    detail: { sent, failed: results.length - sent - notSent, not_sent: notSent, ...(stopped ? { stopped } : {}) } });
  return { results, ...(stopped ? { stopped } : {}) };
}

/* ---------------- Outcome ---------------- */

async function decide(actor: string, body: any) {
  const decision = body?.decision;
  if (!["certified", "not_certified"].includes(decision)) throw new Error("Choose Certified or Not certified.");
  const { data: t } = await db.from("trainees").select("*").eq("id", body?.trainee_id).maybeSingle();
  if (!t) throw new Error("Trainee not found.");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: decision, decided_at: now, decided_by: actor };
  if (typeof body?.feedback === "string") patch.feedback = body.feedback;
  if (body?.assessment && typeof body.assessment === "object") patch.assessment = body.assessment;

  let email = "not sent";
  if (body?.send) {
    const subject = String(body?.subject ?? "").trim();
    const text = String(body?.text ?? "").trim();
    const html = String(body?.html ?? "").trim() || plainHtml(text);
    if (!subject || !text) throw new Error("Add a subject and a message, or record the outcome without an email.");
    if (PLACEHOLDER_LEFT.test(subject + text)) throw new Error("The email still has a {{placeholder}} in it. Fill it in first.");
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error("Email isn't set up yet (GMAIL_USER / GMAIL_APP_PASSWORD).");
    const r = { subject: subject.replace(/[\r\n]+/g, " "), text, html };
    mailer ??= nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
    const log = { kind: decision === "certified" ? "training_certified" : "training_not_certified", to_email: t.email, subject: r.subject,
      sent_by: actor, trainee_id: t.id, from_address: `${EMAIL_FROM_NAME} <${GMAIL_USER}>`, body_html: r.html, body_text: r.text };
    try {
      const info = await mailer.sendMail({ from: { name: EMAIL_FROM_NAME, address: GMAIL_USER }, to: t.email, subject: r.subject, html: r.html, text: r.text });
      await db.from("email_log").insert({ ...log, status: "sent", message_id: info?.messageId ?? null });
      email = "sent";
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 200);
      await db.from("email_log").insert({ ...log, status: "failed", error: msg });
      email = `failed: ${msg}`;
    }
    patch.final_email_at = now;
  }
  patch.final_email_status = email;
  const { data: saved, error } = await db.from("trainees").update(patch).eq("id", t.id).select("*").single();
  if (error) throw new Error(error.message);
  await db.from("audit_log").insert({ actor, action: `training_${decision}`, circle_id: null,
    detail: { trainee_id: t.id, email: t.email, email_result: email } });
  return { trainee: saved, email };
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
      const out = await store({
        formId: String(d.formId ?? ""), formName: String(d.formName ?? ""), responseId: String(d.responseId ?? d.submissionId ?? payload.eventId),
        submittedAt: d.createdAt ?? payload.createdAt ?? new Date().toISOString(), answers: toAnswers(d.fields ?? []),
      });
      if (out.result !== "ignored") {
        await db.from("audit_log").insert({ actor: "tally", action: "training_form", circle_id: null, detail: { ...out, form_name: d.formName ?? null } });
      }
      return json(out);
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
      case "probe": return json(await probe());
      case "sync": return json(await sync(body.form_key));
      case "file": return json(await refreshFile(String(body.response_id ?? "")));
      case "send_form":
        if (actor === "cron") return json({ error: "Admins only" }, 403);
        return json(await sendForms(actor, body));
      case "decide":
        if (actor === "cron") return json({ error: "Admins only" }, 403);
        return json(await decide(actor, body));
      default: return json({ error: `Unknown action ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
