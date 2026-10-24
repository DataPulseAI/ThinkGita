// Circle attendees: people who signed up on the Tally form "Think Gita Circles Sign Up", linked to their circle.
// Admins: every attendee, "Needs matching" for older sign-ups the system couldn't place, and the Tally import in Settings.
// Facilitators: the attendees of their own circles (Facilitator.jsx, my_circle_signups) without the date of birth.
// Sign-ups are written by the `signups` edge function; admins only choose the circle (a manual match).
import { useEffect, useMemo, useState } from "react";
import { supabase, signupsAction, adminAction, STATUS_LABEL, fmtDate } from "./lib.js";
import { CopyButton } from "./ui.jsx";
import { signupLink } from "./signupLink.js";
import "./attendees.css";

const SIGNUP_COLS = "id, response_id, submitted_at, circle_id, match_method, match_note, match_candidates, matched_by, matched_at, " +
  "first_name, last_name, email, phone, city, country, date_of_birth, read_before, heard_from, goals, whatsapp_active, consent, utm";
const SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const MATCHABLE = ["live", "paused", "approved", "ended"];
export const METHOD = {
  link: "From the sign-up link",
  auto: "Matched on the link details",
  manual: "Chosen by an admin",
};

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

export const personName = (s) => [s.first_name, s.last_name].filter(Boolean).join(" ") || s.email || "No name given";
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }) : "");
const shortCircle = (name) => String(name ?? "").replace(/^Gita Circles \| /, "");
export const waiting = (s) => !s.circle_id && !s.match_method;

// Search and circle filter (circle: "all", "none" for not linked, or a circle id).
export function filterSignups(rows, { q = "", circle = "all" } = {}) {
  const needle = q.trim().toLowerCase();
  return rows.filter((s) => {
    if (circle === "none" ? s.circle_id : circle !== "all" && s.circle_id !== circle) return false;
    if (!needle) return true;
    return [s.first_name, s.last_name, s.email, s.phone, s.city, s.country].some((v) => String(v ?? "").toLowerCase().includes(needle));
  });
}

