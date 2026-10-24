// Facilitator training (#/Training): everyone who applied to facilitate, how far they are through the training (one dot
// per step), and the assessment and final Certified / Not certified email. Trainees and their forms come from Tally
// through the `training` edge function; intro and closing sessions are marked here by hand.
// Pure helpers (steps, status, links) are exported for the unit tests.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, trainingAction } from "./lib.js";
import { CopyButton } from "./ui.jsx";
import { Avatar } from "./FacilitatorsPage.jsx";
import { PLACEHOLDERS, DEFAULT_TEMPLATES, buildTrainingVars, render, unknownPlaceholders } from "./emailTemplate.js";
import "./training.css";

// Supabase returns at most 1,000 rows per request, so page through.
async function fetchAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return { data: out, error: null };
  }
}

// Unmatched forms worth looking at: those sent since the earliest application on file. Older ones are from earlier
// training rounds (the same forms are reused), so they are kept but hidden unless asked for.
export function needsMatching(subs = [], trainees = []) {
  const since = trainees.map((t) => t.application_submitted_at).filter(Boolean).sort()[0] ?? null;
  const all = subs.filter((s) => !s.trainee_id && s.form_key !== "application");
  const recent = since ? all.filter((s) => String(s.submitted_at) >= since) : all;
  return { since, recent, older: all.filter((s) => !recent.includes(s)) };
}

// Unmatched forms grouped by the email they came from (one row per email on the Needs matching view), newest first.
export function groupByEmail(subs = []) {
  const groups = new Map();
  for (const s of subs) {
    const email = String(s.email ?? "").trim().toLowerCase();
    const key = email || `id:${s.id}`;
    if (!groups.has(key)) groups.set(key, { key, email, name: "", subs: [] });
    const g = groups.get(key);
    g.subs.push(s);
    if (!g.name && s.name) g.name = s.name;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, subs: [...g.subs].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))) }))
    .sort((a, b) => String(b.subs[0]?.submitted_at).localeCompare(String(a.subs[0]?.submitted_at)));
}

// Names compared without case, accents or punctuation: "Rādhā-Dāsī" and "radha dasi" are the same.
export const foldName = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const squash = (v) => foldName(v).replace(/ /g, "");

// A likely trainee for an unmatched form (or a group of forms from one email), by name. Only a suggestion: an admin
// confirms it. Returns { trainee, reason } or null when nobody fits, or when two people fit equally well.
export function suggestMatch(sub, trainees = []) {
  const email = String(sub?.email ?? "").trim().toLowerCase();
  const local = squash(email.split("@")[0] ?? "");
  // The stored name is "Initiated / First Last" or "First Last".
  const parts = String(sub?.name ?? "").split("/").map(foldName).filter(Boolean);
  const scored = [];
  for (const t of trainees) {
    if (email && (String(t.email ?? "").toLowerCase() === email || (t.other_emails ?? []).includes(email))) continue;
    const first = foldName(t.first_name), last = foldName(t.last_name), ini = foldName(t.initiated_name);
    const full = [first, last].filter(Boolean).join(" ");
    const names = [full, [last, first].filter(Boolean).join(" ")].filter((n) => n.includes(" ")).concat(ini ? [ini] : []);
    let best = null;
    for (const part of parts) {
      if (names.includes(part)) { best = { score: 3, reason: "same name" }; break; }
      const long = (a, b) => a.split(" ").length >= 2 && b.startsWith(`${a} `);
      if ([full, ini].some((n) => n && (long(part, n) || long(n, part)))) best ??= { score: 2, reason: "similar name" };
    }
    if (!best && local) {
      const joined = [squash(full), squash(ini)].filter((n) => n.length >= 6);
      if (joined.some((n) => local.includes(n))) best = { score: 1, reason: "email looks like their name" };
    }
    if (best) scored.push({ trainee: t, ...best });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored[1] && scored[1].score === scored[0].score) return null;
  return { trainee: scored[0].trainee, reason: scored[0].reason };
}

// The seven steps, in order. Sessions are marked by an admin; forms are done when a submission is linked.
export const STEPS = [
  { key: "intro", label: "Intro session", session: true },
  { key: "agreement", label: "Agreement form" },
  { key: "scene", label: "Setting the Scene reflections" },
  { key: "empowerment", label: "Empowerment reflections" },
  { key: "wisdom", label: "Wisdom reflections" },
  { key: "video", label: "Video assessment" },
  { key: "closing", label: "Closing session", session: true },
];

export const CRITERIA = [
  ["delivery", "Delivery and communication skills"],
  ["fidelity", "Understanding and fidelity to the material"],
  ["readiness", "Facilitation readiness"],
  ["ethos", "Alignment with Think Gita ethos"],
  ["technical", "Technical quality"],
];
export const RATINGS = [["meets", "Meets"], ["partly", "Partly"], ["not_yet", "Not yet"]];

export const STATUS = {
  applied: { label: "Applied", cls: "ts-applied" },
  in_training: { label: "In training", cls: "ts-training" },
  ready: { label: "Ready to assess", cls: "ts-ready" },
  assessed: { label: "Assessed, awaiting decision", cls: "ts-assessed" },
  certified: { label: "Certified", cls: "ts-certified" },
  not_certified: { label: "Not certified", cls: "ts-not" },
  cancelled: { label: "Cancelled", cls: "ts-cancelled" },
  revoked: { label: "Revoked", cls: "ts-revoked" },
  rejected: { label: "Rejected", cls: "ts-rejected" },
};
const FILTERS = ["all", "applied", "in_training", "ready", "assessed", "certified", "not_certified", "cancelled", "revoked"];
// The assessor's own view: what still needs their assessment, what they have sent to the admins, then the outcomes.
const ASSESSOR_STATUS = { to_assess: { label: "To assess", cls: "ts-ready" }, submitted: { label: "Submitted", cls: "ts-assessed" } };
const ASSESSOR_FILTERS = ["all", "to_assess", "submitted", "certified", "not_certified", "cancelled", "revoked"];
// The assessor's recommendation when they submit: admins still decide.
export const RECOMMEND = [["certify", "Recommend certifying"], ["not_yet", "Not yet"]];
export const RECOMMEND_SHORT = { certify: "Certify", not_yet: "Not yet" };
export const recommendLabel = (r) => RECOMMEND.find(([k]) => k === r)?.[1] ?? "";
// Final outcomes. Cancelled: training stopped, nothing against them. Revoked: permanent (see migration 034).
export const DECIDED = ["certified", "not_certified", "cancelled", "revoked"];
export const OUTCOMES = [
  ["certified", "Certified", "Training passed. The email includes the link to request a Think Gita Circle."],
  ["not_certified", "Not certified", "Not ready this time. They can train again."],
  ["cancelled", "Cancelled", "Training stopped. Nothing against them; they can apply again."],
  ["revoked", "Revoked", "Permanent. Their future applications are marked revoked, and if they facilitate, they are unverified and their circles come off the website (circles keep running until you end them)."],
];

const clean = (v) => String(v ?? "").trim();
const TEMPLATE_KEYS = [["training_form", "Next form"], ["training_certified", "Certified"], ["training_not_certified", "Not certified"],
  ["training_cancelled", "Cancelled"], ["training_revoked", "Revoked"]];
const DAY_MS = 86400e3;
// A full Tally sync can run once every 15 minutes (the server refuses sooner; new forms arrive by webhook anyway).
export const SYNC_COOLDOWN_MS = 15 * 60e3;
// Next form emails go to the server in batches of this size.
export const SEND_BATCH = 20; // per call to the training function (it pauses 0.75 s between emails)
export const CHASE_DAYS = 5;

// A training form link carrying the trainee id, so the submission is matched to them (Tally hidden field `tid`).
export function formLink(url, id) {
  if (!url) return "";
  const [base, hash] = String(url).split("#");
  return `${base}${base.includes("?") ? "&" : "?"}tid=${encodeURIComponent(id)}${hash ? `#${hash}` : ""}`;
}

export function traineeNames(t) {
  const full = [clean(t?.first_name), clean(t?.last_name)].filter(Boolean).join(" ");
  const ini = clean(t?.initiated_name);
  return { title: ini || full || clean(t?.email) || "Unnamed", sub: ini && full ? full : "" };
}

// One entry per step: done, when, and the submission behind a form step (the latest if there are several).
export function progress(trainee, submissions = [], forms = []) {
  const mine = submissions.filter((s) => s.trainee_id === trainee.id);
  return STEPS.map((step) => {
    if (step.session) {
      const at = trainee[`${step.key}_attended_at`] ?? null;
      return { ...step, done: Boolean(at), at, by: trainee[`${step.key}_marked_by`] ?? null };
    }
    const form = forms.find((f) => f.key === step.key);
    const subs = mine.filter((s) => s.form_key === step.key).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
    return { ...step, label: form?.label ?? step.label, done: subs.length > 0, at: subs[0]?.submitted_at ?? null, submission: subs[0] ?? null, count: subs.length };
  });
}

