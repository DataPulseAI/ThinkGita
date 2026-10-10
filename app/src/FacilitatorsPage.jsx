// Facilitators: everyone who leads or co-facilitates a circle, their details (editable) and how consistently
// their live circles have met over the last 8 weeks, from Zoom attendance (attendance_sessions).
// Pure helpers (time zones, weekly consistency, flags, filters) are exported for the unit tests.
import { useEffect, useMemo, useState } from "react";
import { supabase, adminAction, STATUS_LABEL, ukWhen, localWhen, isUk, UK_TZ, DAYS, timeLabel, zoneLabel } from "./lib.js";
import { CopyButton, Hover } from "./ui.jsx";
import "./facilitators.css";

export const WEEKS = 8;
const DAY = 86400e3;
// Sessions are loaded this far back: the 8 week strip plus room to see when a circle without a start date began.
export const LOOKBACK_WEEKS = 20;
// A week with no session yet stays neutral until this long after the scheduled end (attendance syncs can lag).
export const GRACE_MS = DAY;
// A session with only the host counts as "host joined, nobody came" when it lasted at least this long; shorter
// solo sessions are test or accidental starts and are ignored.
export const HOST_ONLY_MIN = 15;
const CURRENT = ["pending", "conflict", "approved", "live", "paused"];
const AWAITING = ["pending", "conflict", "approved"];