// A spreadsheet of the rows shown (opens in Excel or Google Sheets).
const CSV_COLS = [
  ["First name", "first_name"], ["Last name", "last_name"], ["Email", "email"], ["WhatsApp", "phone"], ["City", "city"],
  ["Country", "country"], ["Signed up", "submitted_at"], ["Gita familiarity", "read_before"], ["Heard about us", "heard_from"],
  ["Goals", "goals"],
];
export function toCsv(rows, circleName = () => "") {
  const cell = (v) => {
    const t = String(v ?? "");
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = [...CSV_COLS.map(([h]) => h), "Circle"];
  const lines = rows.map((s) => [...CSV_COLS.map(([, k]) => (k === "submitted_at" ? fmtDay(s[k]) : s[k])), circleName(s.circle_id)].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}
export function downloadCsv(rows, file, circleName) {
  const blob = new Blob([`﻿${toCsv(rows, circleName)}`], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// One attendee, opened: what they wrote on the form.
export function SignupDetail({ s, admin, contact = true }) {
  const rows = [
    contact && ["Email", s.email], contact && ["WhatsApp", s.phone], ["City", [s.city, s.country].filter(Boolean).join(", ")],
    admin && ["Date of birth", s.date_of_birth ? fmtDate(s.date_of_birth) : ""],
    ["Gita familiarity", s.read_before], ["Heard about us", s.heard_from], ["Inspirations and goals", s.goals],
    ["Active on WhatsApp", s.whatsapp_active == null ? "" : s.whatsapp_active ? "Yes" : "No"],
  ].filter((r) => r && r[1]);
  return (
    <dl className="at-detail">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

/* ---------------- Admin page ---------------- */

export function AttendeesPage({ data, run, initial, onSelect }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [view, setView] = useState(initial === "match" ? "match" : "list");
  const [circle, setCircle] = useState(initial && initial !== "match" ? initial : "all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [changeId, setChangeId] = useState(null); // a linked sign-up whose circle is being changed
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let live = true;
    fetchAll(() => supabase.from("circle_signups").select(SIGNUP_COLS).order("submitted_at", { ascending: false }).order("id")).then((r) => {
      if (!live) return;
      setErr(r.error?.message ?? "");
      setRows(r.data ?? []);
    });
    return () => { live = false; };
  }, [tick]);

  const byId = useMemo(() => new Map(data.circles.map((c) => [c.id, c])), [data.circles]);
  const circleName = (id) => (id ? shortCircle(byId.get(id)?.name ?? "Circle no longer on file") : "");
  const linked = useMemo(() => {
    const n = new Map();
    for (const s of rows ?? []) if (s.circle_id) n.set(s.circle_id, (n.get(s.circle_id) ?? 0) + 1);
    return n;
  }, [rows]);
  const circleOptions = useMemo(() => data.circles
    .filter((c) => linked.has(c.id) || MATCHABLE.includes(c.status))
    .sort((a, b) => (b.status === "live") - (a.status === "live") || a.name.localeCompare(b.name)), [data.circles, linked]);

  if (!rows) return <section className="card"><p className="muted">Loading attendees…</p></section>;
  const toMatch = rows.filter(waiting);
  const shown = filterSignups(rows.filter((s) => s.match_method !== "none" || circle === "none"), { q, circle });
  const VIEWS = [["list", "Attendees", 0], ["match", "Needs matching", toMatch.length]];
  const current = circle !== "all" && circle !== "none" ? byId.get(circle) : null;

  return (
    <>
      <div className="seg tr-views" role="tablist" aria-label="Attendees view">
        {VIEWS.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "active" : ""} onClick={() => setView(k)}>
            {label}{n > 0 && <span className="count">{n}</span>}
          </button>
        ))}
      </div>
      {err && <p className="hint warn">{err}</p>}
      {view === "list" && (
        <section className="card at-page">
          <div className="card-head">
            <h2>Attendees <span className="muted">({shown.length})</span></h2>
            <div className="filters">
              <input type="search" placeholder="Search name, email, phone, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />
              <select value={circle} onChange={(e) => setCircle(e.target.value)} aria-label="Circle">
                <option value="all">All circles</option>
                <option value="none">Not linked to a circle</option>
                {circleOptions.map((c) => <option key={c.id} value={c.id}>{shortCircle(c.name)} ({linked.get(c.id) ?? 0})</option>)}
              </select>
              <button type="button" disabled={!shown.length} onClick={() => downloadCsv(shown, `attendees${current ? `-${shortCircle(current.name).slice(0, 40)}` : ""}.csv`, circleName)}>Download CSV</button>
            </div>
          </div>
          <p className="card-sub muted small">
            Everyone who signed up on the circle sign-up form. New sign-ups arrive from Tally straight away and are linked by the circle id in
            the sign-up link. Older ones are matched on the facilitator, language, date and WhatsApp group in their link.
          </p>
          {current && (
            <div className="at-circle-bar">
              <button type="button" className="link" onClick={() => onSelect?.(current)}>Open {shortCircle(current.name)}</button>
              <span className="muted small">{STATUS_LABEL[current.status]}</span>
              <CopyButton label="Copy sign-up link" text={signupLink(current)} />
            </div>
          )}
          <div className="at-list" role="table" aria-label="Attendees">
            <div className="at-row at-head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">WhatsApp</span>
              <span role="columnheader">Circle</span>
              <span role="columnheader">Signed up</span>
            </div>
            {shown.map((s) => (
              <div key={s.id} className="at-item">
                <div className="at-row" role="row" tabIndex={0} aria-expanded={openId === s.id}
                  onClick={() => setOpenId(openId === s.id ? null : s.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(openId === s.id ? null : s.id)}>
                  <span role="cell"><b>{personName(s)}</b>{s.city && <span className="muted small"> · {s.city}</span>}</span>
                  <span role="cell" className="small at-ellipsis">{s.email}</span>
                  <span role="cell" className="small">{s.phone}</span>
                  <span role="cell" className="small at-ellipsis" title={s.circle_id ? METHOD[s.match_method] : s.match_note ?? ""}>
                    {s.circle_id ? circleName(s.circle_id) : <span className="muted">{s.match_method === "none" ? "No circle" : "Needs matching"}</span>}
                  </span>
                  <span role="cell" className="small muted">{fmtDay(s.submitted_at)}</span>
                </div>
                {openId === s.id && (
                  <div className="at-open">
                    <SignupDetail s={s} admin />
                    <p className="muted small">
                      {s.circle_id ? `${METHOD[s.match_method] ?? "Linked"}${s.match_note && s.match_method !== "manual" ? ` (${s.match_note})` : ""}.` : ""}
                      {" "}<button type="button" className="link small" onClick={() => { setChangeId(s.id); setView("match"); }}>Change circle</button>
                    </p>
                  </div>
                )}
              </div>
            ))}
            {!shown.length && <p className="muted at-empty">{rows.length ? "No attendees match these filters." : "No sign-ups yet. Import them from Tally under Setup, Settings."}</p>}
          </div>
        </section>
      )}
      {view === "match" && (
        <MatchList rows={rows} focus={changeId} circles={circleOptions} circleName={circleName} run={run} onDone={reload} />
      )}
    </>
  );
}

// Older sign-ups (no circle id in their link) that couldn't be placed for sure: likely circles first, then any circle.
function MatchList({ rows, focus, circles, circleName, run, onDone }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = rows.filter((s) => waiting(s) || (s.id === focus));
  const shown = all ? list : list.slice(0, 50);

  async function pick(s, circleId) {
    await run(async () => {
      const patch = circleId ? { circle_id: circleId } : { circle_id: null, match_method: "none" };
      const { error } = await supabase.from("circle_signups").update(patch).eq("id", s.id);
      if (error) throw error;
    }, circleId ? `${personName(s)} linked to ${circleName(circleId)}` : `${personName(s)} marked as not for a circle`);
    onDone();
  }
  async function recheck() {
    setBusy(true);
    await run(() => signupsAction("rematch"), (o) => `Checked ${o.checked}: ${o.linked} linked, ${o.waiting} still need matching.`);
    setBusy(false);
    onDone();
  }

  return (
    <section className="card at-page">
      <div className="card-head">
        <h2>Needs matching <span className="muted">({list.length})</span></h2>
        <button type="button" disabled={busy} onClick={recheck}>{busy ? "Checking…" : "Check again"}</button>
      </div>
      <p className="card-sub muted small">
        Older sign-ups whose link had no circle id, where the details fit no circle or more than one. Pick the circle, or mark it as not
        for a circle. <b>Check again</b> retries after a circle's WhatsApp link or facilitator has been filled in. Your choices are kept.
      </p>
      <div className="at-match-list">
        {shown.map((s) => {
          const u = s.utm ?? {};
          const said = [u.utm_facilitator, u.utm_lang, u.utm_course, u.utm_date, u.circle_name, u.utm_wagrp && "WhatsApp group"].filter(Boolean);
          const likely = (s.match_candidates ?? []).filter((id) => circles.some((c) => c.id === id));
          return (
            <div key={s.id} className="at-match-row">
              <div>
                <b>{personName(s)}</b> <span className="muted small">{s.email} · {fmtDay(s.submitted_at)}</span>
                <div className="small">{said.length ? <>Link said: {said.join(" · ")}</> : <span className="muted">No link details</span>}</div>
                {s.match_note && <div className="muted small">{s.match_note}</div>}
              </div>
              <div className="at-match-actions">
                {likely.map((id) => (
                  <button key={id} type="button" className="small" onClick={() => pick(s, id)}>{circleName(id)}</button>
                ))}
                <select aria-label={`Circle for ${personName(s)}`} value={s.circle_id ?? ""} onChange={(e) => e.target.value && pick(s, e.target.value)}>
                  <option value="">{likely.length ? "Another circle…" : "Choose a circle…"}</option>
                  {circles.map((c) => <option key={c.id} value={c.id}>{shortCircle(c.name)} ({STATUS_LABEL[c.status]})</option>)}
                </select>
                <button type="button" className="ghost small" onClick={() => pick(s, null)}>Not a circle</button>
              </div>
            </div>
          );
        })}
        {!list.length && <p className="muted at-empty">Nothing to match. Every sign-up is linked to a circle.</p>}
      </div>
      {list.length > shown.length && <button type="button" className="link small" onClick={() => setAll(true)}>Show all {list.length}</button>}
    </section>
  );
}

/* ---------------- Circle panel ---------------- */

// Top of the circle panel: one button to copy the circle's sign-up link.
export function SignupLinkButton({ circle }) {
  return <CopyButton label="Copy sign-up link" text={signupLink(circle)} />;
}

// In the circle panel: how many have signed up, the sign-up link to share, and a way to see them.
export function CircleSignups({ circle, onOpen }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let live = true;
    supabase.from("circle_signups").select("id", { count: "exact", head: true }).eq("circle_id", circle.id)
      .then((r) => live && setCount(r.count ?? 0));
    return () => { live = false; };
  }, [circle.id]);
  const link = signupLink(circle);
  return (
    <div className="at-panel">
      <div className="at-panel-line">
        <span><b>{count ?? "…"}</b> {count === 1 ? "person has" : "people have"} signed up</span>
        {onOpen && <button type="button" className="link small" onClick={() => onOpen(circle.id)}>See attendees</button>}
      </div>
      <div className="at-panel-line">
        <span className="at-link small" title={link}>{link}</span>
        <CopyButton label="Copy sign-up link" text={link} />
      </div>
      <p className="muted small">Share this link so each sign-up is linked to this circle. It carries the circle's id and name.</p>
    </div>
  );
}

// In the circle panel's Zoom details: ask joiners for their name and email (Zoom registration) on this one meeting.
export function ZoomRegistration({ circle, run }) {
  const on = Boolean(circle.zoom_registration);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const msg = on
      ? `Stop asking for names and emails on "${circle.name}"?\n\nPeople join straight away again. The join link stays the same.`
      : `Ask people joining "${circle.name}" for their name and email?\n\nThe join link and WhatsApp link stay the same. The first time, everyone (facilitators too) fills in first name, last name and email, then joins straight away. They register once for the whole series and get a calendar invite. Facilitators then claim host as usual.`;
    if (!confirm(msg)) return;
    setBusy(true);
    await run(() => adminAction("zoom_registration", circle.id, { on: !on }),
      on ? "Zoom registration turned off" : "Zoom registration on: joiners give their name and email");
    setBusy(false);
  }
  return (
    <div className="at-zoomreg">
      <div>
        <b>Collect emails on Zoom</b> <span className={`pill ${on ? "st-live" : ""}`}>{on ? "On" : "Off"}</span>
        <div className="muted small">
          {on ? "Joiners register once (name and email, approved automatically). Emails show in Attendance after the next sync."
            : "Off: people join without giving an email."}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={toggle}>{busy ? "Saving…" : on ? "Turn off" : "Turn on"}</button>
    </div>
  );
}