// Status for the list: decided and rejected trainees keep theirs; an assessment sent to the admins waits for their decision;
// everyone with all seven steps done is ready to assess.
export function traineeStatus(trainee, prog) {
  if ([...DECIDED, "rejected"].includes(trainee.status)) return trainee.status;
  if (trainee.assessment_submitted_at) return "assessed";
  if (prog.every((p) => p.done)) return "ready";
  return trainee.status === "in_training" || prog.some((p) => p.done) ? "in_training" : "applied";
}

// Every personal form link as plain text, ready to paste into an email.
export function linksText(trainee, forms = []) {
  return STEPS.filter((s) => !s.session).map((s) => forms.find((f) => f.key === s.key)).filter((f) => f?.url)
    .map((f) => `${f.label}: ${formLink(f.url, trainee.id)}`).join("\n");
}

// The first training form, in step order, that a trainee hasn't submitted yet (or null when all are in).
export function nextForm(trainee, subs = [], forms = []) {
  const done = new Set(subs.filter((s) => s.trainee_id === trainee.id).map((s) => s.form_key));
  for (const step of STEPS) {
    if (step.session) continue;
    const form = forms.find((f) => f.key === step.key);
    if (!form || form.required === false || form.key === "application") continue;
    if (!done.has(step.key)) return form;
  }
  return null;
}

// The latest successful next form email for one trainee and form.
export function lastSent(sends = [], traineeId, formKey) {
  return sends.filter((x) => x.trainee_id === traineeId && x.form_key === formKey && x.status === "sent")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
}

// The assessor's view of a row: to assess, submitted (waiting for the admins), or the outcome once decided.
export function assessorStatus(trainee) {
  if ([...DECIDED, "rejected"].includes(trainee.status)) return trainee.status;
  return trainee.assessment_submitted_at ? "submitted" : "to_assess";
}

// Assessments sent to the admins and waiting for their decision, oldest first.
export function awaitingDecision(trainees = []) {
  return trainees.filter((t) => t.assessment_submitted_at && !DECIDED.includes(t.status) && t.status !== "rejected")
    .sort((a, b) => String(a.assessment_submitted_at).localeCompare(String(b.assessment_submitted_at)));
}

// What admins need to do: send each trainee their next form, and chase anyone sent it a while ago who hasn't filled it in.
// Only people still in training (applied or in training) are included.
export function nextSteps(trainees = [], subs = [], forms = [], sends = [], now = Date.now(), chaseDays = CHASE_DAYS) {
  const toSend = [];
  const chase = [];
  for (const trainee of trainees) {
    if (!["applied", "in_training"].includes(trainee.status)) continue;
    const form = nextForm(trainee, subs, forms);
    if (!form) continue;
    const last = lastSent(sends, trainee.id, form.key);
    if (!last) toSend.push({ trainee, form });
    else if (now - Date.parse(last.created_at) > chaseDays * DAY_MS) chase.push({ trainee, form, sentAt: last.created_at });
  }
  return { toSend, chase, awaiting: awaitingDecision(trainees) };
}

// One next form email, filled in for one trainee: their name, the form and their personal link.
export function formEmail({ template, trainee, form, settings = {}, sender = "" }) {
  const vars = buildTrainingVars({ trainee, settings, sender, form: { label: form.label, link: formLink(form.url, trainee.id) } });
  const r = render(template ?? DEFAULT_TEMPLATES.training_form, vars, { missing: "" });
  return { trainee_id: trainee.id, form_key: form.key, subject: r.subject, text: r.text, html: render({ subject: r.subject, body: r.text }, {}, { missing: "" }).html };
}

// Sends next form emails in batches; returns every result.
export async function sendFormEmails(emails, action = trainingAction) {
  const results = [];
  for (let i = 0; i < emails.length; i += SEND_BATCH) {
    const out = await action("send_form", { emails: emails.slice(i, i + SEND_BATCH) });
    results.push(...(out?.results ?? []));
    // Gmail asked us to stop (rate or daily limit): the rest stay in Next steps for later.
    if (out?.stopped) {
      results.stopped = out.stopped;
      for (const e of emails.slice(i + SEND_BATCH)) results.push({ trainee_id: e.trainee_id, form_key: e.form_key, status: "not_sent" });
      break;
    }
  }
  return results;
}
export const sentSummary = (results) => {
  const ok = results.filter((r) => r.status === "sent").length;
  const held = results.filter((r) => r.status === "not_sent").length;
  const bad = results.length - ok - held;
  const parts = [`Sent ${ok}`, bad ? `${bad} failed (see Setup, Sent emails)` : ""].filter(Boolean).join(", ");
  const why = /daily limit/.test(results.stopped ?? "") ? "The daily limit for training emails was reached" : "Gmail asked us to slow down";
  const stop = held ? ` ${why}, so ${held} ${held === 1 ? "wasn't" : "weren't"} sent. They're still in Next steps: try again later.` : "";
  return { text: `${parts}.${stop}`, warn: bad > 0 || held > 0 };
};
export function daysAgo(iso, now = Date.now()) {
  const d = Math.floor((now - Date.parse(iso)) / DAY_MS);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

// Nobody assesses their own training record (the database refuses it too).
export const isSelf = (t, email) => Boolean(email) && (String(t?.email ?? "").toLowerCase() === email || (t?.other_emails ?? []).includes(email));

// Who a trainee can be assigned to: admins (super admins included) and assessors, each email once, admins first.
export function assigneeOptions(admins = [], assessors = []) {
  const seen = new Set();
  const out = [];
  const add = (a, kind) => {
    const email = clean(a?.email).toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    out.push({ email, name: clean(a.name) || email, kind });
  };
  for (const a of admins) add(a, a.is_super ? "Super admin" : "Admin");
  for (const a of assessors) add(a, "Assessor");
  const rank = (o) => (o.kind === "Assessor" ? 1 : 0);
  return out.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
}
export function assigneeLabel(email, options = []) {
  if (!email) return "Unassigned";
  return options.find((o) => o.email === email)?.name ?? email;
}

// assignee: "all", "none" (unassigned) or an email.
export function filterTrainees(rows, { status = "all", q = "", assignee = "all" } = {}) {
  const words = clean(q).toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (status === "all" || r.status === status)
    && (assignee === "all" || (assignee === "none" ? !r.t.assigned_to : r.t.assigned_to === assignee))
    && words.every((w) => [r.t.first_name, r.t.last_name, r.t.initiated_name, r.t.email, r.t.phone].join(" ").toLowerCase().includes(w)));
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }) : "");
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const asFac = (t) => ({ ...t, name: traineeNames(t).title });

function Dots({ prog }) {
  return (
    <span className="tr-dots" aria-label={prog.map((p) => `${p.label}: ${p.done ? `done${p.at ? ` ${fmtDate(p.at)}` : ""}` : "not yet"}`).join("; ")}>
      {prog.map((p) => (
        <i key={p.key} className={`tr-dot ${p.done ? "done" : ""}`} title={`${p.label}: ${p.done ? `done${p.at ? `, ${fmtDate(p.at)}` : ""}` : "not yet"}`} />
      ))}
    </span>
  );
}

function Legend() {
  return (
    <div className="tr-legend small muted">
      <span><i className="tr-dot done" /> Done</span>
      <span><i className="tr-dot" /> Not yet</span>
      <span className="tr-legend-steps">Steps: {STEPS.map((s) => s.label.replace(/ (reflections|form)$/, "")).join(", ")}</span>
    </div>
  );
}

// A section that opens and closes, like the circle panel's.
function Fold({ title, summary, defaultOpen = true, children, actions }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`details sec ${open ? "open" : "closed"}`} aria-label={title}>
      <div className="details-head sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="sec-chevron" aria-hidden="true">▸</span>
          <span className="section-title">{title}</span>
          {summary && <span className="sec-summary muted small">{summary}</span>}
        </button>
        {actions}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}