/* ---------------- Time zones ---------------- */

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return fmtCache.get(tz);
}
export function validTz(tz) {
  if (!tz) return false;
  try { partsFmt(tz); return true; } catch { return false; }
}
const safeTz = (tz) => (validTz(tz) ? tz : UK_TZ);
function fieldsIn(ms, tz) {
  const p = Object.fromEntries(partsFmt(safeTz(tz)).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
// Offset of `tz` from UTC at instant `ms`, in milliseconds (London in summer: +3600000).
export function tzOffsetMs(tz, ms) {
  const f = fieldsIn(ms, tz);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}
// Calendar date (YYYY-MM-DD) of instant `ms` in `tz`.
export function ymdIn(ms, tz) {
  const f = fieldsIn(ms, tz);
  return `${f.y}-${String(f.mo).padStart(2, "0")}-${String(f.d).padStart(2, "0")}`;
}
// The instant when the wall clock in `tz` shows `ymd` `hhmm` (e.g. "2026-10-05", "19:00").
export function zonedTime(ymd, hhmm, tz) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t); // second pass settles times near a clock change
  return t;
}
export function addDays(ymd, n) {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
// ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday (same as circles.weekday).
export function isoWeekday(ymd) {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7;
}

/* ---------------- Sessions and weekly consistency ---------------- */

const durationMin = (s) => (s.ended_at ? (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000 : null);
// What one Zoom session tells us. participant_count includes the host; 0 means the count is not known.
export function sessionKind(s) {
  const n = s.participant_count ?? 0;
  if (n >= 2 || n === 0) return "held";
  const mins = durationMin(s);
  return mins !== null && mins < HOST_ONLY_MIN ? "ignore" : "host";
}

// Sessions per circle: by attendance_sessions.circle_id, or by Zoom meeting ID for sessions not linked to a circle.
export function sessionsByCircle(circles, sessions) {
  const out = new Map(circles.map((c) => [c.id, []]));
  const byMeeting = new Map();
  for (const c of circles) if (c.zoom_meeting_id) byMeeting.set(String(c.zoom_meeting_id), c.id);
  for (const s of sessions ?? []) {
    const id = s.circle_id ?? (s.zoom_meeting_id ? byMeeting.get(String(s.zoom_meeting_id)) : undefined);
    if (id && out.has(id)) out.get(id).push(s);
  }
  return out;
}

// The circle's last `weeks` scheduled sessions up to `now`, oldest first. Each is one week of the strip:
//   held     a session took place (2 or more people, or a count Zoom did not give)
//   host     only the host joined (for at least 15 minutes)
//   missed   no session within 3.5 days either side of the scheduled time
//   waiting  no session yet, but attendance for it may not have synced
//   before   before the start date (or, with no start date, before the first session on record)
//   after    after the end date
//   paused   the circle is paused and no session took place
// Dates follow the circle's own weekday, time and timezone; `uk` is the same moment as a UK date.
export function circleWeeks(c, sessions, now, { weeks = WEEKS, firstSeen } = {}) {
  if (!c?.weekday || !c?.start_time) return [];
  const tz = safeTz(c.timezone);
  const time = String(c.start_time).slice(0, 5);
  let ymd = ymdIn(now, tz);
  while (isoWeekday(ymd) !== c.weekday) ymd = addDays(ymd, -1);
  if (zonedTime(ymd, time, tz) > now) ymd = addDays(ymd, -7);
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const day = addDays(ymd, -7 * i);
    const start = zonedTime(day, time, tz);
    list.push({ ymd: day, start, uk: ymdIn(start, UK_TZ), state: null, session: null });
  }
  const usable = (sessions ?? []).map((s) => ({ s, kind: sessionKind(s), at: Date.parse(s.started_at) })).filter((x) => x.kind !== "ignore");
  for (const w of list) {
    const lo = w.start - 3.5 * DAY;
    const hi = w.start + 3.5 * DAY;
    const inWeek = usable.filter((x) => x.at >= lo && x.at < hi);
    const held = inWeek.filter((x) => x.kind === "held").sort((a, b) => (b.s.participant_count ?? 0) - (a.s.participant_count ?? 0));
    const pick = held[0] ?? inWeek[0];
    if (pick) { w.state = pick.kind; w.session = pick.s; continue; }
    const end = w.start + (c.duration_min ?? 60) * 60000;
    const startDay = c.starts_on ?? (firstSeen ? ymdIn(firstSeen - 3.5 * DAY, tz) : null);
    if (startDay && w.ymd < startDay) w.state = "before";
    else if (c.ends_on && w.ymd > c.ends_on) w.state = "after";
    else if (c.status === "paused") w.state = "paused";
    else if (now < end + GRACE_MS) w.state = "waiting";
    else w.state = "missed";
  }
  return list;
}

const DUE = ["held", "host", "missed"];
// Consistency of one circle: the week strip, counts, last session, average attendance and gentle flags.
export function circleConsistency(c, sessions, now, opts = {}) {
  const usable = (sessions ?? []).filter((s) => sessionKind(s) !== "ignore");
  const firstSeen = usable.length ? Math.min(...usable.map((s) => Date.parse(s.started_at))) : null;
  const lastSeen = usable.length ? Math.max(...usable.map((s) => Date.parse(s.started_at))) : null;
  const weeks = c.status === "live" || c.status === "paused" ? circleWeeks(c, usable, now, { ...opts, firstSeen }) : [];
  const due = weeks.filter((w) => DUE.includes(w.state));
  const met = due.filter((w) => w.state !== "missed");
  const missed = due.length - met.length;
  const counts = weeks.filter((w) => w.state === "held" && w.session?.participant_count > 0).map((w) => w.session.participant_count);
  const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : null;
  let trailing = 0;
  for (let i = due.length - 1; i >= 0 && due[i].state === "missed"; i--) trailing++;
  const last4 = due.slice(-4);
  const missed4 = last4.filter((w) => w.state === "missed").length;
  const flags = [];
  if (c.status === "live" && due.length >= 2) {
    if (!usable.length) flags.push("No sessions on record");
    else if (trailing >= 3) flags.push(`No session in ${trailing} weeks`);
    else if (missed4 >= 2) flags.push(`Missed ${missed4} of the last ${last4.length} weeks`);
  }
  const running = c.status === "live" && due.length > 0;
  const nextStart = c.status === "live" && !running && c.starts_on ? c.starts_on : null;
  return { weeks, due: due.length, met: met.length, missed, trailing, avg, lastSession: lastSeen, flags, running, nextStart };
}

/* ---------------- Facilitators ---------------- */

const clean = (v) => String(v ?? "").trim();
export const isEmailLike = (v) => clean(v).includes("@");
// Name to show: the initiated name if any, else first and last name, else the name on record.
// `sub` is the legal or first name shown beside an initiated name.
export function facilitatorNames(f) {
  const init = clean(f?.initiated_name);
  const parts = [clean(f?.first_name), clean(f?.last_name)].filter(Boolean).join(" ");
  const name = clean(f?.name);
  const usableName = isEmailLike(name) ? "" : name;
  if (init) {
    // Names from the form look like "Initiated (First Last)": show the part in brackets.
    const inner = usableName.match(/^(.*)\((.+)\)\s*$/)?.[2]?.trim();
    const sub = parts || inner || (usableName && usableName !== init ? usableName : "");
    return { title: init, sub };
  }
  return { title: parts || usableName || clean(f?.email) || "No name", sub: "" };
}
export function initials(f) {
  const { title } = facilitatorNames(f);
  const words = title.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}
const isUrl = (v) => /^https?:\/\/\S+$/i.test(clean(v));
// Details worth fixing, shown under the name and as filters.
export function detailFlags(f) {
  const out = [];
  if (!clean(f.name) || isEmailLike(f.name)) out.push({ key: "name", label: "Name is an email" });
  if (!isUrl(f.photo_url)) out.push({ key: "photo", label: "No photo" });
  if (!clean(f.phone)) out.push({ key: "phone", label: "No phone" });
  return out;
}

export const STATUS = {
  check: { label: "Needs a check", hint: "A live circle missed sessions recently" },
  well: { label: "Running well", hint: "Every live circle has met regularly" },
  starting: { label: "Starting soon", hint: "Awaiting approval, or live with a start date still to come" },
  paused: { label: "Paused", hint: "Only paused circles" },
  none: { label: "No active circles", hint: "Not on any current circle" },
};

// One row per facilitator: their current circles (lead and co-facilitated), consistency and flags.
export function buildRows(facilitators, circles, sessions, now) {
  const bySession = sessionsByCircle(circles, sessions);
  const byFac = new Map((facilitators ?? []).map((f) => [f.id, { fac: f, lead: [], co: [] }]));
  // Facilitators only known through a circle (the facilitators query failed or is still loading) still get a row.
  const ensure = (f) => { if (f && !byFac.has(f.id)) byFac.set(f.id, { fac: f, lead: [], co: [] }); return f && byFac.get(f.id); };
  const health = new Map();
  for (const c of circles) {
    if (!CURRENT.includes(c.status)) continue;
    health.set(c.id, circleConsistency(c, bySession.get(c.id), now));
    ensure(c.facilitator)?.lead.push(c);
    for (const x of c.cofacilitators ?? []) ensure(x.facilitator)?.co.push(c);
  }
  return [...byFac.values()].map(({ fac, lead, co }) => {
    const all = [...lead.map((c) => ({ c, role: "lead" })), ...co.map((c) => ({ c, role: "co" }))]
      .map((x) => ({ ...x, h: health.get(x.c.id) }));
    const live = all.filter((x) => x.c.status === "live");
    const running = live.filter((x) => x.h.running);
    // With several running circles, say which circle each flag is about.
    const circleFlags = [...new Set(running.flatMap((x) => (running.length > 1 ? x.h.flags.map((f) => `${circleLabel(x.c).what} ${circleLabel(x.c).when}: ${f}`) : x.h.flags)))];
    let status = "none";
    if (circleFlags.length) status = "check";
    else if (running.length) status = "well";
    else if (all.some((x) => AWAITING.includes(x.c.status) || x.c.status === "live")) status = "starting";
    else if (all.some((x) => x.c.status === "paused")) status = "paused";
    const lastSession = Math.max(0, ...all.map((x) => x.h.lastSession ?? 0)) || null;
    const avgs = running.map((x) => x.h.avg).filter((v) => v != null);
    const count = (role, sts) => all.filter((x) => x.role === role && sts.includes(x.c.status)).length;
    const names = facilitatorNames(fac);
    return {
      id: fac.id, fac, names, circles: all, status, circleFlags, details: detailFlags(fac), lastSession,
      avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
      counts: { live: count("lead", ["live"]), awaiting: count("lead", AWAITING), paused: count("lead", ["paused"]), co: all.filter((x) => x.role === "co").length },
      active: all.length,
      search: [fac.name, fac.initiated_name, fac.first_name, fac.last_name, fac.email, fac.phone, ...all.map((x) => x.c.name)].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

export const SORTS = {
  attention: "Needs a check first",
  name: "Name",
  circles: "Most circles",
  last: "Last session (oldest first)",
};
const STATUS_ORDER = ["check", "well", "starting", "paused", "none"];
export function filterRows(rows, { status = "all", detail = null, q = "" } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (status === "all" || r.status === status)
    && (!detail || r.details.some((d) => d.key === detail))
    && words.every((w) => r.search.includes(w)));
}
export function sortRows(rows, sort = "attention") {
  const byName = (a, b) => a.names.title.localeCompare(b.names.title, "en", { sensitivity: "base" });
  const cmp = {
    name: byName,
    circles: (a, b) => b.active - a.active || byName(a, b),
    last: (a, b) => (a.lastSession ?? Infinity) - (b.lastSession ?? Infinity) || byName(a, b),
    attention: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byName(a, b),
  }[sort] ?? byName;
  return [...rows].sort(cmp);
}

/* ---------------- Formatting ---------------- */

const ukShort = (ms) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK_TZ });
export function ago(ms, now) {
  const days = Math.floor((ymdToMs(ymdIn(now, UK_TZ)) - ymdToMs(ymdIn(ms, UK_TZ))) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}
const ymdToMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
const fmtYmd = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shortCircle = (name) => String(name ?? "").replace(/^Gita Circles \| /, "");
// Short label that tells a facilitator's circles apart: type and language, then day and time in the circle's own zone.
// { what: "Bhakti, Spanish", when: "Thu 6pm CDMX" }
export function circleLabel(c) {
  const type = clean(c?.circle_type).replace(/^Think (?=Gita)/i, "").replace(/ Circles?$/i, "") || "Circle";
  const lang = clean(c?.language);
  const what = lang && !/^english$/i.test(lang) ? `${type}, ${lang}` : type;
  const when = c?.weekday && c?.start_time ? `${DAYS[c.weekday]} ${timeLabel(String(c.start_time).slice(0, 5))} ${zoneLabel(c.timezone || UK_TZ)}` : "";
  return { what, when };
}

const WEEK_LABEL = {
  held: "Held", host: "Host only, nobody joined", missed: "No session", waiting: "Not synced yet",
  before: "Not started", after: "After the end date", paused: "Paused",
};
function weekText(w) {
  if (w.state === "held" && w.session?.participant_count > 0) return `Held, ${plural(w.session.participant_count, "person").replace("persons", "people")}`;
  return WEEK_LABEL[w.state];
}

/* ---------------- Components ---------------- */

function Avatar({ fac, size = 36 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [fac.photo_url]);
  const url = clean(fac.photo_url);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (isUrl(url) && !broken) return <img className="fac-avatar" src={url} alt="" style={style} onError={() => setBroken(true)} />;
  return <span className={`fac-avatar fac-initials ${broken ? "broken" : ""}`} style={style} aria-hidden="true" title={broken ? "This photo did not load" : undefined}>{initials(fac)}</span>;
}

// Eight squares, oldest on the left. Hovering shows the date and what happened each week.
export function WeekStrip({ weeks, large, title }) {
  if (!weeks.length) return null;
  const dots = (
    <span className={`fac-strip ${large ? "large" : ""}`} tabIndex={0}
      aria-label={`${title ? `${title}. ` : ""}${weeks.map((w) => `${fmtYmd(w.uk)}: ${weekText(w)}`).join("; ")}`}>
      {weeks.map((w) => <i key={w.ymd} className={`wk wk-${w.state}`} />)}
    </span>
  );
  return (
    <Hover content={(
      <>
        <div className="hc-title">{title || `Last ${weeks.length} weeks`}</div>
        <div className="hc-sub">{title ? `Last ${weeks.length} weeks, s` : "S"}cheduled dates in UK time</div>
        <dl className="hc-rows hc-times">
          {[...weeks].reverse().map((w) => (
            <Fragmentish key={w.ymd} dt={fmtYmd(w.uk)} dd={<><i className={`wk wk-${w.state} wk-inline`} /> {weekText(w)}</>} />
          ))}
        </dl>
      </>
    )}>{dots}</Hover>
  );
}
const Fragmentish = ({ dt, dd }) => <><dt>{dt}</dt><dd>{dd}</dd></>;

function StripLegend() {
  return (
    <div className="fac-legend small muted">
      <span><i className="wk wk-held" /> Held</span>
      <span><i className="wk wk-host" /> Host only</span>
      <span><i className="wk wk-missed" /> No session</span>
      <span><i className="wk wk-before" /> Not started or not synced</span>
      <span><i className="wk wk-paused" /> Paused</span>
    </div>
  );
}

function CircleCounts({ r }) {
  const { live, awaiting, paused, co } = r.counts;
  if (!r.active) return <span className="muted small">None</span>;
  return (
    <span className="fac-counts">
      {live > 0 && <span className="pill st-live">{live} live</span>}
      {awaiting > 0 && <span className="pill st-pending">{awaiting} awaiting</span>}
      {paused > 0 && <span className="pill st-paused">{paused} paused</span>}
      {co > 0 && <span className="pill fac-co">{co} co-facilitating</span>}
    </span>
  );
}

// The strip column of a row: one strip per live circle, or a short note when nothing is running.
function RowStrips({ r }) {
  const live = r.circles.filter((x) => x.c.status === "live" || x.c.status === "paused");
  const shown = live.filter((x) => x.h.weeks.length && (x.h.running || x.c.status === "paused"));
  if (!shown.length) {
    const startsOn = live.map((x) => x.h.nextStart).filter(Boolean).sort()[0];
    return <span className="muted small">{startsOn ? `Starts ${fmtYmd(startsOn)}` : r.active ? "Not started yet" : "Nothing running"}</span>;
  }
  return (
    <div className="fac-strips">
      {shown.slice(0, 3).map((x) => {
        const l = circleLabel(x.c);
        return (
          <div key={x.c.id} className="fac-strip-row">
            <span className={`fac-strip-label ${x.h.flags.length ? "warn" : ""}`} title={shortCircle(x.c.name)}>
              <b>{l.what}</b> <span>{l.when}</span>{x.role === "co" && <span> · co</span>}
            </span>
            <WeekStrip weeks={x.h.weeks} title={`${l.what} ${l.when}`} />
          </div>
        );
      })}
      {shown.length > 3 && <span className="muted small">+{shown.length - 3} more</span>}
    </div>
  );
}

export function FacilitatorsPage({ data, run, onSelect }) {
  const [facs, setFacs] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState(null);
  const [sort, setSort] = useState("attention");
  const [openId, setOpenId] = useState(null);

  // Facilitators reload whenever the dashboard data reloads (after any save).
  useEffect(() => {
    let live = true;
    supabase.from("facilitators").select("*").order("name").then(({ data: rows, error }) => {
      if (!live) return;
      if (error) setLoadErr(error.message);
      setFacs(rows ?? []);
    });
    return () => { live = false; };
  }, [data]);
  // Attendance for the last 20 weeks, once per visit.
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - LOOKBACK_WEEKS * 7 * DAY).toISOString();
    (async () => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data: rows, error } = await supabase.from("attendance_sessions")
          .select("id, circle_id, zoom_meeting_id, started_at, ended_at, participant_count")
          .gte("started_at", since).order("started_at").order("id").range(from, from + 999);
        if (error) { if (live) setLoadErr(`Attendance could not be loaded: ${error.message}`); break; }
        out.push(...(rows ?? []));
        if (!rows || rows.length < 1000) break;
      }
      if (live) { setSessions(out); setNow(Date.now()); }
    })();
    return () => { live = false; };
  }, []);

  const rows = useMemo(() => (facs ? buildRows(facs, data.circles, sessions ?? [], now) : []), [facs, data.circles, sessions, now]);
  const counts = useMemo(() => {
    const n = { all: rows.length };
    for (const r of rows) {
      n[r.status] = (n[r.status] ?? 0) + 1;
      for (const d of r.details) n[`d:${d.key}`] = (n[`d:${d.key}`] ?? 0) + 1;
    }
    return n;
  }, [rows]);
  const shown = useMemo(() => sortRows(filterRows(rows, { status, detail, q }), sort), [rows, status, detail, q, sort]);
  const open = openId && rows.find((r) => r.id === openId);

  if (!facs) return <section className="card"><p className="muted">Loading facilitators…</p></section>;
  return (
    <section className="card fac-page">
      <div className="card-head">
        <h2>Facilitators <span className="muted">({shown.length})</span></h2>
        <div className="filters">
          <input type="search" placeholder="Search name, email, phone, circle" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search facilitators" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>
      <p className="card-sub">
        Weekly consistency of each live circle over the last {WEEKS} weeks, from Zoom attendance. A week counts as missed when no
        session took place within 3.5 days of the scheduled time. {sessions === null && "Loading attendance…"}
      </p>
      {loadErr && <p className="hint warn">{loadErr}</p>}
      <div className="web-filter" role="group" aria-label="Circles">
        <span className="web-filter-label">Circles</span>
        {[["all", { label: "All" }], ...Object.entries(STATUS)].map(([k, s]) => (k === "all" || counts[k] || status === k) ? (
          <button key={k} type="button" className={`web-chip fs-${k} ${status === k ? "on" : ""}`} title={s.hint} aria-pressed={status === k} onClick={() => setStatus(k)}>
            {k !== "all" && <span className="ws-dot" />}{s.label} <span className="ws-n">{counts[k] ?? 0}</span>
          </button>
        ) : null)}
      </div>
      {(counts["d:photo"] || counts["d:name"] || counts["d:phone"] || detail) && (
        <div className="web-filter" role="group" aria-label="Details">
          <span className="web-filter-label">Details</span>
          {[["photo", "No photo"], ["name", "Name is an email"], ["phone", "No phone"]].map(([k, label]) => (counts[`d:${k}`] || detail === k) ? (
            <button key={k} type="button" className={`web-chip ${detail === k ? "on" : ""}`} aria-pressed={detail === k} onClick={() => setDetail(detail === k ? null : k)}>
              {label} <span className="ws-n">{counts[`d:${k}`] ?? 0}</span>
            </button>
          ) : null)}
        </div>
      )}
      <StripLegend />

      <div className="fac-list" role="table" aria-label="Facilitators">
        <div className="fac-row fac-head" role="row">
          <span role="columnheader">Facilitator</span>
          <span role="columnheader">Contact</span>
          <span role="columnheader">Circles</span>
          <span role="columnheader">Last {WEEKS} weeks</span>
          <span role="columnheader">Last session</span>
        </div>
        {shown.map((r) => (
          <div key={r.id} className={`fac-row ${r.status === "check" ? "fac-row-check" : ""}`} role="row" tabIndex={0}
            onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenId(r.id); }}>
            <span className="fac-person" role="cell">
              <Avatar fac={r.fac} />
              <span className="fac-names">
                <span className="fac-name">{r.names.title}</span>
                {r.names.sub && <span className="muted small">{r.names.sub}</span>}
                {(r.circleFlags.length > 0 || r.details.some((d) => d.key === "name")) && (
                  <span className="fac-flags small">
                    {r.circleFlags.map((f) => <span key={f} className="warn-text">{f}</span>)}
                    {r.details.filter((d) => d.key === "name").map((d) => <span key={d.key} className="warn-text">{d.label}</span>)}
                  </span>
                )}
              </span>
            </span>
            <span className="fac-contact" role="cell">
              <span className="fac-email">
                <span className="fac-email-text">{r.fac.email}</span>
                <CopyButton text={r.fac.email} label="Copy" className="fac-copy" />
              </span>
              <span className="muted small">{r.fac.phone || "No phone"}</span>
            </span>
            <span className="fac-circles" role="cell"><CircleCounts r={r} /></span>
            <span className="fac-weeks" role="cell"><RowStrips r={r} /></span>
            <span className="fac-last" role="cell">
              {r.lastSession ? (
                <>
                  <span>{ukShort(r.lastSession)}</span>
                  <span className="muted small">{ago(r.lastSession, now)}{r.avg != null && ` · avg ${Math.round(r.avg)}`}</span>
                </>
              ) : <span className="muted small">{sessions === null ? "…" : "None on record"}</span>}
            </span>
          </div>
        ))}
        {!shown.length && <p className="muted fac-empty">No facilitators match.</p>}
      </div>

      {open && <FacilitatorPanel key={open.id} r={open} now={now} run={run} onSelect={onSelect} onClose={() => setOpenId(null)} />}
    </section>
  );
}