/* ---------------- Settings ---------------- */

export function SignupsSettings({ data, run }) {
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(id); }, []);
  const s = data.settings ?? {};
  const last = s.signups_synced_at ? Date.parse(s.signups_synced_at) : null;
  const after = last ? last + SYNC_COOLDOWN_MS : 0;
  const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

  async function sync() {
    if (!confirm("Import every sign-up from the Tally circle sign-up form?\n\nSafe to run again: people already imported are updated, not doubled, and circles you picked by hand are kept.")) return;
    setSyncing(true);
    await run(() => signupsAction("sync").catch((e) => {
      const m = /^cooldown:\s*(.*)$/i.exec(e?.message ?? "");
      throw m ? new Error(`Imported recently: ${m[1]}. New sign-ups arrive automatically in the meantime.`) : e;
    }), (o) => `Imported ${o.found} sign-up${o.found === 1 ? "" : "s"}: ${o.linked} linked to a circle${o.waiting ? `, ${o.waiting} need matching` : ""}.`);
    setSyncing(false);
  }
  async function setNew(v) {
    await run(async () => {
      const { error } = await supabase.from("settings").update({ zoom_registration_new: v }).eq("id", 1);
      if (error) throw error;
    }, v ? "New Zoom meetings will ask joiners for their email" : "New Zoom meetings won't ask for an email");
  }

  return (
    <section className="card" aria-label="Circle attendees">
      <div className="card-head"><h2>Circle attendees</h2></div>
      <p className="muted small">
        Sign-ups from the Tally form "Think Gita Circles Sign Up" arrive automatically. Import once to bring in everyone who signed up
        before, then only if sign-ups were missed (for example while the webhook was off).
        {last ? ` Last import ${new Date(last).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : " Not imported yet."}
      </p>
      <div className="actions">
        {after > now
          ? <span className="muted small">Available again after {hhmm(after)}.</span>
          : <button type="button" disabled={syncing} onClick={sync}>{syncing ? "Importing…" : "Import sign-ups from Tally"}</button>}
      </div>
      <label className="check">
        <input type="checkbox" checked={Boolean(s.zoom_registration_new)} onChange={(e) => setNew(e.target.checked)} />
        Ask for name and email on new circles' Zoom meetings (registration, approved automatically)
      </label>
      <p className="muted small">Each live circle can also be switched on or off in its panel, under Zoom details.</p>
    </section>
  );
}