export function TrainingPage({ data, run, initial }) {
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("all");
  // #/Training/next opens Next steps (the Overview notice links there); #/Training/<trainee id> opens that trainee.
  const [openId, setOpenId] = useState(initial && initial !== "next" ? initial : null);
  const [view, setView] = useState(initial === "next" ? "next" : "list");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(id); }, []);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let live = true;
    (async () => {
      const [t, s, f, e, x, a] = await Promise.all([
        supabase.from("trainees").select("*").order("created_at", { ascending: false }),
        fetchAll(() => supabase.from("training_submissions").select("*").order("submitted_at", { ascending: false }).order("id")),
        supabase.from("training_forms").select("*").order("sort"),
        supabase.from("email_templates").select("*").in("key", TEMPLATE_KEYS.map(([k]) => k)),
        fetchAll(() => supabase.from("training_sends").select("*").order("created_at", { ascending: false }).order("id")),
        supabase.from("assessors").select("*").order("name"),
      ]);
      if (!live) return;
      const err = [t, s, f, e, x, a].find((r) => r.error);
      setLoadErr(err ? err.error.message : "");
      setState({ trainees: t.data ?? [], subs: s.data ?? [], forms: f.data ?? [], sends: x.data ?? [], assessors: a.data ?? [],
        templates: Object.fromEntries((e.data ?? []).map((r) => [r.key, r])) });
    })();
    return () => { live = false; };
  }, [data, tick]);
  const rows = useMemo(() => (state ? state.trainees.map((t) => {
    const prog = progress(t, state.subs, state.forms);
    return { id: t.id, t, prog, status: traineeStatus(t, prog), done: prog.filter((p) => p.done).length };
  }) : []), [state]);
  const counts = useMemo(() => {
    const n = { all: rows.length };
    for (const r of rows) n[r.status] = (n[r.status] ?? 0) + 1;
    return n;
  }, [rows]);
  const options = useMemo(() => assigneeOptions(data.admins ?? [], state?.assessors ?? []), [data.admins, state]);
  const me = (data.me?.email ?? "").toLowerCase();
  const shown = useMemo(() => filterTrainees(rows, { status, q, assignee: assignee === "me" ? me : assignee }), [rows, status, q, assignee, me]);
  const unmatched = useMemo(() => needsMatching(state?.subs, state?.trainees), [state]);
  const open = openId && rows.find((r) => r.id === openId);
  const steps = useMemo(() => (state ? nextSteps(state.trainees, state.subs, state.forms, state.sends, now) : { toSend: [], chase: [], awaiting: [] }), [state, now]);
  async function assign(ids, to) {
    if (!ids.length) return;
    const who = to ? assigneeLabel(to, options) : "nobody";
    if (ids.length > 1 && !confirm(`Assign ${ids.length} trainees to ${who}?`)) return;
    await run(async () => {
      const { error } = await supabase.from("trainees").update({ assigned_to: to || null }).in("id", ids);
      if (error) throw new Error(/bad_assignee/.test(error.message) ? "Assign to an admin or an assessor."
        : /self_assign/.test(error.message) ? "Someone can't assess their own training. Pick someone else." : error.message);
    }, to ? `${ids.length === 1 ? "Trainee" : `${ids.length} trainees`} assigned to ${who}.` : `${ids.length === 1 ? "Trainee" : `${ids.length} trainees`} unassigned.`);
    reload();
  }

  if (!state) return <section className="card"><p className="muted">Loading trainees…</p></section>;
  const todo = steps.toSend.length + steps.chase.length + steps.awaiting.length;
  const toMatch = groupByEmail(unmatched.recent).length;
  const VIEWS = [["list", "Trainees", 0], ["next", "Next steps", todo], ["match", "Needs matching", toMatch], ["emails", "Email wording", 0]];
  return (
    <>
      <div className="seg tr-views" role="tablist" aria-label="Training view">
        {VIEWS.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "active" : ""} onClick={() => setView(k)}>
            {label}{n > 0 && <span className="count">{n}</span>}
          </button>
        ))}
      </div>
      {view === "next" && (
        <NextSteps steps={steps} templates={state.templates} data={data} run={run} now={now} onDone={reload} onOpen={(id) => setOpenId(id)} options={options} />
      )}
      {view === "list" && (<>
      <section className="card tr-page">
        <div className="card-head">
          <h2>Trainees <span className="muted">({shown.length})</span></h2>
          <div className="filters">
            <input type="search" placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trainees" />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assessor filter">
              <option value="all">Everyone</option>
              <option value="none">Unassigned</option>
              <option value="me">Assigned to me</option>
              {options.map((o) => <option key={o.email} value={o.email}>{o.name} ({o.kind.toLowerCase()})</option>)}
            </select>
          </div>
        </div>
        <p className="card-sub muted small">
          Each application from Tally becomes a trainee. Training forms are matched by the personal links below each trainee (they carry
          their id), or by email. Intro and closing sessions are marked by hand.
        </p>
        {loadErr && <p className="hint warn">{loadErr}</p>}
        <div className="web-filter" role="group" aria-label="Training status">
          {FILTERS.map((k) => (
            <button key={k} type="button" className={`web-chip ${status === k ? "on" : ""}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
              {k === "all" ? "All" : STATUS[k].label} <span className="ws-n">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <Legend />
        <div className="tr-list tr-list-admin" role="table" aria-label="Trainees">
          <div className="tr-row tr-head" role="row">
            <span role="columnheader">Trainee</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Training</span>
            <span role="columnheader">Assessor</span>
          </div>
          {shown.map((r) => {
            const n = traineeNames(r.t);
            return (
              <div key={r.id} className="tr-row" role="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setOpenId(r.id)}>
                <span className="tr-person" role="cell">
                  <Avatar fac={asFac(r.t)} size={32} />
                  <span className="tr-names"><b>{n.title}</b>{n.sub && <span className="muted small">{n.sub}</span>}</span>
                </span>
                <span className="tr-email small" role="cell">{r.t.email}</span>
                <span role="cell"><span className={`pill tr-status ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></span>
                <span className="tr-progress" role="cell"><Dots prog={r.prog} /> <span className="muted small">{r.done} of {STEPS.length}</span></span>
                <span className="small tr-assignee" role="cell" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <select className={`tr-assign-select ${r.t.assigned_to ? "" : "unassigned"}`} value={r.t.assigned_to ?? ""}
                    aria-label={`Assessor for ${traineeNames(r.t).title}`} onChange={(e) => assign([r.id], e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {r.t.assigned_to && !options.some((o) => o.email === r.t.assigned_to) && <option value={r.t.assigned_to}>{r.t.assigned_to}</option>}
                    {options.map((o) => <option key={o.email} value={o.email} disabled={isSelf(r.t, o.email)}>{o.name} ({o.kind.toLowerCase()}){isSelf(r.t, o.email) ? ": their own record" : ""}</option>)}
                  </select>
                </span>
              </div>
            );
          })}
          {!shown.length && <p className="muted tr-empty">{rows.length ? "Nobody matches." : "No trainees yet. Applications arrive from Tally automatically."}</p>}
        </div>
      </section>

      </>)}
      {view === "match" && (
        <NeedsMatching subs={unmatched.recent} older={unmatched.older} since={unmatched.since} forms={state.forms} trainees={state.trainees} run={run} onDone={reload} />
      )}
      {view === "emails" && <TrainingEmails templates={state.templates} data={data} run={run} onSaved={reload} />}

      {open && (
        <TraineeDrawer key={open.id} row={open} subs={state.subs} forms={state.forms} sends={state.sends} now={now} templates={state.templates} data={data} run={run}
          options={options} onAssign={(to) => assign([open.id], to)} onChanged={reload} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

// Next steps: everyone's next form to send (grouped by form, in training order), and who to chase.
function NextSteps({ steps, templates, data, run, now, onDone, onOpen, options = [] }) {
  const [busy, setBusy] = useState(false);
  const template = templates.training_form ?? DEFAULT_TEMPLATES.training_form;
  const groups = STEPS.filter((s) => !s.session).map((s) => ({ key: s.key, items: steps.toSend.filter((x) => x.form.key === s.key) })).filter((g) => g.items.length);
  const email = (x) => formEmail({ template, trainee: x.trainee, form: x.form, settings: data.settings ?? {}, sender: data.me?.name ?? "" });
  async function send(items, { ask } = {}) {
    if (ask && !confirm(ask)) return;
    const ready = items.filter((x) => x.form.url);
    if (!ready.length) return;
    setBusy(true);
    await run(() => sendFormEmails(ready.map(email)), sentSummary);
    setBusy(false);
    onDone();
  }
  const Person = ({ x, children }) => {
    const n = traineeNames(x.trainee);
    return (
      <div className="tr-next-row">
        <button type="button" className="link tr-next-name" onClick={() => onOpen(x.trainee.id)}>{n.title}</button>
        <span className="small muted tr-email">{x.trainee.email}</span>
        <span><span className={`pill tr-status ${STATUS[x.trainee.status]?.cls ?? ""}`}>{STATUS[x.trainee.status]?.label ?? x.trainee.status}</span></span>
        {children}
      </div>
    );
  };
  return (
    <>
      <section className="card tr-awaiting" aria-label="Awaiting your decision">
        <div className="card-head"><h2>Awaiting your decision <span className="muted">({steps.awaiting.length})</span></h2></div>
        <p className="muted small">Assessors have sent these assessments to the admins. Open the trainee, read the assessment and record the outcome.</p>
        {!steps.awaiting.length && <p className="muted small">No assessments are waiting.</p>}
        {steps.awaiting.map((t) => {
          const n = traineeNames(t);
          return (
            <div key={t.id} className="tr-next-row tr-awaiting-row">
              <button type="button" className="link tr-next-name" onClick={() => onOpen(t.id)}>{n.title}</button>
              <span className="small muted">By {assigneeLabel(t.assessment_submitted_by, options)} · {fmtDate(t.assessment_submitted_at)}</span>
              <span>{t.recommendation && <span className={`pill tr-rec tr-rec-${t.recommendation}`}>{recommendLabel(t.recommendation)}</span>}</span>
              <button type="button" className="small primary" onClick={() => onOpen(t.id)} aria-label={`Open ${n.title}`}>Open</button>
            </div>
          );
        })}
      </section>
      <section className="card tr-next" aria-label="Send next form">
        <div className="card-head"><h2>Send next form <span className="muted">({steps.toSend.length})</span></h2></div>
        <p className="muted small">Each trainee's next form, not sent yet. The email uses the "Next form" wording below, with their name and personal link.</p>
        {!groups.length && <p className="muted small">Everyone has been sent their next form.</p>}
        {groups.map((g) => {
          const label = g.items[0].form.label;
          return (
            <div key={g.key} className="tr-next-group" aria-label={label}>
              <div className="tr-next-head">
                <h3 className="section-title">{label} ({g.items.length})</h3>
                <button type="button" className="small primary" disabled={busy}
                  onClick={() => send(g.items, { ask: `Send the ${label} to ${g.items.length} trainee${g.items.length === 1 ? "" : "s"}? Each gets their own personal link.` })}>
                  Send to all {g.items.length}
                </button>
              </div>
              {g.items.map((x) => (
                <Person key={x.trainee.id} x={x}>
                  <button type="button" className="small" disabled={busy || !x.form.url} onClick={() => send([x])} aria-label={`Send ${label} to ${traineeNames(x.trainee).title}`}>Send</button>
                </Person>
              ))}
            </div>
          );
        })}
      </section>
      <section className="card tr-chase" aria-label="Chase">
        <div className="card-head"><h2>Chase <span className="muted">({steps.chase.length})</span></h2></div>
        <p className="muted small">Sent their next form more than {CHASE_DAYS} days ago and not filled it in yet.</p>
        {!steps.chase.length && <p className="muted small">Nobody to chase.</p>}
        {steps.chase.map((x) => (
          <Person key={x.trainee.id} x={x}>
            <span className="small">{x.form.label} · Sent {daysAgo(x.sentAt, now)}</span>
            <button type="button" className="small" disabled={busy || !x.form.url} onClick={() => send([x])} aria-label={`Resend ${x.form.label} to ${traineeNames(x.trainee).title}`}>Resend</button>
          </Person>
        ))}
      </section>
    </>
  );
}

// Drawer: the trainee's next form (or any other), with an editable email, and what has been sent so far.
function SendForm({ t, subs, forms, sends, now, templates, data, run, onChanged }) {
  const linkForms = STEPS.filter((s) => !s.session).map((s) => forms.find((f) => f.key === s.key)).filter((f) => f?.url);
  const next = nextForm(t, subs, forms);
  const [formKey, setFormKey] = useState(next?.key ?? linkForms[0]?.key ?? "");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const form = linkForms.find((f) => f.key === formKey);
  const mine = sends.filter((x) => x.trainee_id === t.id);
  const last = next ? lastSent(sends, t.id, next.key) : null;
  const preview = useMemo(() => (draft ? render({ subject: draft.subject, body: draft.body }, {}, { missing: "" }) : null), [draft]);
  const label = (k) => forms.find((f) => f.key === k)?.label ?? k;
  function compose() {
    const e = formEmail({ template: templates.training_form ?? DEFAULT_TEMPLATES.training_form, trainee: t, form, settings: data.settings ?? {}, sender: data.me?.name ?? "" });
    setDraft({ subject: e.subject, body: e.text });
  }
  async function send() {
    setBusy(true);
    await run(() => sendFormEmails([{ trainee_id: t.id, form_key: form.key, subject: draft.subject, text: preview.text, html: preview.html }]), (results) => {
      const r = results[0];
      return r?.status === "sent" ? `${form.label} sent to ${t.email}` : { text: `The email failed: ${r?.error ?? "unknown error"}. See Setup, Sent emails.`, warn: true };
    });
    setBusy(false);
    setDraft(null);
    onChanged();
  }
  const summary = next ? `Next: ${next.label} · ${last ? `Sent ${daysAgo(last.created_at, now)}` : "Not sent yet"}` : "All forms in";
  return (
    <Fold title="Send a form" summary={summary} defaultOpen={Boolean(next)}>
      <p className="small tr-next-line">{summary}</p>
      <div className="tr-send-pick">
        <label className="small">Form
          <select value={formKey} onChange={(e) => { setFormKey(e.target.value); setDraft(null); }} aria-label="Form to send">
            {linkForms.map((f) => <option key={f.key} value={f.key}>{f.label}{next?.key === f.key ? " (next)" : ""}</option>)}
          </select>
        </label>
        {!draft && <button type="button" className="small primary" disabled={!form} onClick={compose}>Send…</button>}
      </div>
      {draft && (
        <div className="tr-composer form">
          <label>To<input value={t.email} readOnly /></label>
          <label>Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label>Message<textarea rows="10" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Form email message" /></label>
          <div className="email-preview compact" aria-label="Form email preview">
            <div className="email-subject"><span className="muted small">Subject</span> {preview.subject}</div>
            <div className="email-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
          <div className="actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="primary" disabled={busy || !draft.subject.trim() || !draft.body.trim()} onClick={send}>Send email</button>
          </div>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="tr-send-history small" aria-label="Forms sent">
          {mine.slice(0, 8).map((x) => (
            <li key={x.id}>{label(x.form_key)} · {fmtStamp(x.created_at)} · {x.status === "sent" ? "Sent" : <span className="error">Failed{x.error ? `: ${x.error}` : ""}</span>}</li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

// Every unmatched form from this email goes to the trainee, and the email is remembered on them (other_emails), so
// later forms from it match on their own.
export async function linkEmail(group, trainee) {
  const ids = group.subs.map((x) => x.id);
  const q = supabase.from("training_submissions").update({ trainee_id: trainee.id, matched_by: "admin" }).is("trainee_id", null);
  const { data: linked, error } = await (group.email ? q.eq("email", group.email) : q.in("id", ids)).select("id");
  if (error) throw error;
  const main = String(trainee.email ?? "").toLowerCase();
  const others = trainee.other_emails ?? [];
  if (group.email && group.email !== main && !others.includes(group.email)) {
    const { error: e2 } = await supabase.from("trainees").update({ other_emails: [...others, group.email] }).eq("id", trainee.id);
    if (e2) throw e2;
  }
  return linked?.length ?? ids.length;
}

function NeedsMatching({ subs, older = [], since, forms, trainees, run, onDone }) {
  const [showOlder, setShowOlder] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  const groups = useMemo(() => groupByEmail(showOlder ? [...subs, ...older] : subs), [subs, older, showOlder]);
  const olderGroups = useMemo(() => groupByEmail(older).length, [older]);
  const label = (k) => forms.find((f) => f.key === k)?.label ?? k;
  const sorted = useMemo(() => [...trainees].sort((a, b) => traineeNames(a).title.localeCompare(traineeNames(b).title)), [trainees]);
  const link = (g, t) => t && run(() => linkEmail(g, t), (n) => {
    const forms = `${n} form${n === 1 ? "" : "s"}`;
    return g.email
      ? `Linked ${forms} from ${g.email} to ${traineeNames(t).title}. Future forms from this email will match too.`
      : `Linked ${forms} to ${traineeNames(t).title}.`;
  }).then(onDone);
  return (
    <section className="card tr-matching" aria-label="Needs matching">
      <div className="card-head">
        <h2>Needs matching <span className="muted">({groups.length})</span></h2>
        {older.length > 0 && (
          <button type="button" className="link small" onClick={() => setShowOlder((v) => !v)}>
            {showOlder ? "Hide earlier rounds" : `Show ${olderGroups} from earlier rounds`}
          </button>
        )}
      </div>
      <p className="muted small">
        These forms came in without a trainee id and from an email we don't know. Link each email to the trainee who sent it: all its
        forms move across, and later forms from that email match on their own. Suggestions are by name, so check before linking.
        {since && !showOlder && older.length > 0 && ` Forms sent before the first application on file (${fmtDate(since)}) are from earlier training rounds and are hidden.`}
      </p>
      {!groups.length && <p className="muted small">Nothing to match from this round.</p>}
      <div className="tr-match-list">
        {groups.map((g) => {
          const hint = dismissed.has(g.key) ? null : suggestMatch(g, trainees);
          const who = g.name || "No name";
          return (
            <div key={g.key} className="tr-match-row" aria-label={`Forms from ${g.email || who}`}>
              <div className="tr-match-from">
                <span><b>{who}</b>{g.email && <span className="muted small"> · {g.email}</span>}</span>
                <span className="muted small">{g.subs.map((x) => `${label(x.form_key)} (${fmtDate(x.submitted_at)})`).join(", ")}</span>
              </div>
              {hint ? (
                <div className="tr-match-hint">
                  <span className="small">
                    <span className="muted">Looks like </span><b>{traineeNames(hint.trainee).title}</b>
                    <span className="muted"> · {hint.trainee.email} ({hint.reason})</span>
                  </span>
                  <span className="row-actions">
                    <button type="button" className="small primary" onClick={() => link(g, hint.trainee)}>Same person: link</button>
                    <button type="button" className="small ghost" onClick={() => setDismissed((d) => new Set(d).add(g.key))}>Not them</button>
                  </span>
                </div>
              ) : (
                <select aria-label={`Trainee for forms from ${g.email || who}`} defaultValue=""
                  onChange={(e) => link(g, trainees.find((t) => t.id === e.target.value))}>
                  <option value="">Choose a trainee…</option>
                  {sorted.map((t) => <option key={t.id} value={t.id}>{traineeNames(t).title} ({t.email})</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Video uploads (phone .mov and .mp4 files) play in the panel. Tally's file links expire, so the link is fetched fresh
// when Play is pressed.
export const isVideo = (f) => /^video\//i.test(f?.mimeType ?? "") || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f?.name ?? "");

function VideoFile({ file, label, index, responseId }) {
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cantPlay, setCantPlay] = useState(false);
  async function play() {
    setBusy(true);
    setErr("");
    try {
      if (!responseId) throw new Error("no submission to refresh");
      const r = await trainingAction("file", { response_id: responseId });
      const answer = (r?.answers ?? []).find((a) => a.label === label && a.files?.length);
      const fresh = answer?.files?.[index] ?? answer?.files?.find((x) => x.name === file.name);
      if (!fresh?.url) throw new Error("the video wasn't found in Tally");
      setSrc(fresh.url);
    } catch (e) {
      setErr(`Couldn't load the video: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }
  if (!src) {
    return (
      <span className="tr-video-start">
        <button type="button" className="small" disabled={busy} onClick={play}>{busy ? "Loading…" : `▶ Play ${file.name || "video"}`}</button>
        {err && <span className="error small">{err}</span>}
      </span>
    );
  }
  return (
    <span className="tr-video">
      {!cantPlay && <video controls autoPlay playsInline preload="metadata" src={src} onError={() => setCantPlay(true)} aria-label={file.name || "Video"} />}
      {cantPlay && <span className="muted small">This browser can't play this video format (iPhone videos play in Safari, or Chrome on a Mac).</span>}
      <a href={src} target="_blank" rel="noreferrer" className="small">Open in a new tab</a>
    </span>
  );
}

function Answers({ fields, responseId }) {
  const list = (fields ?? []).filter((a) => a.value || a.files?.length).filter((a) => !/^(tid|trainee[ _-]?id)$/i.test(a.label));
  if (!list.length) return <p className="muted small">No answers.</p>;
  return (
    <dl className="tr-answers">
      {list.map((a, i) => (
        <div key={i} className="tr-answer">
          <dt>{a.label || "Question"}</dt>
          <dd>
            {a.files?.length
              ? a.files.map((f, j) => (isVideo(f)
                ? <VideoFile key={j} file={f} label={a.label} index={j} responseId={responseId} />
                : <a key={j} href={f.url} target="_blank" rel="noreferrer">{f.name || "Open file"}</a>))
              : a.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// mode "assessor": the assessor's view of a trainee assigned to them. Answers, videos and the assessment only.
function TraineeDrawer({ row, subs, forms, sends = [], now = Date.now(), templates, data, run, onChanged, onClose, options = [], onAssign, mode = "admin" }) {
  const t = row.t;
  const admin = mode === "admin";
  const n = traineeNames(t);
  const me = data.me?.email ?? "";
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [openStep, setOpenStep] = useState(null);
  const [assessment, setAssessment] = useState(() => structuredClone(t.assessment ?? {}));
  const [feedback, setFeedback] = useState(t.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(t.recommendation ?? null);
  const dirty = JSON.stringify(assessment) !== JSON.stringify(t.assessment ?? {}) || feedback !== (t.feedback ?? "");
  const decided = DECIDED.includes(t.status);
  const submitted = Boolean(t.assessment_submitted_at);
  // Once sent to the admins, the assessor can only read it (an admin can reopen it); admins can always edit.
  const locked = !admin && (submitted || decided);

  const update = (patch, msg) => run(async () => {
    const { error } = await supabase.from("trainees").update(patch).eq("id", t.id);
    if (error) throw error;
  }, msg).then(onChanged);
  const toggleSession = (key, done) => update(
    done ? { [`${key}_attended_at`]: new Date().toISOString(), [`${key}_marked_by`]: me } : { [`${key}_attended_at`]: null, [`${key}_marked_by`]: null },
    `${key === "intro" ? "Intro" : "Closing"} session ${done ? "marked as attended" : "unmarked"}`,
  );
  const setRating = (k, rating) => setAssessment((a) => ({ ...a, [k]: { ...(a[k] ?? {}), rating } }));
  const setNote = (k, note) => setAssessment((a) => ({ ...a, [k]: { ...(a[k] ?? {}), note } }));
  const rated = CRITERIA.filter(([k]) => assessment[k]?.rating).length;
  const assessError = (error) => new Error(/not_allowed/.test(error.message) ? "This trainee is no longer assigned to you."
    : /^submitted/.test(error.message) ? "This assessment has already been sent to the admins. Ask an admin to reopen it." : error.message);
  const saveAssessment = () => run(async () => {
    const { error } = await supabase.rpc("save_assessment", { p_trainee: t.id, p_assessment: assessment, p_feedback: feedback });
    if (error) throw assessError(error);
  }, admin ? "Assessment saved" : "Draft saved").then(onChanged);
  async function submitAssessment() {
    if (!rec) return;
    if (!confirm(`Send your assessment of ${n.title} to the admins? You won't be able to change it after this unless an admin reopens it.`)) return;
    setBusy(true);
    await run(async () => {
      const { error } = await supabase.rpc("submit_assessment", { p_trainee: t.id, p_assessment: assessment, p_feedback: feedback, p_recommendation: rec });
      if (error) throw assessError(error);
    }, "Submitted. The admins will see it on the Training page.");
    setBusy(false);
    onChanged();
  }
  const reopen = () => {
    if (!confirm(`Reopen this assessment for ${assigneeLabel(t.assessment_submitted_by, options)}? They can change it and submit it again.`)) return;
    run(async () => {
      const { error } = await supabase.rpc("reopen_assessment", { p_trainee: t.id });
      if (error) throw error;
    }, "Assessment reopened for the assessor.").then(onChanged);
  };
  const linkForms = STEPS.filter((s) => !s.session).map((s) => forms.find((f) => f.key === s.key)).filter((f) => f?.url);

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer tr-drawer" onClick={(e) => e.stopPropagation()} aria-label={`Trainee ${n.title}`}>
        <div className="drawer-head">
          <h2>{n.title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fac-id">
          <Avatar fac={asFac(t)} size={64} />
          <div className="fac-id-text">
            {n.sub && <div>{n.sub}</div>}
            <div className="fac-email"><span className="fac-email-text">{t.email}</span><CopyButton text={t.email} label="Copy" className="fac-copy" /></div>
            {admin && (t.other_emails ?? []).length > 0 && (
              <div className="small tr-other-emails">
                <span className="muted">Also uses: </span>
                {t.other_emails.map((e) => (
                  <span key={e} className="tr-other-email">{e}{" "}
                    <button type="button" className="link small" aria-label={`Remove ${e}`}
                      onClick={() => update({ other_emails: t.other_emails.filter((x) => x !== e) }, `${e} removed. Forms already linked stay linked.`)}>remove</button>
                  </span>
                ))}
              </div>
            )}
            <div className="muted small">{t.phone || "No phone"}{t.application_submitted_at ? ` · Applied ${fmtDate(t.application_submitted_at)}` : ""}</div>
          </div>
        </div>
        <div className="tr-status-line">
          <span className={`pill tr-status ${STATUS[row.status].cls}`}>{STATUS[row.status].label}</span>
          <span className="muted small">Training {row.done === STEPS.length ? "complete" : `${row.done} of ${STEPS.length} done`}</span>
          {admin && !decided && (
            <label className="small tr-status-select">Status
              <select value={t.status} onChange={(e) => update({ status: e.target.value }, "Status saved")}>
                <option value="applied">Applied</option>
                <option value="in_training">In training</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          )}
        </div>
        {admin && (
          <label className="small tr-assign">Assessor
            <select value={t.assigned_to ?? ""} onChange={(e) => onAssign?.(e.target.value || null)} aria-label="Assigned to">
              <option value="">Unassigned</option>
              {options.map((o) => <option key={o.email} value={o.email} disabled={isSelf(t, o.email)}>{o.name} ({o.kind.toLowerCase()}){isSelf(t, o.email) ? ": their own record" : ""}</option>)}
            </select>
            {t.assigned_at && <span className="muted">since {fmtDate(t.assigned_at)}</span>}
          </label>
        )}

        <Fold title="Training" summary={`${row.done} of ${STEPS.length} done`}>
          <ul className="tr-checklist">
            {row.prog.map((p) => (
              <li key={p.key} className={p.done ? "done" : ""}>
                <div className="tr-step">
                  <i className={`tr-dot ${p.done ? "done" : ""}`} />
                  <span className="tr-step-label">{p.label}</span>
                  {p.session && !admin ? (
                    <span className="muted small">{p.done ? `Attended${p.at ? `, ${fmtDate(p.at)}` : ""}` : "Not marked yet"}</span>
                  ) : p.session ? (
                    <label className="tr-toggle small">
                      <input type="checkbox" checked={p.done} onChange={(e) => toggleSession(p.key, e.target.checked)} aria-label={`${p.label} attended`} />
                      {p.done ? `Attended${p.at ? `, marked ${fmtDate(p.at)}` : ""}` : "Not marked"}
                    </label>
                  ) : p.done ? (
                    <button type="button" className="link small" aria-expanded={openStep === p.key} onClick={() => setOpenStep(openStep === p.key ? null : p.key)}>
                      {fmtDate(p.at)}{p.count > 1 ? ` (${p.count} sent)` : ""} · {openStep === p.key ? "Hide answers" : "Answers"}
                    </button>
                  ) : <span className="muted small">Not yet</span>}
                </div>
                {openStep === p.key && p.submission && <Answers fields={p.submission.fields} responseId={p.submission.response_id} />}
              </li>
            ))}
          </ul>
          <p className="muted small">Videos and files load a fresh link from Tally when opened.</p>
        </Fold>

        {admin && ["applied", "in_training"].includes(t.status) && (
          <SendForm t={t} subs={subs} forms={forms} sends={sends} now={now} templates={templates} data={data} run={run} onChanged={onChanged} />
        )}

        {t.application && (
          <Fold title="Application" summary={t.application_submitted_at ? fmtDate(t.application_submitted_at) : ""} defaultOpen={false}>
            <Answers fields={t.application} responseId={t.application_response_id} />
          </Fold>
        )}

        {admin && <Fold title="Personal form links" summary="Send these so their forms are matched to them" defaultOpen={!decided}>
          <ul className="tr-links">
            {linkForms.map((f) => (
              <li key={f.key}>
                <span className="tr-link-label">{f.label}</span>
                <code className="tr-link small">{formLink(f.url, t.id)}</code>
                <CopyButton text={formLink(f.url, t.id)} label="Copy" />
              </li>
            ))}
          </ul>
          <CopyButton text={linksText(t, forms)} label="Copy all links" />
        </Fold>}

        <Fold title="Assessment" summary={submitted ? `Submitted ${fmtDate(t.assessment_submitted_at)}` : `${rated} of ${CRITERIA.length} rated`}>
          {submitted && (
            <p className="small tr-submitted">
              {admin ? <>Submitted by <b>{assigneeLabel(t.assessment_submitted_by, options)}</b> on {fmtStamp(t.assessment_submitted_at)}</> : <>Submitted on {fmtStamp(t.assessment_submitted_at)}</>}
              {t.recommendation && <>: <span className={`pill tr-rec tr-rec-${t.recommendation}`}>{recommendLabel(t.recommendation)}</span></>}
              {admin && !decided && <>{" "}<button type="button" className="link small" onClick={reopen}>Reopen for the assessor</button></>}
              {!admin && !decided && <span className="muted"> An admin will record the outcome.</span>}
            </p>
          )}
          <div className="tr-criteria">
            {CRITERIA.map(([k, label]) => (
              <div key={k} className="tr-criterion">
                <div className="tr-criterion-head">
                  <span>{label}</span>
                  <div className="seg" role="radiogroup" aria-label={label}>
                    {RATINGS.map(([r, rl]) => (
                      <button key={r} type="button" role="radio" aria-checked={assessment[k]?.rating === r} className={assessment[k]?.rating === r ? "on" : ""} disabled={locked} onClick={() => setRating(k, r)}>{rl}</button>
                    ))}
                  </div>
                </div>
                <input value={assessment[k]?.note ?? ""} placeholder={locked ? "" : "Note (optional)"} aria-label={`${label} note`} readOnly={locked} onChange={(e) => setNote(k, e.target.value)} />
              </div>
            ))}
          </div>
          <label className="tr-feedback">{admin ? "Overall feedback (goes into the email)" : "Overall feedback (admins use it in the final email)"}
            <textarea rows="5" value={feedback} readOnly={locked} onChange={(e) => setFeedback(e.target.value)} />
          </label>
          {!admin && (
            <div className="tr-recommend">
              <span className="small">Your recommendation</span>
              <div className="seg" role="radiogroup" aria-label="Your recommendation">
                {RECOMMEND.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={rec === k} className={rec === k ? "on" : ""} disabled={locked} onClick={() => setRec(k)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {admin ? (
            <div className="actions">
              <button className="primary" disabled={!dirty || busy} onClick={saveAssessment}>{dirty ? "Save assessment" : "Saved"}</button>
            </div>
          ) : !locked && (
            <div className="actions">
              <button disabled={!dirty || busy} onClick={saveAssessment}>{dirty ? "Save draft" : "Draft saved"}</button>
              <button className="primary" disabled={!rec || busy} onClick={submitAssessment} title={rec ? "" : "Choose your recommendation first"}>Submit to admins</button>
            </div>
          )}
        </Fold>

        {admin
          ? <Outcome t={t} row={row} templates={templates} data={data} run={run} assessment={assessment} feedback={feedback} busy={busy} setBusy={setBusy} onChanged={onChanged} />
          : decided && (
            <p className="small tr-decided">Outcome: <b>{STATUS[t.status].label}</b>{t.decided_at ? ` on ${fmtDate(t.decided_at)}` : ""}.</p>
          )}
      </aside>
    </div>
  );
}

function Outcome({ t, row, templates, data, run, assessment, feedback, busy, setBusy, onChanged }) {
  const [decision, setDecision] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const decided = DECIDED.includes(t.status);

  function choose(d) {
    const key = `training_${d}`;
    const tpl = templates[key] ?? DEFAULT_TEMPLATES[key];
    const vars = buildTrainingVars({ trainee: t, settings: data.settings, sender: data.me?.name, feedback });
    const r = render(tpl, vars, { missing: "" });
    setDecision(d);
    setSubject(r.subject);
    setBody(r.text);
  }
  const preview = useMemo(() => render({ subject, body }, {}, { missing: "" }), [subject, body]);
  const leftover = /\{\{\s*[a-z_]+\s*\}\}/.test(subject + body);

  async function decide(send) {
    const label = OUTCOMES.find(([k]) => k === decision)?.[1] ?? decision;
    if (decision === "revoked") {
      if (!confirm(`Revoke ${traineeNames(t).title}? This is permanent: their future applications are marked revoked, and if they facilitate, they are unverified and their circles come off the website.`)) return;
    } else if (["certified", "not_certified"].includes(decision) && row.done < STEPS.length
      && !confirm(`Only ${row.done} of ${STEPS.length} training steps are done. Record the outcome anyway?`)) return;
    setBusy(true);
    await run(() => trainingAction("decide", {
      trainee_id: t.id, decision, send, feedback, assessment,
      ...(send ? { subject, text: preview.text, html: preview.html } : {}),
    }), (o) => {
      if (!send) return `${label} recorded. No email sent.`;
      if (o?.email === "sent") return `${label} recorded. Email sent to ${t.email}.`;
      return { text: `${label} recorded, but the email ${String(o?.email ?? "").replace(/^failed: /, "failed: ")}. See Setup, Sent emails.`, warn: true };
    });
    setBusy(false);
    setDecision(null);
    onChanged();
  }

  return (
    <Fold title="Outcome" summary={decided ? STATUS[t.status].label : "Not decided"}>
      {decided && (
        <p className="small tr-decided">
          <b>{STATUS[t.status].label}</b> on {fmtStamp(t.decided_at)}{t.decided_by ? ` by ${t.decided_by}` : ""}.
          {" "}Email: {t.final_email_status === "sent" ? `sent ${fmtStamp(t.final_email_at)}` : t.final_email_status || "not sent"}.
        </p>
      )}
      {t.recommendation && t.assessment_submitted_at && (
        <p className="small tr-recommends">Assessor recommends: <span className={`pill tr-rec tr-rec-${t.recommendation}`}>{RECOMMEND_SHORT[t.recommendation]}</span></p>
      )}
      <div className="seg tr-decision" role="radiogroup" aria-label="Outcome">
        {OUTCOMES.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={decision === k} className={`${decision === k ? "on" : ""} ${k === "revoked" ? "tr-revoke" : ""}`} disabled={busy} onClick={() => choose(k)}>{label}</button>
        ))}
      </div>
      {decision && <p className={`small tr-outcome-note ${decision === "revoked" ? "warn-text" : "muted"}`}>{OUTCOMES.find(([k]) => k === decision)[2]}</p>}
      {decision && (
        <div className="tr-composer form">
          <p className="muted small">The email is filled in from the wording below the list and your feedback. Edit it here before sending.</p>
          <label>To<input value={t.email} readOnly /></label>
          <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label>Message<textarea rows="14" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" /></label>
          {leftover && <p className="error small">The email still has a {"{{placeholder}}"} in it. Replace it with the real text.</p>}
          <div className="email-preview compact" aria-label="Email preview">
            <div className="email-subject"><span className="muted small">Subject</span> {preview.subject}</div>
            <div className="email-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
          <div className="actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => setDecision(null)}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => decide(false)}>Record without email</button>
            <button type="button" className="primary" disabled={busy || leftover || !subject.trim() || !body.trim()} onClick={() => decide(true)}>Send email and record</button>
          </div>
        </div>
      )}
    </Fold>
  );
}

function TrainingEmails({ templates, data, run, onSaved }) {
  const [key, setKey] = useState("training_form");
  const saved = templates[key] ?? { key, ...DEFAULT_TEMPLATES[key] };
  const [draft, setDraft] = useState({ subject: saved.subject, body: saved.body });
  const bodyRef = useRef(null);
  // Switching email starts from its saved wording. When the saved wording reloads, unsaved edits are kept.
  const shown = useRef({ key, subject: saved.subject, body: saved.body });
  useEffect(() => {
    const prev = shown.current;
    shown.current = { key, subject: saved.subject, body: saved.body };
    setDraft((d) => (prev.key !== key || (d.subject === prev.subject && d.body === prev.body) ? { subject: saved.subject, body: saved.body } : d));
  }, [key, saved.subject, saved.body]);
  const dirty = draft.subject !== saved.subject || draft.body !== saved.body;
  const unknown = unknownPlaceholders(draft);
  const FORM_ONLY = ["form_name", "form_link"];
  const chips = PLACEHOLDERS.filter((p) => ["first_name", "facilitator_name", "support_contact", "sender_name"].includes(p.key)
    || (p.group === "Training" && (key === "training_form" ? FORM_ONLY.includes(p.key) : !FORM_ONLY.includes(p.key))));
  const insert = (k) => {
    const el = bodyRef.current;
    const at = el ? el.selectionStart : draft.body.length;
    setDraft({ ...draft, body: `${draft.body.slice(0, at)}{{${k}}}${draft.body.slice(at)}` });
  };
  const save = () => run(async () => {
    const { error } = await supabase.from("email_templates").upsert({ key, subject: draft.subject, body: draft.body, updated_at: new Date().toISOString(), updated_by: data.me?.email ?? null });
    if (error) throw error;
  }, "Email wording saved").then(onSaved);

  return (
    <section className="card tr-emails" aria-label="Email wording">
      <div className="card-head">
        <h2>Email wording</h2>
        <div className="seg">
          {TEMPLATE_KEYS.map(([k, label]) => <button key={k} type="button" className={k === key ? "active" : ""} onClick={() => setKey(k)}>{label}</button>)}
        </div>
      </div>
        <div className="form">
          <p className="muted small">The starting point for each email. You can still edit every email before it goes. Lines in CAPITALS become headings, and links become clickable.</p>
          <label>Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label>Body<textarea ref={bodyRef} className="template-body" rows="16" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
          {unknown.length > 0 && <p className="error small">Not recognised: {unknown.map((k) => `{{${k}}}`).join(", ")}.</p>}
          <div className="placeholders">
            <span className="muted small">Click to insert at the cursor:</span>
            <div className="ph-group">
              {chips.map((p) => <button key={p.key} type="button" className="ph-chip" title={p.label} onClick={() => insert(p.key)}>{p.key}</button>)}
            </div>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setDraft({ ...DEFAULT_TEMPLATES[key] })}>Reset to original</button>
            <button type="button" className="primary" disabled={!dirty} onClick={save}>{dirty ? "Save email" : "Saved"}</button>
          </div>
          {saved.updated_at && <p className="muted small">Last saved {fmtStamp(saved.updated_at)}{saved.updated_by ? ` by ${saved.updated_by}` : ""}.</p>}
        </div>
    </section>
  );
}

// Settings > Training forms: a full catch-up sync from Tally. Rarely needed (new forms arrive by webhook), so it lives in
// Settings, asks first, and the server allows it at most once every 15 minutes.
export function TallyResync({ data, run }) {
  const [hasKey, setHasKey] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(id); }, []);
  useEffect(() => {
    trainingAction("probe").then((r) => setHasKey(Boolean(r?.has_key))).catch(() => setHasKey(null));
  }, []);
  const reload = () => {};
  const lastSync = data.settings?.training_synced_at ? Date.parse(data.settings.training_synced_at) : null;
  const syncAfter = lastSync ? lastSync + SYNC_COOLDOWN_MS : 0;
  const coolingDown = syncAfter > now;

  async function sync() {
    if (!confirm("Run a full sync from Tally?\n\nOnly needed if forms were missed (for example the webhooks were off). New forms arrive automatically.")) return;
    setSyncing(true);
    await run(() => trainingAction("sync").catch((e) => {
      const m = /^cooldown:\s*(.*)$/i.exec(e?.message ?? "");
      throw m ? new Error(`Tally was synced recently: ${m[1]}. New forms arrive automatically in the meantime.`) : e;
    }), (o) => {
      const forms = Object.values(o?.forms ?? {});
      const found = forms.reduce((n, x) => n + x.found, 0);
      const added = forms.reduce((n, x) => n + x.new, 0);
      const waiting = forms.reduce((n, x) => n + x.unmatched, 0);
      const probs = o?.problems ?? [];
      return {
        text: `Synced from Tally: ${found} submission${found === 1 ? "" : "s"}, ${added} new${waiting ? `, ${waiting} need matching` : ""}.${probs.length ? ` Problems: ${probs.join("; ")}` : ""}`,
        warn: probs.length > 0,
      };
    });
    setSyncing(false);
    reload();
  }

  return (
    <section className="card tr-resync" aria-label="Training forms from Tally">
      <div className="card-head"><h2>Training forms (Tally)</h2></div>
      <p className="muted small">
        Applications and training forms arrive from Tally automatically. A full sync is only needed to catch up on forms that were
        missed, for example while the webhooks were off.
        {lastSync ? ` Last full sync ${fmtStamp(data.settings.training_synced_at)}.` : " No full sync recorded yet."}
      </p>
      {hasKey === false && <p className="muted small">The Tally API key isn't set, so a full sync isn't possible.</p>}
      <div className="actions">
        {coolingDown
          ? <span className="muted small">Available again after {hhmm(syncAfter)}.</span>
          : <button type="button" disabled={syncing || hasKey === false} onClick={sync}>{syncing ? "Syncing…" : "Resync from Tally"}</button>}
      </div>
    </section>
  );
}

// The assessor's whole dashboard: the trainees assigned to them (the database only returns those), their answers and
// videos, and the assessment. No sending, links or outcomes: admins make the final decision.
export function AssessorPage({ email }) {
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  const me = String(email ?? "").toLowerCase();

  useEffect(() => {
    let live = true;
    (async () => {
      const [t, s, f] = await Promise.all([
        supabase.from("trainees").select("*").eq("assigned_to", me).order("created_at", { ascending: false }),
        fetchAll(() => supabase.from("training_submissions").select("*").order("submitted_at", { ascending: false }).order("id")),
        supabase.from("training_forms").select("*").order("sort"),
      ]);
      if (!live) return;
      const err = [t, s, f].find((r) => r.error);
      setLoadErr(err ? err.error.message : "");
      setState({ trainees: t.data ?? [], subs: s.data ?? [], forms: f.data ?? [] });
    })();
    return () => { live = false; };
  }, [me, tick]);

  // One timer for the toast, so an older message's timer can't hide a newer one early.
  const toastTimer = useRef(null);
  const notify = (kind, text) => {
    setToast({ kind, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const run = async (fn, okText) => {
    try {
      const out = await fn();
      if (okText) notify("ok", typeof okText === "function" ? okText(out) : okText);
      return out ?? true;
    } catch (e) {
      notify("error", e?.message ?? String(e));
      return null;
    }
  };

  const rows = useMemo(() => (state ? state.trainees.map((t) => {
    const prog = progress(t, state.subs, state.forms);
    return { id: t.id, t, prog, status: traineeStatus(t, prog), mine: assessorStatus(t), done: prog.filter((p) => p.done).length };
  }) : []), [state]);
  const counts = useMemo(() => {
    const n = { all: rows.length };
    for (const r of rows) n[r.mine] = (n[r.mine] ?? 0) + 1;
    return n;
  }, [rows]);
  const shown = useMemo(() => filterTrainees(rows, { q }).filter((r) => status === "all" || r.mine === status), [rows, status, q]);
  const open = openId && rows.find((r) => r.id === openId);
  const data = useMemo(() => ({ me: { email: me }, settings: {} }), [me]);

  return (
    <main className="content assessor">
      {!state ? <section className="card"><p className="muted">Loading trainees…</p></section> : (
        <section className="card tr-page" aria-label="Trainees assigned to you">
          <div className="card-head">
            <h2>Trainees assigned to you <span className="muted">({shown.length})</span></h2>
            <div className="filters">
              <input type="search" placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trainees" />
            </div>
          </div>
          <p className="card-sub muted small">Open a trainee to see their application, their training forms and videos, and to record your assessment. Save a draft as you go, then submit it to the admins with your recommendation. Admins make the final decision.</p>
          {loadErr && <p className="hint warn">{loadErr}</p>}
          <div className="web-filter" role="group" aria-label="Training status">
            {ASSESSOR_FILTERS.map((k) => (
              <button key={k} type="button" className={`web-chip ${status === k ? "on" : ""}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
                {k === "all" ? "All" : (ASSESSOR_STATUS[k] ?? STATUS[k]).label} <span className="ws-n">{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <Legend />
          <div className="tr-list" role="table" aria-label="Trainees">
            <div className="tr-row tr-head" role="row">
              <span role="columnheader">Trainee</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Training</span>
            </div>
            {shown.map((r) => {
              const n = traineeNames(r.t);
              return (
                <div key={r.id} className="tr-row" role="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                  <span className="tr-person" role="cell">
                    <Avatar fac={asFac(r.t)} size={32} />
                    <span className="tr-names"><b>{n.title}</b>{n.sub && <span className="muted small">{n.sub}</span>}</span>
                  </span>
                  <span className="tr-email small" role="cell">{r.t.email}</span>
                  <span role="cell"><span className={`pill tr-status ${r.mine === "submitted" ? ASSESSOR_STATUS.submitted.cls : STATUS[r.status].cls}`}>{r.mine === "submitted" ? ASSESSOR_STATUS.submitted.label : STATUS[r.status].label}</span></span>
                  <span className="tr-progress" role="cell"><Dots prog={r.prog} /> <span className="muted small">{r.done} of {STEPS.length}</span></span>
                </div>
              );
            })}
            {!shown.length && <p className="muted tr-empty">{rows.length ? "Nobody matches." : "Nobody is assigned to you yet. An admin will assign trainees to you."}</p>}
          </div>
        </section>
      )}
      {open && (
        <TraineeDrawer key={open.id} row={open} subs={state.subs} forms={state.forms} templates={{}} data={data} run={run}
          mode="assessor" onChanged={reload} onClose={() => setOpenId(null)} />
      )}
      <div aria-live="polite" role="status">
        {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
      </div>
    </main>
  );
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Settings > Assessors: people who assess trainees assigned to them. Added here, then sent a sign-in invite.
export function AssessorsCard({ data, run }) {
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from("assessors").select("*").order("name"),
      fetchAll(() => supabase.from("trainees").select("id, assigned_to").not("assigned_to", "is", null).order("id")),
    ]).then(([a, t]) => {
      if (!live) return;
      setList(a.data ?? []);
      const n = {};
      for (const r of t.data ?? []) n[r.assigned_to] = (n[r.assigned_to] ?? 0) + 1;
      setCounts(n);
    });
    return () => { live = false; };
  }, [data, tick]);
  const clean2 = clean(email).toLowerCase();
  const isAdmin = (data.admins ?? []).some((a) => a.email === clean2);
  const exists = (list ?? []).some((a) => a.email === clean2);
  const problem = !clean2 ? "" : !EMAIL_OK.test(clean2) ? "Enter a valid email." : isAdmin ? "They're already an admin, so they can assess anyone." : exists ? "Already an assessor." : "";
  const inviteText = (o) => (o?.invite === "invited" ? "Sign-in invite sent." : o?.invite === "already has an account" ? "They already have a sign-in." : `Invite: ${o?.invite ?? "not sent"}.`);
  const invite = (e) => run(() => trainingAction("invite_assessor", { email: e }), (o) => `${e}: ${inviteText(o)}`);
  // Removing an assessor ends their access; the trainees they had become unassigned (database trigger).
  const remove = (a) => {
    const n = counts[a.email] ?? 0;
    if (!confirm(`Remove ${a.name || a.email} as an assessor?\n\nThey won't be able to see any trainees.${n ? ` Their ${n} assigned trainee${n === 1 ? "" : "s"} will become unassigned.` : ""}`)) return;
    run(async () => {
      const { error } = await supabase.from("assessors").delete().eq("email", a.email);
      if (error) throw error;
    }, `${a.name || a.email} removed as an assessor.`).then(() => setTick((x) => x + 1));
  };

  async function add(ev) {
    ev.preventDefault();
    if (!clean2 || problem || busy) return;
    setBusy(true);
    await run(async () => {
      const { error } = await supabase.from("assessors").insert({ email: clean2, name: clean(name) || null, created_by: data.me?.email ?? null });
      if (error) throw new Error(error.code === "23505" ? "Already an assessor." : error.message);
      return trainingAction("invite_assessor", { email: clean2 }).catch((e) => ({ invite: `invite failed: ${e.message}` }));
    }, (o) => `${clean(name) || clean2} added as an assessor. ${inviteText(o)}`);
    setBusy(false);
    setName("");
    setEmail("");
    setTick((n) => n + 1);
  }

  return (
    <section className="card" aria-label="Assessors">
      <div className="card-head"><h2>Assessors</h2></div>
      <p className="muted small">Assessors sign in to see only the trainees assigned to them (Training page), with their forms and videos, and record the assessment. Admins make the final decision.</p>
      {list === null ? <p className="muted small">Loading…</p> : (
        <div className="list">
          {list.map((a) => (
            <div key={a.email} className="row">
              <div className="row-main"><b>{a.name || a.email}</b>{a.name && <span className="muted small"> · {a.email}</span>}</div>
              <span className="muted small nowrap">{counts[a.email] ?? 0} assigned</span>
              <button type="button" className="link small nowrap" onClick={() => invite(a.email)} aria-label={`Send invite to ${a.email}`}>Send invite</button>
              <button type="button" className="link small nowrap danger-text" onClick={() => remove(a)} aria-label={`Remove ${a.email} as an assessor`}>Remove</button>
            </div>
          ))}
          {!list.length && <p className="muted small">No assessors yet.</p>}
        </div>
      )}
      <form className="form grid2 tr-add-assessor" onSubmit={add} aria-label="Add an assessor">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} /></label>
        {problem && <p className="error small">{problem}</p>}
        <div className="actions"><button className="primary" disabled={!clean2 || Boolean(problem) || busy}>{busy ? "Adding…" : "Add and invite"}</button></div>
      </form>
    </section>
  );
}