/* ---------------- Side panel ---------------- */

const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 5 * 1024 * 1024;
const FIELDS = ["initiated_name", "first_name", "last_name", "name", "email", "phone", "photo_url"];
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v));

// The row to save: trimmed, empty as null (name and email are required), email in lower case.
export function facilitatorUpdate(fac, form) {
  const norm = (k, v) => { const t = k === "email" ? clean(v).toLowerCase() : clean(v); return t || null; };
  const patch = {};
  for (const k of FIELDS) {
    const next = norm(k, form[k]);
    if (next !== norm(k, fac[k])) patch[k] = next ?? (k === "name" || k === "email" ? "" : null);
  }
  return patch;
}
export function formProblems(form) {
  const p = {};
  if (!clean(form.name)) p.name = "A name is needed.";
  else if (isEmailLike(form.name)) p.name = "Use the person's name here, not an email.";
  if (!isEmail(form.email)) p.email = "Enter a valid email.";
  if (clean(form.photo_url) && !isUrl(form.photo_url)) p.photo_url = "That doesn't look like a link. It should start with https://";
  return p;
}

function FacilitatorPanel({ r, now, run, onSelect, onClose }) {
  const fac = r.fac;
  useEffect(() => {
    // Escape closes this panel, unless a circle panel is open on top of it (that one closes first).
    const onKey = (e) => { if (e.key === "Escape" && document.querySelectorAll("aside.drawer").length <= 1) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const initial = () => Object.fromEntries(FIELDS.map((k) => [k, fac[k] ?? ""]));
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => { setF(initial()); }, [fac]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPhotoBroken(false), [f.photo_url]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const patch = facilitatorUpdate(fac, f);
  const changed = Object.keys(patch).length > 0;
  const problems = formProblems(f);
  const invalid = Object.keys(problems).length > 0;
  const preview = { ...fac, ...f };
  const lead = r.circles.filter((x) => x.role === "lead");
  const autoNamed = lead.filter((x) => x.c.name_auto);

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setUploadErr("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setUploadErr("Use a JPEG, PNG or WebP image.");
    if (file.size > PHOTO_MAX) return setUploadErr("That image is over 5 MB.");
    setBusy(true);
    try {
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const path = `${fac.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) throw error;
      const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      setF((x) => ({ ...x, photo_url: data.publicUrl }));
    } catch (err) {
      setUploadErr(`Upload failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (busy || invalid || !changed) return;
    setBusy(true);
    await run(async () => {
      const { error } = await supabase.from("facilitators").update(patch).eq("id", fac.id);
      if (error) {
        if (error.code === "23505" || /duplicate key|facilitators_email_key/.test(error.message)) throw new Error("Another facilitator already uses that email.");
        throw error;
      }
      // A change of name or initiated name already refreshes their circles (database trigger). First and last names
      // feed the automatic circle name too but don't fire that trigger, so touch those circles to refresh the name.
      const nameKeys = Object.keys(patch).filter((k) => ["first_name", "last_name"].includes(k));
      if (nameKeys.length && !("name" in patch) && !("initiated_name" in patch) && autoNamed.length) {
        const { error: e2 } = await supabase.from("circles").update({ name_auto: true }).eq("facilitator_id", fac.id).eq("name_auto", true);
        if (e2) throw e2;
      }
      // Live circles whose automatic name changed: the Zoom meeting title follows.
      let renamed = 0;
      if (["name", "initiated_name", "first_name", "last_name"].some((k) => k in patch) && autoNamed.some((x) => x.c.status === "live")) {
        const { data: now2 } = await supabase.from("circles").select("id, name, status").eq("facilitator_id", fac.id);
        for (const c of now2 ?? []) {
          const before = lead.find((x) => x.c.id === c.id)?.c;
          if (c.status === "live" && before && before.name !== c.name) {
            await adminAction("rename", c.id).catch(() => {});
            renamed++;
          }
        }
      }
      return { renamed };
    }, (o) => `Facilitator saved${o?.renamed ? `. ${plural(o.renamed, "circle")} renamed, Zoom titles updated` : ""}.`);
    setBusy(false);
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer fac-drawer" onClick={(e) => e.stopPropagation()} aria-label={`Facilitator ${r.names.title}`}>
        <div className="drawer-head">
          <h2>{r.names.title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fac-id">
          <Avatar fac={fac} size={64} />
          <div className="fac-id-text">
            {r.names.sub && <div>{r.names.sub}</div>}
            <div className="fac-email"><span className="fac-email-text">{fac.email}</span><CopyButton text={fac.email} label="Copy" className="fac-copy" /></div>
            <div className="muted small">{fac.phone ? <a href={`tel:${fac.phone.replace(/\s+/g, "")}`}>{fac.phone}</a> : "No phone"}</div>
          </div>
        </div>
        <div className="pills">
          <span className={`pill fac-status fs-${r.status}`}>{STATUS[r.status].label}</span>
          {r.circleFlags.map((x) => <span key={x} className="pill fac-flag">{x}</span>)}
          {r.details.map((d) => <span key={d.key} className="pill fac-detail">{d.label}</span>)}
        </div>

        <h3 className="section-title">Circles ({r.circles.length})</h3>
        {!r.circles.length && <p className="muted small">Not on any current circle.</p>}
        <div className="fac-circle-list">
          {r.circles.map(({ c, role, h }) => (
            <div key={c.id} className="fac-circle">
              <div className="fac-circle-head">
                <button type="button" className="link fac-circle-name" onClick={() => onSelect(c)}>{shortCircle(c.name)}</button>
                <span className={`pill st-${c.status}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="muted small">
                {role === "co"
                  ? `Co-facilitating${c.facilitator ? ` with ${facilitatorNames(c.facilitator).title}` : ""} · `
                  : (c.cofacilitators ?? []).length ? `With ${c.cofacilitators.map((x) => x.facilitator).filter(Boolean).map((x) => facilitatorNames(x).title).join(", ")} · ` : ""}
                {ukWhen(c)} UK{!isUk(c) && ` (${localWhen(c)})`}
                {c.starts_on && ` · from ${fmtYmd(c.starts_on)}`}
              </div>
              {h.weeks.length > 0 && (h.running || c.status === "paused") ? (
                <div className="fac-circle-weeks">
                  <WeekStrip weeks={h.weeks} large />
                  <span className="small">
                    {h.due ? `Met ${h.met} of ${h.due} weeks` : "No weeks due yet"}
                    {h.avg != null && ` · avg ${Math.round(h.avg)} people`}
                    {h.lastSession && ` · last ${ukShort(h.lastSession)}`}
                  </span>
                  <span className="fac-strip-dates muted small">{fmtYmd(h.weeks[0].uk)} to {fmtYmd(h.weeks[h.weeks.length - 1].uk)}</span>
                </div>
              ) : (
                <div className="muted small">{h.nextStart ? `Starts ${fmtYmd(h.nextStart)}` : c.status === "live" ? "No sessions due yet" : "Not started yet"}</div>
              )}
              {h.flags.map((x) => <div key={x} className="small warn-text">{x}</div>)}
            </div>
          ))}
        </div>

        <h3 className="section-title">Details</h3>
        <form className="form fac-form" onSubmit={save}>
          <div className="fac-photo-row">
            {isUrl(f.photo_url) && !photoBroken
              ? <img className="fac-photo-preview" src={clean(f.photo_url)} alt="" onError={() => setPhotoBroken(true)} />
              : <span className={`fac-photo-preview fac-initials ${photoBroken ? "broken" : ""}`}>{photoBroken ? "!" : initials(preview)}</span>}
            <div className="fac-photo-fields">
              <label>Photo link
                <input type="url" value={f.photo_url} onChange={set("photo_url")} disabled={busy} placeholder="https://…jpg" />
              </label>
              {problems.photo_url && <p className="error small">{problems.photo_url}</p>}
              {photoBroken && !problems.photo_url && <p className="error small">This image did not load. Check the link is public.</p>}
              <div className="fac-photo-actions small">
                <label className="fac-upload">
                  <input type="file" accept={PHOTO_TYPES.join(",")} disabled={busy} onChange={upload} />
                  <span className="link">Upload a photo</span>
                </label>
                {f.photo_url && <button type="button" className="link" disabled={busy} onClick={() => setF({ ...f, photo_url: "" })}>Remove</button>}
              </div>
              {uploadErr && <p className="error small">{uploadErr}</p>}
            </div>
          </div>
          <div className="grid2">
            <label>Initiated name
              <input value={f.initiated_name} onChange={set("initiated_name")} disabled={busy} placeholder="Optional" />
            </label>
            <label>Name
              <input value={f.name} onChange={set("name")} disabled={busy} required />
            </label>
          </div>
          {problems.name && <p className="error small">{problems.name}</p>}
          <div className="grid2">
            <label>First name
              <input value={f.first_name} onChange={set("first_name")} disabled={busy} placeholder="Used in emails" />
            </label>
            <label>Last name
              <input value={f.last_name} onChange={set("last_name")} disabled={busy} />
            </label>
          </div>
          <div className="grid2">
            <label>Email
              <input type="email" value={f.email} onChange={set("email")} disabled={busy} />
            </label>
            <label>Phone
              <input type="tel" value={f.phone} onChange={set("phone")} disabled={busy} placeholder="+44 …" />
            </label>
          </div>
          {problems.email && <p className="error small">{problems.email}</p>}
          {"email" in patch && !problems.email && (
            <p className="hint warn">They sign in and get circle emails at this address. After saving, they sign in with the new email.</p>
          )}
          <p className="muted small">
            {lead.length
              ? <>Changing a name updates the automatic names of the {plural(lead.length, "circle")} they lead
                  {lead.length > autoNamed.length && ` (${lead.length - autoNamed.length} with a custom name keep it)`} and their live Zoom titles.
                  A new name, initiated name or photo also refreshes the website listing of every circle they are on; the card
                  name follows them unless the circle has its own website name or keeps the host name from an imported title. </>
              : <>Changes show on any circle they join later. </>}
            The photo is the one shown on the website for the circles they lead, unless a circle has its own photo.
          </p>
          <div className="actions">
            <button className="primary" disabled={busy || invalid || !changed}>{busy ? "Saving…" : "Save details"}</button>
            {changed && <button type="button" className="ghost" disabled={busy} onClick={() => setF(initial())}>Undo</button>}
          </div>
        </form>
      </aside>
    </div>
  );
}
