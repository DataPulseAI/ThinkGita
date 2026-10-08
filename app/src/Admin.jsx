import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  supabase, adminAction, DAYS, DAY_NAMES, hhmm, toMin, endTime, STATUS_LABEL,
  ukDay, ukStart, ukWhen, localWhen, isUk, tzName, TIMEZONES, UK_TZ, fmtDate, circleMessage, REQUEST_TYPES, requestSummary,
} from "./lib.js";
import { Icon, IconButton, CopyButton, Hover } from "./ui.jsx";
import { PLACEHOLDERS, DEFAULT_TEMPLATES, buildVars, render, missingValues, unknownPlaceholders, usedPlaceholders } from "./emailTemplate.js";

const ACTIVE = ["pending", "approved", "live"];
// Top bar: a few groups, each a dropdown of pages. Page keys stay the same (onTab("Queue") etc. still work).
const NAV = [
  { label: "Overview", tabs: [["Overview", "Overview"]] },
  { label: "Queue", tabs: [["Queue", "Queue"]] },
  { label: "Circles", tabs: [["Circles", "All circles"], ["Schedule", "Weekly schedule"], ["Requests", "Change requests"]] },
  { label: "Zoom", tabs: [["Licences", "Licences"], ["Zoom", "Meetings on Zoom"], ["Attendance", "Attendance"], ["Insights", "Attendance insights"]] },
  { label: "Setup", tabs: [["Emails", "Email templates"], ["EmailLog", "Sent emails"], ["Settings", "Settings"]] },
];

function NavGroup({ group, tab, setTab, counts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const active = group.tabs.some(([k]) => k === tab);
  const total = group.tabs.reduce((t, [k]) => t + (counts[k] ?? 0), 0);
  if (group.tabs.length === 1) {
    const [k] = group.tabs[0];
    return (
      <button className={active ? "tab active" : "tab"} onClick={() => setTab(k)}>
        {group.label}{counts[k] > 0 && <span className="count">{counts[k]}</span>}
      </button>
    );
  }
  const current = group.tabs.find(([k]) => k === tab);
  return (
    <div className="nav-group" ref={ref}>
      <button className={active ? "tab active" : "tab"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {group.label}
        {active && current && <span className="nav-current">{current[1]}</span>}
        {total > 0 && <span className="count">{total}</span>}
        <span className="nav-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="nav-menu" role="menu">
          {group.tabs.map(([k, label]) => (
            <button key={k} role="menuitem" className={k === tab ? "on" : ""} onClick={() => { setTab(k); setOpen(false); }}>
              <span>{label}</span>{counts[k] > 0 && <span className="count">{counts[k]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const APP_URL = window.location.href.split("#")[0];

// Approval email values still blank for a circle (Zoom details are filled in on approval).
function emailGaps(c, data) {
  const template = data.templates.approved;
  const vars = buildVars({ circle: c, facilitator: c.facilitator, licence: data.licences.find((l) => l.id === c.licence_id), settings: data.settings, appUrl: APP_URL, sender: data.me?.name });
  return missingValues(template, vars, { beforeApproval: true });
}
// Schedule blocks are small and already placed by time: show just the host part of an automatic name.
const blockName = (name) => String(name ?? "").replace(/^Gita Circles \| /, "").replace(/ \| [A-Z][a-z]+day \d{2}:\d{2} \([^)]*\)$/, "");
const placeholderLabel = (k) => PLACEHOLDERS.find((p) => p.key === k)?.label ?? k;
// Ask before approving when the email would say "to follow" for something.
function confirmGaps(circles, data) {
  const withGaps = circles.map((c) => [c, emailGaps(c, data)]).filter(([, g]) => g.length);
  if (!withGaps.length) return true;
  if (circles.length === 1) {
    return confirm(`The approval email has nothing set for: ${withGaps[0][1].map(placeholderLabel).join(", ")}.\n\nThose lines will say "to follow". Approve anyway?`);
  }
  return confirm(`${withGaps.length} of these circles have blanks in their approval email (e.g. ${withGaps[0][0].name}: ${withGaps[0][1].map(placeholderLabel).join(", ")}).\n\nThose lines will say "to follow". Approve them all anyway?`);
}

// "Wed 19:30–20:30" plus local time when the facilitator isn't in the UK.
function When({ c, block }) {
  return (
    <span className={block ? "when stacked" : "when"}>
      <span className="nowrap">{ukWhen(c)} <span className="muted small">UK</span></span>
      {!isUk(c) && <span className="local small nowrap">{localWhen(c)}</span>}
    </span>
  );
}

// Turn database errors into plain English.
function friendlyError(e) {
  const m = e?.message ?? String(e);
  if (/no_licence_clash/.test(m)) return "That licence is already booked at this time. Pick another time or licence.";
  if (/term_order/.test(m)) return "The term end date must be after the term start date.";
  return m;
}

// Pages live in the URL (#/Attendance, #/Attendance/<meeting>), so the browser's back and forward
// buttons and the in-app Back button work. Sign-in links use the hash too; those are left alone.
const PAGE_KEYS = NAV.flatMap((g) => g.tabs.map(([k]) => k));
function readRoute() {
  const m = location.hash.match(/^#\/([A-Za-z]+)(?:\/(.+))?$/);
  return m && PAGE_KEYS.includes(m[1]) ? { tab: m[1], sub: m[2] ? decodeURIComponent(m[2]) : null } : { tab: "Overview", sub: null };
}

// One line about the facilitator email for the message after an action ("Email sent to ...").
function emailNote(result, to) {
  if (!result || /^not needed/.test(result)) return "";
  if (result === "sent") return ` Email sent${to ? ` to ${to}` : ""}.`;
  if (/^skipped/.test(result)) return ` Email not sent: ${result.replace(/^skipped \(|\)$/g, "")}.`;
  return ` Email failed: ${result.replace(/^failed: /, "")}. See Setup, Sent emails.`;
}
const emailFailed = (result) => Boolean(result) && result !== "sent" && !/^not needed/.test(result);
// Build a toast from an action result that may include an email outcome.
const withEmail = (text, result, to) => ({ text: `${text}${emailNote(result, to)}`, warn: emailFailed(result) });
const INVITE_NOTE = { invited: " Sign-in invite sent.", "already has an account": " They already have a sign-in." };

// Today's date in the UK (not UTC), as YYYY-MM-DD.
function ukToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); }
// Date and time in UK time, e.g. "Wed 7 Oct 2026, 21:44".
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const ukDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const REQUEST_STATUS = { open: "Open", done: "Done", dismissed: "Closed", closed: "Closed" };

export default function Admin() {
  const [route, setRoute] = useState(readRoute);
  // How many in-app pages back we can go (kept in history.state, so forward/back keep it right).
  const [depth, setDepth] = useState(() => history.state?.tgIdx ?? 0);
  const { tab, sub } = route;
  const go = useCallback((t, s = null, { replace = false } = {}) => {
    const hash = `#/${t}${s ? `/${encodeURIComponent(s)}` : ""}`;
    if (hash === location.hash) return;
    const idx = history.state?.tgIdx ?? 0;
    if (replace) history.replaceState({ tgIdx: idx }, "", hash);
    else { history.pushState({ tgIdx: idx + 1 }, "", hash); setDepth(idx + 1); }
    setRoute({ tab: t, sub: s });
    window.scrollTo(0, 0);
  }, []);
  const setTab = useCallback((t) => go(t), [go]);
  useEffect(() => {
    const onPop = () => { setRoute(readRoute()); setDepth(history.state?.tgIdx ?? 0); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [attFocus, setAttFocus] = useState(null); // Zoom meeting ID to open in Attendance
  const [day, setDay] = useState(() => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" })).getDay(); return d === 0 ? 7 : d; });
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
    const [circles, licences, settings, requests, log, templates, admins, failed] = await Promise.all([
      fetchAll(() => supabase.from("circles").select("*, facilitator:facilitators(*), licence:licences(label,is_mock,host_key)").order("ref_weekday").order("ref_start_time").order("id")),
      supabase.from("licences").select("*").order("sort_order").order("label"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      fetchAll(() => supabase.from("change_requests").select("*, circle:circles(name)").order("created_at", { ascending: false }).order("id")),
      supabase.from("audit_log").select("*").not("action", "in", "(zoom_meetings_snapshot,sync_attendance)").order("at", { ascending: false }).limit(60),
      supabase.from("email_templates").select("*"),
      supabase.from("admin_emails").select("*").order("email"),
      supabase.from("email_log").select("id", { count: "exact", head: true }).eq("status", "failed").gte("sent_at", weekAgo),
    ]);
    const err = [circles, licences, settings, requests, log, templates, admins].find((r) => r.error);
    if (err) setToast({ kind: "error", text: err.error.message });
    setData({
      circles: circles.data ?? [],
      licences: licences.data ?? [],
      settings: settings.data,
      requests: requests.data ?? [],
      log: log.data ?? [],
      emailFailures: failed.count ?? 0,
      admins: admins.data ?? [],
      me: (admins.data ?? []).find((a) => a.email === user?.email?.toLowerCase()) ?? { email: user?.email },
      templates: {
        approved: templates.data?.find((t) => t.key === "approved") ?? { key: "approved", ...DEFAULT_TEMPLATES.approved },
        updated: templates.data?.find((t) => t.key === "updated") ?? { key: "updated", ...DEFAULT_TEMPLATES.updated },
      },
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const notify = (kind, text) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), kind === "ok" ? 6000 : 12000);
  };

  // Wraps an async action with refresh + toast.
  const run = async (fn, okText) => {
    try {
      const out = await fn();
      if (okText) {
        const msg = typeof okText === "function" ? okText(out) : okText;
        // A message can flag an email problem: { text, warn: true } shows as a warning that stays longer.
        if (msg && typeof msg === "object") notify(msg.warn ? "warn" : "ok", msg.text);
        else notify("ok", msg);
      }
      await load();
      return out ?? true;
    } catch (e) {
      notify("error", friendlyError(e));
      await load();
      return null;
    }
  };

  const deleteCircle = (c, after) => {
    if (c.status === "live") return notify("error", "End the circle first. That deletes its Zoom meeting.");
    if (!confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    run(async () => {
      const { error } = await supabase.from("circles").delete().eq("id", c.id);
      if (error) throw error;
    }, "Circle deleted").then(() => after?.());
  };

  if (!data) return <div className="center muted">Loading data…</div>;
  const openRequests = data.requests.filter((r) => r.status === "open").length;
  const queueCount = data.circles.filter((c) => c.status === "pending" || c.status === "conflict").length;
  const select = (c) => setSelected(c);

  return (
    <div className="admin">
      <nav className="tabs">
        <button className="tab nav-back" disabled={!depth} onClick={() => history.back()} aria-label="Back" title="Back">←</button>
        {NAV.map((g) => (
          <NavGroup key={g.label} group={g} tab={tab} setTab={setTab} counts={{ Queue: queueCount, Requests: openRequests }} />
        ))}
      </nav>
      <main className="content">
        {tab === "Overview" && <Overview data={data} onDay={(d) => { setDay(d); setTab("Schedule"); }} onTab={setTab} go={go} />}
        {tab === "Schedule" && <Schedule data={data} day={day} setDay={setDay} onSelect={select} />}
        {tab === "Queue" && <Queue data={data} run={run} onSelect={select} />}
        {tab === "Circles" && <Circles key={sub ?? ""} initial={sub} data={data} onSelect={select} onNew={() => setSelected("new")} onDelete={deleteCircle} />}
        {tab === "Licences" && <Licences data={data} run={run} notify={notify} go={go} />}
        {tab === "Requests" && <Requests data={data} run={run} onSelect={(id) => select(data.circles.find((c) => c.id === id))} />}
        {tab === "Zoom" && <ZoomMeetings key={sub ?? ""} initialAccount={sub} data={data} run={run} onSelect={select}
          onAttendance={(id) => { setAttFocus(String(id)); setTab("Attendance"); }} />}
        {tab === "Attendance" && <Attendance data={data} run={run} focus={attFocus} onFocused={() => setAttFocus(null)} onSelect={select}
          open={sub} setOpen={(k, opts) => go("Attendance", k, opts)} />}
        {tab === "Insights" && <Insights data={data} openMeeting={(k) => go("Attendance", k)} onSelect={select} />}
        {tab === "Emails" && <Emails data={data} run={run} />}
        {tab === "EmailLog" && <EmailLog key={sub ?? ""} data={data} run={run} onSelect={select} initial={sub} />}
        {tab === "Settings" && <Settings data={data} run={run} />}
      </main>
      {selected && (
        <CircleDrawer
          key={selected === "new" ? "new" : selected.id}
          onAttendance={(id) => { setSelected(null); go("Attendance", id); }}
          onRequests={() => { setSelected(null); go("Requests"); }}
          onEmails={(name) => { setSelected(null); go("EmailLog", name); }}
          circle={selected === "new" ? null : data.circles.find((c) => c.id === selected.id) ?? selected}
          data={data}
          run={run}
          onDelete={deleteCircle}
          onOpen={(c) => setSelected(c)}
          onClose={() => setSelected(null)}
        />
      )}
      <div aria-live="polite" role="status">
        {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
      </div>
    </div>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ data, onDay, onTab, go }) {
  const { circles, licences, requests } = data;
  const count = (s) => circles.filter((c) => c.status === s).length;
  const active = licences.filter((l) => l.active);
  const missingZoom = active.filter((l) => !l.zoom_user_email && !l.is_mock).length;
  const matrix = active.map((l) => ({
    l,
    days: [1, 2, 3, 4, 5, 6, 7].map((d) => circles.filter((c) => c.licence_id === l.id && ukDay(c) === d && ACTIVE.includes(c.status)).length),
  }));
  const max = Math.max(1, ...matrix.flatMap((r) => r.days));
  const demo = circles.some((c) => c.is_demo);
  const mocks = active.filter((l) => l.is_mock);

  return (
    <>
      {demo && <div className="banner">Demo data is loaded (circles named "Demo Circle"). Clear it from Settings before going live.</div>}
      {mocks.length > 0 && (
        <div className="banner">
          Testing mode: {mocks.map((l) => l.label).join(", ")} {mocks.length === 1 ? "is a mock licence" : "are mock licences"}. Approving circles on {mocks.length === 1 ? "it" : "them"} creates fake Zoom links. Turn this off in Licences before going live.
        </div>
      )}
      <div className="stats">
        <Stat label="Live circles" value={count("live")} onClick={() => (go ? go("Circles", "live") : onTab("Circles"))} />
        <Stat label="Awaiting approval" value={count("pending")} onClick={() => onTab("Queue")} />
        <Stat label="Clashes to resolve" value={count("conflict")} tone={count("conflict") ? "warn" : ""} onClick={() => onTab("Queue")} />
        <Stat label="Open change requests" value={requests.filter((r) => r.status === "open").length} onClick={() => onTab("Requests")} />
        <Stat label="Licences without Zoom user" value={missingZoom} tone={missingZoom ? "warn" : ""} onClick={() => onTab("Licences")} />
      </div>

      {data.emailFailures > 0 && (
        <div className="banner">
          {data.emailFailures} email{data.emailFailures > 1 ? "s" : ""} failed to send in the last 7 days.{" "}
          <button className="link" onClick={() => (go ? go("EmailLog", "failed") : onTab("EmailLog"))}>See which</button>
        </div>
      )}
      <SetupChecklist data={data} onTab={onTab} />

      <section className="card">
        <div className="card-head">
          <h2>Week at a glance</h2>
          <span className="muted">Circles per licence per day, in UK time. Click a day to see the timeline.</span>
        </div>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th></th>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <th key={d}><button className="link" onClick={() => onDay(d)}>{DAYS[d]}</button></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map(({ l, days }) => (
                <tr key={l.id}>
                  <th className="rowhead">{l.label} {l.is_mock && <span className="tag">mock</span>}</th>
                  {days.map((n, i) => (
                    <td key={i} onClick={() => onDay(i + 1)} style={{ "--a": n / max }} className={n ? "filled" : ""}>{n || ""}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th className="rowhead warn-text">No licence</th>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const n = circles.filter((c) => c.status === "conflict" && ukDay(c) === d).length;
                  return <td key={d} className={n ? "conflict-cell" : ""} onClick={() => onDay(d)}>{n || ""}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// "Before going live" checklist. Hidden once everything is done.
function SetupChecklist({ data, onTab }) {
  const { licences, circles, settings } = data;
  const active = licences.filter((l) => l.active);
  const real = active.filter((l) => !l.is_mock);
  const connected = real.filter((l) => l.zoom_user_email && l.host_key).length;
  const items = [
    {
      done: real.length > 0 && connected === real.length,
      what: `Connect Zoom licences (${connected} of ${real.length} have a Zoom user and host key)`,
      how: "Zoom, Licences: Sync from Zoom, then Set key on each licence that will host circles.",
      tab: "Licences",
    },
    {
      done: !active.some((l) => l.is_mock),
      what: "Turn off mock licences",
      how: "Mock licences create fake Zoom links. Untick Mock under Zoom, Licences before going live.",
      tab: "Licences",
    },
    {
      done: Boolean(settings.term_start && settings.term_end),
      what: "Set the term dates",
      how: "Setup, Settings: meetings repeat weekly between these dates.",
      tab: "Settings",
    },
    {
      done: !circles.some((c) => c.is_demo),
      what: "Clear the demo data",
      how: "Setup, Settings: Clear demo data.",
      tab: "Settings",
    },
  ];
  const left = items.filter((i) => !i.done).length;
  if (!left) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Before going live</h2>
        <span className="muted small">{items.length - left} of {items.length} done</span>
      </div>
      <ul className="checklist">
        {items.map((i) => (
          <li key={i.what} className={i.done ? "done" : ""}>
            <span className="tick">{i.done ? "✓" : ""}</span>
            <span>
              <span className="what">{i.what}</span>
              {!i.done && <span className="how">{i.how} <button className="link small" onClick={() => onTab(i.tab)}>Go to {i.tab}</button></span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, tone, onClick }) {
  return (
    <button className={`stat ${tone ?? ""}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}

/* ---------------- Schedule (day timeline, UK time) ---------------- */
function Schedule({ data, day, setDay, onSelect }) {
  const { circles, licences, settings } = data;
  const todays = circles.filter((c) => ukDay(c) === day && (ACTIVE.includes(c.status) || c.status === "conflict"));
  // Always show the whole day (00:00 to 24:00) fitted to the screen.
  const startH = 0;
  const endH = 24;
  const clashes = todays.filter((c) => c.status === "conflict").length;
  const span = (endH - startH) * 60;
  const pos = (min) => `${((min - startH * 60) / span) * 100}%`;
  const lanes = [
    ...licences.filter((l) => l.active).map((l) => ({ key: l.id, label: l.label, mock: l.is_mock, items: todays.filter((c) => c.licence_id === l.id) })),
    { key: "none", label: "No licence", items: todays.filter((c) => c.status === "conflict"), warn: true },
  ];

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          {DAY_NAMES[day]} <span className="muted small">UK time</span>
          <span className="day-count">{todays.length} circle{todays.length === 1 ? "" : "s"}{clashes ? `, ${clashes} clash${clashes === 1 ? "" : "es"}` : ""}</span>
        </h2>
        <div className="seg">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} className={d === day ? "on" : ""} onClick={() => setDay(d)}>{DAYS[d]}</button>
          ))}
        </div>
      </div>
      <p className="muted small">Whole day, 00:00 to 24:00. Shaded tail = {settings.buffer_minutes}-minute buffer before the licence can be reused. Hover a circle for details, click to open it.</p>
      {!todays.length && <p className="muted">No circles on {DAY_NAMES[day]}. Pick another day above, or add one from Circles.</p>}
      <div className="timeline">
        <div className="lane hours-row">
          <div className="lane-label" />
          <div className="lane-track hours">
            {Array.from({ length: endH - startH }, (_, i) => (
              <span key={i} className={(startH + i) % 3 ? "minor" : ""} style={{ left: pos((startH + i) * 60) }}>{String(startH + i).padStart(2, "0")}</span>
            ))}
          </div>
        </div>
        {lanes.map((lane) => (
          <div key={lane.key} className={`lane ${lane.warn ? "lane-warn" : ""}`}>
            <div className="lane-label">{lane.label}{lane.mock && <span className="tag">mock</span>}</div>
            <div className="lane-track" style={lane.warn ? { height: Math.max(1, lane.items.length) * 30 + 8 } : undefined}>
              {Array.from({ length: endH - startH }, (_, i) => (
                <i key={i} className={`gridline ${(startH + i) % 3 ? "" : "major"}`} style={{ left: pos((startH + i) * 60) }} />
              ))}
              {lane.items.map((c, idx) => {
                const s = toMin(ukStart(c));
                const top = lane.warn ? 4 + idx * 30 : 4;
                return (
                  <Hover key={c.id} content={<CircleHoverCard c={c} />}>
                    <button
                      className={`block st-${c.status}`}
                      style={{ left: pos(s), width: `calc(${pos(Math.min(s + c.duration_min, endH * 60))} - ${pos(s)})`, top, height: lane.warn ? 26 : undefined }}
                      onClick={() => onSelect(c)}
                      aria-label={`${c.name}, ${ukWhen(c)} UK, ${STATUS_LABEL[c.status]}`}
                    >
                      <span className="b-name">{blockName(c.name)}</span>
                      <span className="b-time">{hhmm(ukStart(c))}–{endTime(ukStart(c), c.duration_min)}</span>
                      {!lane.warn && (
                        <em className="buffer" style={{ width: `${(settings.buffer_minutes / c.duration_min) * 100}%`, right: `-${(settings.buffer_minutes / c.duration_min) * 100}%` }} />
                      )}
                    </button>
                  </Hover>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        {["pending", "live", "conflict"].map((s) => (
          <span key={s}><i className={`swatch st-${s}`} /> {STATUS_LABEL[s]}</span>
        ))}
      </div>
    </section>
  );
}

// Content of the schedule hover card.
function CircleHoverCard({ c }) {
  const rows = [
    ["UK time", ukWhen(c)],
    !isUk(c) && ["Their time", localWhen(c)],
    ["Facilitator", c.facilitator?.name ?? "None"],
    ["Licence", c.licence ? `${c.licence.label}${c.licence.is_mock ? " (mock)" : ""}` : "Not assigned"],
    (c.circle_type || c.language) && ["Circle", [c.circle_type, c.language].filter(Boolean).join(" · ")],
    c.preference_used === 2 && ["Preference", "Moved to 2nd choice"],
  ].filter(Boolean);
  return (
    <>
      <div className="hc-title">{c.name}</div>
      <div className="hc-sub"><span className={`pill st-${c.status}`}>{STATUS_LABEL[c.status]}</span></div>
      <dl className="hc-rows">
        {rows.flatMap(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v}</dd>])}
      </dl>
      {c.status === "conflict" && <div className="hc-foot warn-text">{c.conflict_reason}</div>}
      <div className="hc-foot">{c.status === "pending" ? "Click to review and approve" : "Click to open"}</div>
    </>
  );
}

/* ---------------- Queue ---------------- */
function Queue({ data, run, onSelect }) {
  const [approving, setApproving] = useState(null);
  const clashes = data.circles.filter((c) => c.status === "conflict").length;
  const [dialog, setDialog] = useState(null);
  const approveOne = (c) => setDialog(c);
  const items = data.circles
    .filter((c) => c.status === "pending" || c.status === "conflict")
    .sort((a, b) => (a.status === "conflict" ? -1 : 0) - (b.status === "conflict" ? -1 : 0) || ukDay(a) - ukDay(b) || ukStart(a).localeCompare(ukStart(b)));
  const [suggestions, setSuggestions] = useState({});
  const [bulk, setBulk] = useState(null);
  const ready = items.filter((c) => c.status === "pending" && c.licence_id && !c.is_demo);

  async function suggest(c) {
    const { data: rows, error } = await supabase.rpc("suggest_slots", { p_circle: c.id });
    setSuggestions((s) => ({ ...s, [c.id]: error ? { error: error.message } : rows }));
  }

  async function moveTo(c, start) {
    await run(async () => {
      const { error } = await supabase.from("circles").update({ start_time: start }).eq("id", c.id);
      if (error) throw error;
      const { data: out, error: e2 } = await supabase.rpc("allocate_circle", { p_circle: c.id });
      if (e2) throw e2;
      return out;
    }, (out) => `${c.name} moved to ${hhmm(start)} (their time): ${STATUS_LABEL[out.status]}`);
    setSuggestions((s) => ({ ...s, [c.id]: undefined }));
  }

  async function provisionAll() {
    if (!confirm(`Create Zoom meetings for ${ready.length} circles and email their facilitators?`)) return;
    if (!confirmGaps(ready, data)) return;
    const results = [];
    for (let i = 0; i < ready.length; i++) {
      setBulk({ done: i, total: ready.length });
      try {
        const o = await adminAction("provision", ready[i].id);
        results.push({ ok: true, name: ready[i].name, email: o?.email });
      } catch (e) {
        results.push({ ok: false, name: ready[i].name, error: e.message });
      }
    }
    setBulk(null);
    const failed = results.filter((r) => !r.ok);
    const ok = results.filter((r) => r.ok);
    const sent = ok.filter((r) => r.email === "sent").length;
    await run(async () => {
      if (failed.length) throw new Error(`${failed.length} failed. First error (${failed[0].name}): ${failed[0].error}`);
    }, { text: `${ok.length} circles approved. Emails sent: ${sent} of ${ok.length}.${sent < ok.length ? " See Setup, Sent emails for the others." : ""}`, warn: sent < ok.length });
  }

  return (
    <section className="card">
      {dialog && <ApproveDialog circle={dialog} data={data} run={run} onBusy={(b) => setApproving(b ? dialog.id : null)} onClose={() => setDialog(null)} />}
      <div className="card-head">
        <h2>Queue</h2>
        <div className="filters">
        {clashes > 0 && (
          <button onClick={() => run(async () => {
            const { data: n, error } = await supabase.rpc("recheck_conflicts");
            if (error) throw error;
            return n;
          }, (n) => n === true || !n ? "Re-checked: no licence has freed up yet" : `Re-checked: ${n} clash${n === 1 ? "" : "es"} now have a licence`)}>
            Re-check all clashes ({clashes})
          </button>
        )}
        <button className="primary" disabled={!ready.length || bulk} onClick={provisionAll}>
          {bulk ? `Creating ${bulk.done + 1} of ${bulk.total}…` : `Approve all ready (${ready.length})`}
        </button>
        </div>
      </div>
      {!items.length && <p className="muted">Nothing waiting. New Tally submissions appear here.</p>}
      <div className="list">
        {items.map((c) => (
          <div key={c.id} className={`row ${c.status === "conflict" ? "row-warn" : ""}`}>
            <div className="row-main" role="button" tabIndex={0} onClick={() => onSelect(c)} onKeyDown={(e) => e.key === "Enter" && onSelect(c)}>
              <div className="row-title">
                {c.name}
                {c.is_demo && <span className="tag">demo</span>}
                {c.preference_used === 2 && <span className="tag info">2nd preference</span>}
              </div>
              <div className="small"><When c={c} /> · {c.facilitator?.name ?? "No facilitator"}</div>
              <div className="small">
                {c.status === "conflict"
                  ? <span className="warn-text">{c.conflict_reason}</span>
                  : <>Assigned to <b>{c.licence?.label}</b>{c.licence?.is_mock && <span className="tag">mock</span>}</>}
              </div>
              {suggestions[c.id] && (
                <div className="suggest" onClick={(e) => e.stopPropagation()}>
                  {suggestions[c.id].error && <span className="error">{suggestions[c.id].error}</span>}
                  {Array.isArray(suggestions[c.id]) && !suggestions[c.id].length && <span className="muted">No free time within 3 hours that day.</span>}
                  {Array.isArray(suggestions[c.id]) && suggestions[c.id].length > 0 && <span className="muted small">Free times (their time):</span>}
                  {Array.isArray(suggestions[c.id]) && suggestions[c.id].map((s) => (
                    <button key={s.start_time} className="chip" onClick={() => moveTo(c, s.start_time)}>
                      {hhmm(s.start_time)} · {s.licence_label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="row-actions">
              {c.status === "pending" && (
                <button className="primary" disabled={approving === c.id} onClick={() => approveOne(c)}>
                  {approving === c.id ? "Creating…" : "Approve + create Zoom"}
                </button>
              )}
              {c.status === "conflict" && (
                <>
                  <button onClick={() => suggest(c)}>Suggest times</button>
                  <button onClick={() => run(async () => {
                    const { data: out, error } = await supabase.rpc("allocate_circle", { p_circle: c.id });
                    if (error) throw error;
                    return out;
                  }, (o) => `Re-checked: ${STATUS_LABEL[o.status]}`)}>Re-check</button>
                </>
              )}
              <IconButton icon="edit" label="Edit circle" onClick={() => onSelect(c)} />
              <button className="ghost danger" onClick={() => confirm(`Reject ${c.name}?`) && run(async () => {
                const { error } = await supabase.from("circles").update({ status: "rejected", licence_id: null }).eq("id", c.id);
                if (error) throw error;
              }, "Rejected")}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Circles ---------------- */
// Circle list filters. Kept to the handful of views people actually need.
const FILTERS = {
  active: { label: "Current (not ended)", match: (s) => ["pending", "conflict", "approved", "live", "paused"].includes(s) },
  action: { label: "Needs action", match: (s) => s === "pending" || s === "conflict" },
  live: { label: "Live", match: (s) => s === "live" },
  closed: { label: "Ended or rejected", match: (s) => s === "ended" || s === "rejected" },
  all: { label: "All circles", match: () => true },
};
function Circles({ data, onSelect, onNew, onDelete, initial }) {
  // Opened from another page: "#/Circles/live" picks a filter, anything else is a search ("#/Circles/Zoom 05").
  const [q, setQ] = useState(initial && !FILTERS[initial] ? initial : "");
  const [status, setStatus] = useState(initial && FILTERS[initial] ? initial : (initial ? "all" : "active"));
  const rows = useMemo(() => data.circles.filter((c) => {
    if (!FILTERS[status].match(c.status)) return false;
    const hay = `${c.name} ${c.facilitator?.name ?? ""} ${c.facilitator?.email ?? ""} ${c.licence?.label ?? ""} ${c.language ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [data.circles, q, status]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Circles <span className="muted">({rows.length})</span></h2>
        <div className="filters">
          <input placeholder="Search name, facilitator, licence, language" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
            {Object.entries(FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
          <button className="primary" onClick={onNew}>Add circle</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Circle</th><th>Facilitator</th><th>When</th><th>Licence</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => onSelect(c)}>
                <td>
                  {c.name}
                  <div className="muted small">{[c.circle_type, c.language].filter(Boolean).join(" · ")}</div>
                </td>
                <td>{c.facilitator?.name}<div className="muted small">{c.facilitator?.email}</div></td>
                <td><When c={c} block /></td>
                <td>{c.licence?.label ?? <span className="muted">none</span>}{c.licence?.is_mock && <span className="tag">mock</span>}</td>
                <td><span className={`pill st-${c.status}`}>{STATUS_LABEL[c.status]}</span></td>
                <td className="cell-actions">
                  <IconButton icon="edit" label="Edit circle" onClick={() => onSelect(c)} />
                  <IconButton icon="trash" label="Delete circle" danger onClick={() => onDelete(c)}
                    title={c.status === "live" ? "End the circle before deleting" : "Delete circle"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Circle drawer ---------------- */
// Facilitator details saved from the circle panel. A hand-edited name replaces the form's name parts,
// so the automatic circle name uses exactly what the admin typed.
function facilitatorPatch(fac, form, email) {
  const patch = { phone: form.phone || null };
  const typed = (form.facilitator_name || "").trim();
  if (typed && typed !== (fac?.name ?? "")) Object.assign(patch, { name: typed, first_name: null, last_name: null, initiated_name: null });
  else if (!fac?.name) patch.name = typed || email;
  return patch;
}

function CircleDrawer({ circle, data, run, onClose, onDelete, onOpen, onAttendance, onRequests, onEmails }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const isNew = !circle;
  const live = circle?.status === "live";
  const editable = isNew || circle.status !== "ended";
  const [f, setF] = useState(() => ({
    name: circle?.name ?? "",
    name_auto: circle?.name_auto ?? true,
    facilitator_name: circle?.facilitator?.name ?? "",
    facilitator_email: circle?.facilitator?.email ?? "",
    phone: circle?.facilitator?.phone ?? "",
    weekday: circle?.weekday ?? 1,
    start_time: hhmm(circle?.start_time) || "19:00",
    alt_weekday: circle?.alt_weekday ?? "",
    alt_start_time: hhmm(circle?.alt_start_time),
    duration_min: circle?.duration_min ?? data.settings.default_duration_min,
    timezone: circle?.timezone ?? data.settings.default_timezone ?? UK_TZ,
    preferred_start: circle?.preferred_start ?? "",
    circle_type: circle?.circle_type ?? "",
    language: circle?.language ?? "",
    licence_id: circle?.licence_id ?? "auto",
    notes: circle?.notes ?? "",
    whatsapp_group_link: circle?.whatsapp_group_link ?? "",
    participant_signup_link: circle?.participant_signup_link ?? "",
    youtube_playlist_link: circle?.youtube_playlist_link ?? "",
    drive_folder_link: circle?.drive_folder_link ?? "",
  }));
  const linkFields = () => ({
    whatsapp_group_link: f.whatsapp_group_link.trim() || null,
    participant_signup_link: f.participant_signup_link.trim() || null,
    youtube_playlist_link: f.youtube_playlist_link.trim() || null,
    drive_folder_link: f.drive_folder_link.trim() || null,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tzOptions = TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES];

  // Same facilitator: update their details. Different email: link to that person (existing details untouched)
  // or create them if new.
  async function linkFacilitator(c, form) {
    const email = form.facilitator_email.trim().toLowerCase();
    if (!email) return c?.facilitator_id ?? null;
    if (c?.facilitator && c.facilitator.email === email) {
      const { error } = await supabase.from("facilitators").update(facilitatorPatch(c.facilitator, form, email)).eq("id", c.facilitator_id);
      if (error) throw error;
      return c.facilitator_id;
    }
    const { data: existing } = await supabase.from("facilitators").select("id").eq("email", email).maybeSingle();
    if (existing) return existing.id;
    const { data: created, error } = await supabase.from("facilitators")
      .insert({ email, name: form.facilitator_name || email, phone: form.phone || null }).select("id").single();
    if (error) throw error;
    return created.id;
  }

  // Live circles: details save directly; a new facilitator goes through handover (invite + email);
  // day/time/length/timezone changes move the existing Zoom meeting, so the link stays the same.
  async function saveLive() {
    const ok = await run(async () => {
      const id = circle.id;
      const done = [];
      const patch = {};
      if (Number(f.weekday) !== circle.weekday) patch.weekday = Number(f.weekday);
      if (f.start_time !== hhmm(circle.start_time)) patch.start_time = f.start_time;
      if (Number(f.duration_min) !== circle.duration_min) patch.duration_min = Number(f.duration_min);
      if (f.timezone !== circle.timezone) patch.timezone = f.timezone;
      if ((f.preferred_start || null) !== (circle.preferred_start || null)) patch.preferred_start = f.preferred_start || null;
      const emails = [];
      if (Object.keys(patch).length) {
        const r = await adminAction("reschedule", id, { patch });
        done.push("Zoom meeting moved, same link");
        if (r?.email) emails.push(r.email);
      }

      const newEmail = f.facilitator_email.trim().toLowerCase();
      if (newEmail && newEmail !== circle.facilitator?.email) {
        const r = await adminAction("handover", id, { facilitator: { name: f.facilitator_name, email: newEmail } });
        done.push(`handed over to ${newEmail}`);
        if (r?.email) emails.push(r.email);
      } else if (circle.facilitator_id) {
        const { error: e2 } = await supabase.from("facilitators")
          .update(facilitatorPatch(circle.facilitator, f, newEmail)).eq("id", circle.facilitator_id);
        if (e2) throw e2;
      }

      const hasAlt = f.alt_weekday && f.alt_start_time;
      const { data: saved, error } = await supabase.from("circles").update({
        name: f.name_auto ? circle.name : f.name, name_auto: f.name_auto,
        circle_type: f.circle_type || null, language: f.language || null, notes: f.notes || null,
        alt_weekday: hasAlt ? Number(f.alt_weekday) : null, alt_start_time: hasAlt ? f.alt_start_time : null,
        ...linkFields(),
      }).eq("id", id).select("name").single();
      if (error) throw error;
      // The Zoom meeting title follows the circle name.
      if (saved.name !== circle.name) {
        await adminAction("rename", id);
        done.push("Zoom title updated");
      }
      return { done, email: emails.find(emailFailed) ?? emails[0] };
    }, (o) => withEmail(`Saved${o?.done?.length ? `: ${o.done.join(", ")}` : ""}.`, o?.email, f.facilitator_email.trim().toLowerCase() || circle.facilitator?.email));
    if (ok) onClose();
  }

  // One save at a time: a double click must not move the Zoom meeting (and email the facilitator) twice.
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setSaving(true);
    try { await (live ? saveLive() : saveDraft()); } finally { setSaving(false); }
  }
  async function saveDraft() {
    const ok = await run(async () => {
      const facilitator_id = await linkFacilitator(circle, f);
      const hasAlt = f.alt_weekday && f.alt_start_time;
      const row = {
        name: f.name_auto ? (circle?.name || "Gita Circles") : f.name, name_auto: f.name_auto,
        facilitator_id, weekday: Number(f.weekday), start_time: f.start_time,
        alt_weekday: hasAlt ? Number(f.alt_weekday) : null, alt_start_time: hasAlt ? f.alt_start_time : null,
        duration_min: Number(f.duration_min), timezone: f.timezone, preferred_start: f.preferred_start || null,
        circle_type: f.circle_type || null, language: f.language || null, notes: f.notes || null,
        ...linkFields(),
      };
      if (circle?.status === "rejected") Object.assign(row, { status: "pending" });
      // "Pick automatically" releases the current licence first, so a busy licence never blocks a free one.
      if (f.licence_id === "auto") Object.assign(row, { licence_id: null, status: "pending", conflict_reason: null });
      let id = circle?.id;
      if (isNew) {
        const { data: created, error } = await supabase.from("circles").insert({ ...row, source: "manual" }).select("id").single();
        if (error) throw error;
        id = created.id;
      } else {
        const { error } = await supabase.from("circles").update(row).eq("id", id);
        if (error) throw error;
      }
      if (f.licence_id === "auto") {
        const { data: out, error } = await supabase.rpc("allocate_circle", { p_circle: id });
        if (error) throw error;
        return out;
      }
      const { data: out, error } = await supabase.from("circles")
        .update({ licence_id: f.licence_id, status: "pending", conflict_reason: null }).eq("id", id).select("*").single();
      if (error) throw new Error(/no_licence_clash/.test(error.message) ? "That licence is already booked at this time" : error.message);
      return out;
    }, (out) => `Saved: ${STATUS_LABEL[out.status]}${out.preference_used === 2 ? " (using 2nd preference)" : ""}`);
    if (ok) onClose();
  }

  const licence = data.licences.find((l) => l.id === circle?.licence_id);
  const requests = circle ? data.requests.filter((r) => r.circle_id === circle.id) : [];
  const [busy, setBusy] = useState(false);
  const [holders, setHolders] = useState(null);
  const [freeLicences, setFreeLicences] = useState(null);
  const [moveTo, setMoveTo] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const gaps = circle && ["pending", "conflict", "live"].includes(circle.status) ? emailGaps(circle, data) : [];

  // For clashes: who already holds this time. For live circles: which licences it could move to.
  useEffect(() => {
    if (!circle) return;
    if (circle.status === "conflict") {
      supabase.rpc("slot_holders", { p_circle: circle.id }).then(({ data: rows }) => setHolders(rows ?? []));
    }
    if (circle.status === "live") {
      supabase.rpc("free_licences_for_circle", { p_circle: circle.id }).then(({ data: rows }) => setFreeLicences(rows ?? []));
    }
  }, [circle?.id, circle?.status, circle?.updated_at]);

  async function moveLicence() {
    const target = freeLicences.find((l) => l.licence_id === moveTo);
    if (!target) return;
    if (!confirm(`Move "${circle.name}" to ${target.label}?\n\nThis creates a new Zoom meeting on ${target.label}, so the join link changes. The facilitator is emailed the new link, and the old meeting is deleted. Remember to update the WhatsApp group.`)) return;
    setBusy(true);
    await run(() => adminAction("move_licence", circle.id, { licence_id: moveTo }), (o) => withEmail(`Moved to ${o.licence}, new Zoom link created.`, o.email, circle.facilitator?.email));
    setBusy(false);
    setMoveTo("");
  }

  async function endOnDate() {
    if (!endDate) return;
    const now = endDate <= ukToday();
    if (!confirm(now ? `End "${circle.name}" now? This deletes its Zoom meeting.` : `Make ${fmtDate(endDate)} the last date for "${circle.name}"? Sessions until then carry on with the same link.`)) return;
    setBusy(true);
    const ok = await run(() => adminAction("end_on", circle.id, { date: endDate }), now ? "Circle ended" : `Circle now ends on ${fmtDate(endDate)}`);
    setBusy(false);
    if (ok && now) onClose();
  }

  // Approve straight from the drawer; it stays open and switches to the live Zoom details.
  const [approveOpen, setApproveOpen] = useState(false);
  const approve = () => setApproveOpen(true);
  async function recheck() {
    setBusy(true);
    await run(async () => {
      const { data: out, error } = await supabase.rpc("allocate_circle", { p_circle: circle.id });
      if (error) throw error;
      return out;
    }, (o) => o.status === "conflict" ? "Still no free licence at this time" : `Licence found: ${STATUS_LABEL[o.status]}`);
    setBusy(false);
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{isNew ? "New circle" : circle.name}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!isNew && (
          <div className="pills">
            <span className={`pill st-${circle.status}`}>{STATUS_LABEL[circle.status]}</span>
            {circle.preference_used === 2 && <span className="pill info">Using 2nd preference</span>}
            {licence?.is_mock && <span className="pill">Mock licence</span>}
          </div>
        )}
        {!isNew && <p className="small"><When c={circle} /></p>}

        {circle?.status === "pending" && circle.licence_id && (
          <div className="approve-bar">
            <div>
              <div className="approve-title">Ready to approve</div>
              <div className="muted small">
                On {licence?.label}{licence?.is_mock ? " (mock: fake Zoom details)" : ""}. Approving creates the weekly Zoom meeting
                {circle.facilitator?.name ? ` and sends ${circle.facilitator.name} their details` : ""}.
              </div>
            </div>
            <button className="primary" disabled={busy} onClick={approve}>{busy ? "Creating…" : "Approve + create Zoom"}</button>
          </div>
        )}
        {circle && ["pending", "conflict", "live"].includes(circle.status) && (
          <div className="email-check">
            {gaps.length > 0 ? (
              <span className="small warn-text">{circle.status === "live" ? "Details email" : "Approval email"} has nothing for: {gaps.map(placeholderLabel).join(", ")}. Fill these in below or under Setup, Email templates.</span>
            ) : (
              <span className="small muted">{circle.status === "live" ? "Preview the details email the facilitator gets." : "Approval email is complete."}</span>
            )}
            <button className="link small" onClick={() => setShowEmail(!showEmail)}>{showEmail ? "Hide email" : "Preview email"}</button>
          </div>
        )}
        {approveOpen && circle && <ApproveDialog circle={{ ...circle, ...linkFields() }} data={data} run={run} onBusy={setBusy} onClose={() => setApproveOpen(false)} />}
        {showEmail && circle && <div><EmailPreview compact template={data.templates.approved} circle={{ ...circle, ...linkFields() }} data={data} /></div>}
        {circle?.status === "conflict" && (
          <div className="approve-bar warn">
            <div>
              <div className="approve-title">Can't approve yet</div>
              <div className="small">{circle.conflict_reason}. Change the time below, or re-check if a licence has been freed.</div>
            </div>
            <button disabled={busy} onClick={recheck}>Re-check licences</button>
          </div>
        )}
        {circle?.status === "conflict" && holders?.length > 0 && (
          <div className="details">
            <span className="section-title">Who's using this time</span>
            {holders.map((h) => (
              <button key={h.circle_id} type="button" className="holder" onClick={() => onOpen?.(data.circles.find((x) => x.id === h.circle_id) ?? { id: h.circle_id })}>
                <b>{h.licence_label}</b>
                <span>{h.circle_name}</span>
                <span className="muted small">{DAYS[h.weekday]} {hhmm(h.start_time)} UK · {STATUS_LABEL[h.status]}{h.facilitator ? ` · ${h.facilitator}` : ""}</span>
              </button>
            ))}
            <p className="muted small">To free a licence, open one of these and move it to another time (or, if it isn't live yet, to another licence), then re-check.</p>
          </div>
        )}
        {circle?.uk_time_shifts && (
          <p className="hint">This circle is in {tzName(circle.timezone)} time, where the clocks change on different dates to the UK. Its UK time shifts by an hour for a few weeks a year; clash checks already cover both times.</p>
        )}

        {circle?.status === "live" && (
          <div className="details">
            <div className="details-head">
              <span className="section-title">Zoom details</span>
              {licence?.is_mock && <span className="tag">mock: not a real meeting</span>}
            </div>
            <Detail label="Join link" value={circle.join_url} copy />
            <Detail label="Meeting ID" value={circle.zoom_meeting_id} copy />
            <Detail label="Passcode" value={circle.passcode} copy />
            <Detail label="Host key" value={licence?.host_key ?? "not set on licence"} copy={Boolean(licence?.host_key)} note="Facilitator only. Never post in the group." />
            <Detail label="Licence" value={licence?.label} />
            <Detail label="Runs" value={`${DAY_NAMES[circle.weekday]}s ${hhmm(circle.start_time)} (${tzName(circle.timezone)} time)`} />
            <Detail label="Dates" value={`${fmtDate(circle.starts_on)} to ${fmtDate(circle.ends_on)}`} />
            <div className="copy-all">
              <CopyButton primary label="Copy all for facilitator" text={circleMessage(circle, licence?.host_key)} />
              <CopyButton label="Copy for participants" text={circleMessage(circle, null, { forFacilitator: false })} />
            </div>
            <p className="muted small">Facilitator version includes the host key. Participants version is safe to post in the WhatsApp group.</p>
            <div className="actions">
              <button onClick={() => run(() => adminAction("resend", circle.id), (o) => withEmail("Details email:", o.email, circle.facilitator?.email))}>Resend details email</button>
              {onAttendance && <button onClick={() => onAttendance(circle.id)}>See attendance</button>}
              <button className="danger" onClick={() => confirm("Delete the Zoom meeting and end this circle?") && run(() => adminAction("cancel", circle.id), "Circle ended").then((ok) => ok && onClose())}>End circle</button>
            </div>
          </div>
        )}

        {live && (
          <div className="details">
            <span className="section-title">Manage</span>
            <div className="manage-row">
              <label>Move to another licence
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} disabled={busy || !freeLicences}>
                  <option value="">{freeLicences === null ? "Loading…" : freeLicences.length ? "Choose a free licence…" : "No other licence is free at this time"}</option>
                  {(freeLicences ?? []).map((l) => (
                    <option key={l.licence_id} value={l.licence_id} disabled={!l.is_mock && !l.has_zoom}>
                      {l.label}{l.is_mock ? " (mock)" : ""}{!l.is_mock && !l.has_zoom ? " (no Zoom user set)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!moveTo || busy} onClick={moveLicence}>Move</button>
            </div>
            <p className="muted small">Moving creates a new meeting, so the join link changes.</p>
            <div className="manage-row">
              <label>Last session date
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
              </label>
              <button className="danger" disabled={!endDate || busy} onClick={endOnDate}>Set end date</button>
            </div>
            <p className="muted small">Sessions carry on with the same link until that date. Today's date ends it now.</p>
          </div>
        )}

        {circle && <CircleEmails circle={circle} onAll={onEmails} />}

        {requests.length > 0 && (
          <div className="details">
            <div className="details-head">
              <span className="section-title">Change requests</span>
              {onRequests && <button className="link small" onClick={onRequests}>Manage in Change requests</button>}
            </div>
            {requests.map((r) => (
              <div key={r.id} className="small"><b>{REQUEST_STATUS[r.status] ?? r.status}</b> · {r.message}</div>
            ))}
          </div>
        )}

        <div className="form">
          <label>Circle name
            <input value={f.name_auto && isNew ? "" : f.name} placeholder="Set automatically when saved" disabled={!editable}
              onChange={(e) => setF({ ...f, name: e.target.value, name_auto: false })} />
          </label>
          <p className="muted small name-hint">
            {f.name_auto
              ? "Automatic: Gita Circles | Initiated Name (Host Name) | Day Time. Updates when the host, day or time changes. Type to set your own."
              : <>Custom name. <button type="button" className="link small" disabled={!editable} onClick={() => setF({ ...f, name_auto: true, name: circle?.name ?? "" })}>Use automatic name</button></>}
          </p>
          <div className="grid2">
            <label>Circle type<input value={f.circle_type} onChange={set("circle_type")} disabled={!editable} /></label>
            <label>Language<input value={f.language} onChange={set("language")} disabled={!editable} /></label>
          </div>
          <div className="grid2">
            <label>Facilitator name<input value={f.facilitator_name} onChange={set("facilitator_name")} disabled={!editable} /></label>
            <label>Facilitator email<input type="email" value={f.facilitator_email} onChange={set("facilitator_email")} disabled={!editable} /></label>
          </div>
          <label>Phone<input value={f.phone} onChange={set("phone")} disabled={!editable} /></label>

          <fieldset className="group" disabled={!editable}>
            <legend>When (facilitator's own time)</legend>
            <label>Timezone
              <select value={f.timezone} onChange={set("timezone")}>
                {tzOptions.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            {circle?.timezone_label && <p className="muted small">From the form: {circle.timezone_label}</p>}
            <div className="grid3">
              <label>Day
                <select value={f.weekday} onChange={set("weekday")}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                </select>
              </label>
              <label>Start<input type="time" value={f.start_time} onChange={set("start_time")} /></label>
              <label>Minutes<input type="number" min="15" max="240" step="5" value={f.duration_min} onChange={set("duration_min")} /></label>
            </div>
            <div className="grid3">
              <label>2nd choice day
                <select value={f.alt_weekday} onChange={set("alt_weekday")}>
                  <option value="">None</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                </select>
              </label>
              <label>2nd choice start<input type="time" value={f.alt_start_time} onChange={set("alt_start_time")} /></label>
              <label>Preferred start<input type="date" value={f.preferred_start} onChange={set("preferred_start")} /></label>
            </div>
            {!isNew && circle.preference_used === 2 && (
              <p className="muted small">The first preference had no free licence, so this circle was moved to the 2nd preference. The original choice is now shown as the 2nd choice.</p>
            )}
          </fieldset>

          <label>Licence
            <select value={f.licence_id} onChange={set("licence_id")} disabled={!editable || live}>
              <option value="auto">Pick automatically</option>
              {data.licences.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.label}{l.is_mock ? " (mock)" : ""}</option>)}
            </select>
          </label>
          {live && <p className="muted small">To change the licence of a live circle, use <b>Move to another licence</b> above.</p>}
          <fieldset className="group" disabled={!editable}>
            <legend>Links for this circle (used in emails)</legend>
            <label>WhatsApp group link<input type="url" value={f.whatsapp_group_link} onChange={set("whatsapp_group_link")} placeholder="https://chat.whatsapp.com/…" /></label>
            <label>YouTube playlist<input type="url" value={f.youtube_playlist_link} onChange={set("youtube_playlist_link")} placeholder={data.settings.youtube_playlist_link || "https://youtube.com/playlist?list=…"} /></label>
            <label>Drive folder<input type="url" value={f.drive_folder_link} onChange={set("drive_folder_link")} placeholder={data.settings.drive_folder_link || "Default from Emails"} /></label>
            <p className="muted small">Leave Drive blank to use the shared folder set under Emails.</p>
          </fieldset>
          <label>Notes<textarea rows="3" value={f.notes} onChange={set("notes")} disabled={!editable} /></label>
          {live && <p className="hint">Changing the day, time or length moves the existing Zoom meeting. The join link stays the same, and the facilitator is emailed the update.</p>}
          {editable && (
            <button className="primary wide" disabled={(!f.name_auto && !f.name.trim()) || saving} onClick={save}>
              {saving ? "Saving…" : isNew ? "Add circle" : circle.status === "rejected" ? "Save and put back in queue" : "Save changes"}
            </button>
          )}
        </div>

        {circle && (
          <div className="drawer-foot">
            <span className="muted small">Source: {circle.source} · created {fmtStamp(circle.created_at)}</span>
            {circle.status !== "live" && (
              <button className="ghost danger small" onClick={() => onDelete(circle, onClose)}>
                {Icon.trash} Delete circle
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Detail({ label, value, copy, note }) {
  return (
    <div className="detail">
      <span className="muted small">{label}</span>
      <span className="detail-value">{value ?? "–"}{note && <span className="detail-note">{note}</span>}</span>
      {copy && value ? <CopyButton text={String(value)} /> : <span />}
    </div>
  );
}

/* ---------------- Sent emails ---------------- */
const EMAIL_KIND = { approved: "Circle details", updated: "Details changed", test: "Test", invite: "Sign-in invite (from Supabase)" };
const EMAIL_STATUS = { sent: ["Sent", "st-live"], failed: ["Failed", "st-conflict"], skipped: ["Not sent", "st-pending"] };

// Last few emails for one circle, inside the circle panel.
function CircleEmails({ circle, onAll }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.from("email_log").select("id, sent_at, kind, to_email, status, error").eq("circle_id", circle.id)
      .order("sent_at", { ascending: false }).limit(5).then(({ data }) => setRows(data ?? []));
  }, [circle.id, circle.status, circle.updated_at]);
  if (!rows?.length) return null;
  return (
    <div className="details">
      <div className="details-head">
        <span className="section-title">Emails</span>
        {onAll && <button className="link small" onClick={() => onAll(circle.name)}>All emails for this circle</button>}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="small email-mini clickable" role="button" tabIndex={0} title="Open this email"
          onClick={() => onAll?.(`id:${r.id}`)} onKeyDown={(e) => e.key === "Enter" && onAll?.(`id:${r.id}`)}>
          <span className={`pill small ${EMAIL_STATUS[r.status]?.[1] ?? ""}`}>{EMAIL_STATUS[r.status]?.[0] ?? r.status}</span>
          <span>{EMAIL_KIND[r.kind] ?? r.kind} to {r.to_email ?? "nobody"}</span>
          <span className="muted">{fmtStamp(r.sent_at)}</span>
          {r.error && <div className="warn-text">{r.error}</div>}
        </div>
      ))}
    </div>
  );
}

// The whole email as it was sent, loaded when a row is opened.
function EmailDetail({ id, row }) {
  const [mail, setMail] = useState(null);
  const [plain, setPlain] = useState(false);
  useEffect(() => {
    supabase.from("email_log").select("from_address, reply_to, message_id, body_html, body_text").eq("id", id).single()
      .then(({ data, error }) => setMail(error ? { error: error.message } : data));
  }, [id]);
  if (!mail) return <p className="muted small">Loading email…</p>;
  if (mail.error) return <p className="error small">{mail.error}</p>;
  const has = mail.body_html || mail.body_text;
  return (
    <div className="email-detail">
      <dl className="email-head">
        <dt>From</dt><dd>{mail.from_address ?? "–"}</dd>
        <dt>To</dt><dd>{row.to_email ?? "–"}</dd>
        {mail.reply_to && <><dt>Replies to</dt><dd>{mail.reply_to}</dd></>}
        <dt>Subject</dt><dd>{row.subject ?? "–"}</dd>
        <dt>Sent</dt><dd>{fmtStamp(row.sent_at)} by {row.sent_by}</dd>
        {row.error && <><dt>Problem</dt><dd className="warn-text">{row.error}</dd></>}
      </dl>
      {!has ? (
        <p className="muted small">{row.status === "skipped" ? "This email wasn't written, so there's nothing to show." : "The full text wasn't kept for emails sent before 8 Oct 2026. The Gmail Sent folder has a copy."}</p>
      ) : (
        <>
          <div className="seg email-view">
            <button className={!plain ? "active" : ""} onClick={() => setPlain(false)}>As sent</button>
            <button className={plain ? "active" : ""} onClick={() => setPlain(true)}>Plain text</button>
          </div>
          {plain || !mail.body_html
            ? <pre className="email-plain">{mail.body_text}</pre>
            : <iframe className="email-frame" title="Email as sent" sandbox="allow-same-origin"
                onLoad={(e) => { const d = e.currentTarget.contentDocument; if (d) e.currentTarget.style.height = `${Math.min(900, d.documentElement.scrollHeight + 4)}px`; }}
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:16px;background:#fff">${mail.body_html}</body>`} />}
        </>
      )}
    </div>
  );
}

function EmailLog({ data, run, onSelect, initial }) {
  const [rows, setRows] = useState(null);
  const [limit, setLimit] = useState(200);
  // Opened from elsewhere: "failed" filters, "id:<uuid>" opens one email, anything else is a search.
  const openId = initial?.startsWith("id:") ? initial.slice(3) : null;
  const [status, setStatus] = useState(initial === "failed" ? "problems" : "all");
  const [q, setQ] = useState(initial && initial !== "failed" && !openId ? initial : "");
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(openId);

  const load = useCallback(async () => {
    const { data: r, error } = await supabase.from("email_log")
      .select("id, sent_at, kind, to_email, subject, circle_id, circle_name, sent_by, status, error")
      .order("sent_at", { ascending: false }).range(0, limit - 1);
    setRows(error ? { error: error.message } : r ?? []);
  }, [limit]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <section className="card"><p className="muted">Loading sent emails…</p></section>;
  if (rows.error) return <section className="card"><p className="error">{rows.error}</p></section>;
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => (status === "all" || (status === "problems" ? r.status !== "sent" : r.status === status))
    && (!term || `${r.to_email ?? ""} ${r.subject ?? ""} ${r.circle_name ?? ""} ${r.sent_by ?? ""}`.toLowerCase().includes(term)));
  const counts = { sent: rows.filter((r) => r.status === "sent").length, problems: rows.filter((r) => r.status !== "sent").length };

  async function resend(r) {
    const c = data.circles.find((x) => x.id === r.circle_id);
    if (!c || c.status !== "live") return;
    if (!confirm(`Send the current details email for "${c.name}" to ${c.facilitator?.email ?? "the facilitator"} again?`)) return;
    setBusy(r.id);
    await run(() => adminAction("resend", c.id), (o) => withEmail("Details email:", o.email, c.facilitator?.email));
    setBusy(null);
    load();
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Sent emails</h2>
          <p className="muted small">Every email the dashboard sends or tries to send. Copies of sent ones are also in the Gmail account's Sent folder.</p>
        </div>
        <div className="filters">
          <input placeholder="Search recipient, subject, circle" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {[["all", `All (${rows.length})`], ["sent", `Sent (${counts.sent})`], ["problems", `Failed or not sent (${counts.problems})`]].map(([k, l]) => (
              <button key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
          <button onClick={load}>Refresh</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table email-log">
          <thead><tr><th>When (UK)</th><th>To</th><th>Email</th><th>Circle</th><th>Sent by</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const c = data.circles.find((x) => x.id === r.circle_id);
              const [label, cls] = EMAIL_STATUS[r.status] ?? [r.status, ""];
              return (
                <Fragment key={r.id}>
                <tr className={`clickable ${r.status === "sent" ? "" : "email-problem"} ${open === r.id ? "email-open" : ""}`}
                  onClick={() => setOpen(open === r.id ? null : r.id)} title={open === r.id ? "Close" : "Show the whole email"}>
                  <td className="nowrap">{fmtStamp(r.sent_at)}</td>
                  <td>{r.to_email ?? <span className="muted">none</span>}</td>
                  <td><div>{r.subject ?? <span className="muted">(not written)</span>}</div><div className="muted small">{EMAIL_KIND[r.kind] ?? r.kind}</div></td>
                  <td>{c ? <button className="link" onClick={(e) => { e.stopPropagation(); onSelect(c); }}>{blockName(c.name)}</button> : <span className="muted">{r.circle_name ? blockName(r.circle_name) : "–"}</span>}</td>
                  <td className="small">{r.sent_by}</td>
                  <td><span className={`pill small ${cls}`}>{label}</span>{r.error && <div className="small warn-text">{r.error}</div>}</td>
                  <td>{r.status !== "sent" && r.kind !== "test" && c?.status === "live" && (
                    <button className="small" disabled={busy === r.id} onClick={(e) => { e.stopPropagation(); resend(r); }}>{busy === r.id ? "Sending…" : "Resend"}</button>
                  )}<span className="email-caret" aria-hidden="true">{open === r.id ? "▴" : "▾"}</span></td>
                </tr>
                {open === r.id && <tr className="email-detail-row"><td colSpan={7}><EmailDetail id={r.id} row={r} /></td></tr>}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan={7} className="muted">{rows.length ? "Nothing matches." : "No emails sent yet. Approving a circle, changing a live circle or sending a test from Email templates will show up here."}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length >= limit && <button className="link small" onClick={() => setLimit((n) => n + 200)}>Show older emails</button>}
      <p className="muted small">"Not sent" means the email was skipped, for example because the circle had no facilitator email. Resend sends the circle's current details again. Sign-in invites are listed with whether Supabase accepted them; password resets and sign-in links aren't listed (they're in the Gmail Sent folder).</p>
    </section>
  );
}

const ACTION_LABEL = {
  provision: "Approved and created Zoom meeting", cancel: "Ended circle", resend: "Resent details email",
  reschedule: "Changed time", handover: "Handed over", end_on: "Set last session date", move_licence: "Moved to another licence",
  sync_licences: "Synced licences from Zoom", set_host_key: "Set host key", test_email: "Sent test email",
  provision_failed: "Approval failed", tally_intake: "Form received", invite_admin: "Invited admin",
};

/* ---------------- Licences ---------------- */
function Licences({ data, run, notify, go }) {
  const [rows, setRows] = useState(data.licences);
  // Keep unsaved edits when data reloads after another action.
  useEffect(() => setRows((prev) => data.licences.map((l) => prev.find((p) => p.id === l.id && p._dirty) ?? l)), [data.licences]);
  const edit = (id, k, v) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v, _dirty: true } : r)));
  const booked = (id) => data.circles.filter((c) => c.licence_id === id && [...ACTIVE, "paused"].includes(c.status)).length;
  const nextLabel = () => {
    const used = new Set(rows.map((r) => r.label));
    for (let i = 1; ; i++) { const l = `Licence ${String(i).padStart(2, "0")}`; if (!used.has(l)) return l; }
  };
  const dirty = rows.some((r) => r._dirty);
  const [syncing, setSyncing] = useState(false);
  const [keyBusy, setKeyBusy] = useState(null);


  // Zoom no longer reveals existing host keys, so the system sets a new random one on the Zoom user.
  async function setHostKey(r) {
    const live = data.circles.filter((c) => c.licence_id === r.id && c.status === "live").length;
    const msg = r.host_key
      ? `Give ${r.label} a new host key?\n\nThe current key (${r.host_key}) stops working straight away.${live ? ` ${live} live circle${live > 1 ? "s use" : " uses"} this licence: use Resend details email on ${live > 1 ? "each" : "it"} so the facilitator gets the new key.` : ""}`
      : `Set a new host key on ${r.label} (${r.zoom_user_email})?\n\nAny host key already on that Zoom account stops working. Skip shared accounts (like Office or Info) if staff rely on their key.`;
    if (!confirm(msg)) return;
    setKeyBusy(r.id);
    await run(() => adminAction("set_host_key", null, { licence_id: r.id }), (o) => `${o.label}: new host key ${o.host_key} set in Zoom`);
    setKeyBusy(null);
  }
  const [syncResult, setSyncResult] = useState(null);

  async function syncFromZoom() {
    if (dirty && !confirm("You have unsaved licence changes. Sync anyway? Unsaved edits to synced licences may be overwritten.")) return;
    setSyncing(true);
    const out = await run(() => adminAction("sync_licences"),
      (o) => `Zoom: ${o.licensed} licensed user${o.licensed === 1 ? "" : "s"} found`);
    setSyncing(false);
    if (out && out !== true) setSyncResult(out);
  }

  async function saveAll() {
    await run(async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        const { error } = await supabase.from("licences").update({
          label: r.label, zoom_user_email: r.zoom_user_email ? r.zoom_user_email.trim().toLowerCase() : null,
          host_key: r.host_key || null, active: r.active, is_mock: r.is_mock,
        }).eq("id", r.id);
        if (error) throw error;
      }
      setRows((cur) => cur.map(({ _dirty, ...r }) => r));
    }, "Licences saved");
  }

  function remove(r) {
    const n = booked(r.id);
    if (n) return notify("error", `${r.label} has ${n} active circle${n > 1 ? "s" : ""}. Move or end them first, or untick Active instead.`);
    if (!confirm(`Delete ${r.label}? This can't be undone.`)) return;
    run(async () => {
      const { error } = await supabase.from("licences").delete().eq("id", r.id);
      if (error) throw error;
    }, `${r.label} deleted`);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Zoom licences</h2>
        <div className="filters">
          <button onClick={() => run(async () => {
            const { error } = await supabase.from("licences").insert({ label: nextLabel(), sort_order: Math.max(0, ...rows.map((r) => r.sort_order ?? 0)) + 1 });
            if (error) throw error;
          }, "Licence added")}>Add licence</button>
          <button disabled={syncing} onClick={syncFromZoom}>{syncing ? "Syncing…" : "Sync from Zoom"}</button>
          <button className="primary" disabled={!dirty} onClick={saveAll}>{dirty ? "Save changes" : "Saved"}</button>
        </div>
      </div>
      <p className="muted small">
        Each licence is one licensed Zoom user. <b>Sync from Zoom</b> brings in every licensed user in your Zoom account, keeping your labels.
        Zoom doesn't reveal existing host keys, so use <b>Set key</b> to give a licence a new one (its old key stops working; skip shared accounts staff rely on).
        Meetings are created under that user, and facilitators get its host key so they can claim host without a password.
        <b> Mock</b> is for testing only: approving a circle on a mock licence creates fake Zoom details.
      </p>

      {syncResult && (
        <div className="details sync-result">
          <div className="details-head">
            <span className="section-title">Last sync: {syncResult.licensed} licensed of {syncResult.zoom_users} Zoom users</span>
            <button className="link small" onClick={() => setSyncResult(null)}>Hide</button>
          </div>
          {syncResult.results.map((r, i) => (
            <div key={i} className={`sync-row ${r.ok ? "" : "warn-text"}`}>
              <b>{r.label}</b>
              <span>{r.email ?? "–"}{r.name ? ` (${r.name})` : ""}</span>
              <span className="small">{r.ok ? `${r.action}${r.host_key ? ", host key saved" : `, no host key (${r.host_key_note || "not returned"})`}` : (r.error ?? r.action)}</span>
            </div>
          ))}
          <p className="muted small">Every licensed Zoom user becomes a licence. If one of them shouldn't host circles (for example the account owner), untick Active. Empty slots with no Zoom user can be deleted once their circles are moved or cleared.</p>
        </div>
      )}
      <div className="table-wrap">
        <table className="table edit">
          <thead><tr><th>Label</th><th>Zoom user email</th><th>Host key</th><th>Active</th><th>Mock</th><th>Circles</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r._dirty ? "dirty" : ""}>
                <td><input value={r.label} onChange={(e) => edit(r.id, "label", e.target.value)} /></td>
                <td><input value={r.zoom_user_email ?? ""} placeholder={r.is_mock ? "not needed for mock" : "zoom-user@…"} onChange={(e) => edit(r.id, "zoom_user_email", e.target.value)} /></td>
                <td>
                  <span className="hostkey-cell">
                    <input value={r.host_key ?? ""} placeholder="not set" onChange={(e) => edit(r.id, "host_key", e.target.value)} />
                    {(r.zoom_user_id || r.zoom_user_email) && !r.is_mock && (
                      <button className="small" disabled={keyBusy === r.id} onClick={() => setHostKey(r)}>
                        {keyBusy === r.id ? "Setting…" : r.host_key ? "Change" : "Set key"}
                      </button>
                    )}
                  </span>
                </td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => edit(r.id, "active", e.target.checked)} /></td>
                <td><input type="checkbox" checked={r.is_mock} onChange={(e) => edit(r.id, "is_mock", e.target.checked)} /></td>
                <td>
                  {booked(r.id) ? <button className="link" title="Show these circles" onClick={() => go("Circles", r.label)}>{booked(r.id)}</button> : 0}
                  {r.zoom_user_email && <button className="link small nowrap licence-meetings" onClick={() => go("Zoom", r.label)}>Meetings</button>}
                </td>
                <td className="cell-actions">
                  <IconButton icon="trash" label={`Delete ${r.label}`} danger onClick={() => remove(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Requests ---------------- */
// What "Apply" does for each request type. Types without an entry are handled by hand.
const today = ukToday;
const APPLY = {
  change_time: { label: "Apply new time", confirm: (r, c) => `Move "${c.name}" to ${requestSummary(r.request_type, r.details).replace(/^Move to /, "")}?${c.status === "live" ? " The Zoom link stays the same." : ""}` },
  change_start: { label: "Apply start date", confirm: (r, c) => `Change the start date of "${c.name}" to ${fmtDate(r.details.from)}?` },
  handover: { label: "Hand over", confirm: (r, c) => `Hand "${c.name}" over to ${r.details.name || r.details.email}?${c.status === "live" ? " They'll be invited and emailed the details." : ""}` },
  stop: { label: "Set end date", confirm: (r, c) => r.details.from && r.details.from > today()
    ? `Make ${fmtDate(r.details.from)} the last date for "${c.name}"? Sessions continue until then.`
    : `End "${c.name}" now?${c.status === "live" ? " This deletes its Zoom meeting." : ""}` },
};

// Why a request can't be applied right now (or null if it can).
function blockedReason(r, c) {
  const d = r.details ?? {};
  if (!c) return "Circle not found";
  if (c.status === "ended") return "Circle has ended";
  if (r.request_type === "change_time") {
    if (!d.weekday || !d.start_time) return "Request is missing the day or time";
    // A live circle can't change from a future date without cancelling the sessions before it.
    if (c.status === "live" && d.from && d.from > today()) return `Due on ${fmtDate(d.from)}: apply on or after that date`;
  }
  if (r.request_type === "change_start") {
    if (!d.from) return "Request is missing the date";
    if (c.status === "live" && c.starts_on && c.starts_on <= today()) return "Already running, so the start date can't change";
  }
  if (r.request_type === "handover" && !d.email) return "Request is missing the new facilitator's email";
  return null;
}

async function applyRequest(r, c) {
  const d = r.details ?? {};
  const live = c.status === "live";
  if (r.request_type === "change_time") {
    const patch = { weekday: Number(d.weekday), start_time: d.start_time };
    if (live) return adminAction("reschedule", c.id, { patch });
    // Not live yet: release the licence and re-allocate at the new time.
    const { error } = await supabase.from("circles")
      .update({ ...patch, ...(d.from ? { preferred_start: d.from } : {}), licence_id: null, status: "pending", conflict_reason: null })
      .eq("id", c.id);
    if (error) throw error;
    const { data: out, error: e2 } = await supabase.rpc("allocate_circle", { p_circle: c.id });
    if (e2) throw e2;
    const status = Array.isArray(out) ? out[0]?.status : out?.status;
    if (status === "conflict") return { conflict: true };
    return;
  }
  if (r.request_type === "change_start") {
    if (live) return adminAction("reschedule", c.id, { patch: { preferred_start: d.from } });
    const { error } = await supabase.from("circles").update({ preferred_start: d.from }).eq("id", c.id);
    if (error) throw error;
    return;
  }
  if (r.request_type === "handover") return adminAction("handover", c.id, { facilitator: { name: d.name, email: d.email } });
  if (r.request_type === "stop") return adminAction("end_on", c.id, { date: d.from || today() });
}

function Requests({ data, run, onSelect }) {
  const [show, setShow] = useState("open");
  const setStatus = (id, status, msg) => run(async () => {
    const { error } = await supabase.from("change_requests").update({ status }).eq("id", id);
    if (error) throw error;
  }, msg);
  const rows = data.requests.filter((r) => show === "all" || r.status === "open");
  const circleOf = (r) => data.circles.find((c) => c.id === r.circle_id);

  function apply(r) {
    const c = circleOf(r);
    if (!c) return;
    if (!confirm(APPLY[r.request_type].confirm(r, c))) return;
    run(async () => {
      const out = await applyRequest(r, c);
      if (out?.conflict) return out; // leave the request open: the circle is now a clash
      const { error } = await supabase.from("change_requests").update({ status: "done" }).eq("id", r.id);
      if (error) throw error;
      return out;
    }, (o) => o?.conflict
      ? { text: "No licence is free at the new time. The circle is now a clash in the Queue; the request stays open.", warn: true }
      : withEmail("Change applied and request marked done.", o?.email, r.request_type === "handover" ? r.details?.email : c.facilitator?.email));
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Change requests from facilitators</h2>
        <div className="seg">
          <button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</button>
          <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All</button>
        </div>
      </div>
      <p className="card-sub">Most requests can be applied in one click. Pauses and other requests are handled by hand: for a pause, cancel those weeks in Zoom (or set a last session date and add the circle again from the restart date), then mark the request done.</p>
      {!rows.length && <p className="muted">{show === "open" ? "No open requests." : "No requests yet."}</p>}
      <div className="list">
        {rows.map((r) => {
          const c = circleOf(r);
          const blocked = r.status === "open" && APPLY[r.request_type] ? blockedReason(r, c) : null;
          const canApply = r.status === "open" && APPLY[r.request_type] && !blocked;
          return (
            <div key={r.id} className={`row ${r.status !== "open" ? "row-done" : ""}`}>
              <div className="row-main" role="button" tabIndex={0} onClick={() => onSelect(r.circle_id)} onKeyDown={(e) => e.key === "Enter" && onSelect(r.circle_id)}>
                <div className="row-title">
                  {r.circle?.name}
                  <span className="tag info">{REQUEST_TYPES[r.request_type]?.label ?? "Request"}</span>
                </div>
                <div className="request-msg">{r.message}</div>
                {blocked && <div className="small warn-text">{blocked}</div>}
                {c && r.request_type === "change_time" && (
                  <div className="muted small">Currently {DAY_NAMES[c.weekday]}s {hhmm(c.start_time)} ({tzName(c.timezone)} time)</div>
                )}
                <div className="muted small">{r.requested_by} · {fmtStamp(r.created_at)} · <b>{REQUEST_STATUS[r.status] ?? r.status}</b></div>
              </div>
              <div className="row-actions">
                {canApply && <button className="primary" onClick={() => apply(r)}>{APPLY[r.request_type].label}</button>}
                <button onClick={() => onSelect(r.circle_id)}>{Icon.edit} Edit circle</button>
                {r.status === "open" ? (
                  <>
                    <button className={canApply ? "ghost" : "primary"} onClick={() => setStatus(r.id, "done", "Marked done")}>Mark done</button>
                    <button className="ghost" onClick={() => setStatus(r.id, "dismissed", "Dismissed")}>Dismiss</button>
                  </>
                ) : (
                  <button className="ghost" onClick={() => setStatus(r.id, "open", "Reopened")}>Reopen</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Settings ---------------- */
function Settings({ data, run }) {
  const [s, setS] = useState(data.settings);
  const [admins, setAdmins] = useState([]);
  const [newAdmin, setNewAdmin] = useState("");
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const loadAdmins = () => supabase.from("admin_emails").select("*").order("email").then(({ data: d }) => setAdmins(d ?? []));
  useEffect(() => { loadAdmins(); }, []);
  // Super admins manage the admin list (the database enforces this too).
  const isSuper = Boolean((admins.find((a) => a.email === data.me?.email) ?? data.me)?.is_super);

  // One transaction: if the new buffer or term dates would create a clash, nothing is saved.
  const save = () => run(async () => {
    const { error } = await supabase.rpc("save_settings", {
      p_buffer: Number(s.buffer_minutes), p_duration: Number(s.default_duration_min), p_timezone: s.default_timezone,
      p_term_start: s.term_start || null, p_term_end: s.term_end || null,
    });
    if (error) {
      throw new Error(/no_licence_clash/.test(error.message)
        ? "Not saved: with these settings two circles on the same licence would overlap. Reduce the buffer or move a circle first."
        : error.message);
    }
  }, "Settings saved");

  const demoCount = data.circles.filter((c) => c.is_demo).length;

  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Scheduling rules</h2><button className="primary" onClick={save}>Save</button></div>
        <div className="form grid3">
          <label>Buffer between meetings (min)<input type="number" min="0" max="120" value={s.buffer_minutes} onChange={set("buffer_minutes")} /></label>
          <label>Default length (min)<input type="number" min="15" max="240" value={s.default_duration_min} onChange={set("default_duration_min")} /></label>
          <label>Default timezone
            <select value={s.default_timezone} onChange={set("default_timezone")}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label>Term starts<input type="date" value={s.term_start ?? ""} onChange={set("term_start")} /></label>
          <label>Term ends<input type="date" value={s.term_end ?? ""} onChange={set("term_end")} /></label>
        </div>
        <p className="muted small">Zoom meetings repeat weekly from the first matching day on or after the later of the term start and the facilitator's preferred start date, until the term end (max 50 weeks).</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Admins</h2></div>
        <p className="muted small">{isSuper
          ? "You're a super admin: you can add and remove admins, and choose who else is a super admin. Everyone listed can use the whole dashboard."
          : "Everyone listed can use the whole dashboard. Only super admins can add or remove admins."}</p>
        <div className="list">
          {admins.map((a) => (
            <div key={a.email} className="row">
              <div className="row-main">{a.email}{a.is_super && <span className="pill small info admin-super">Super admin</span>}</div>
              <AdminName admin={a} run={run} onSaved={loadAdmins} />
              {a.email !== data.me?.email && (
                <button className="link small nowrap" onClick={() => run(() => adminAction("invite_admin", null, { facilitator: { email: a.email } }),
                  (o) => o?.invite === "invited" ? { text: `Invite sent to ${a.email}.` }
                    : o?.invite === "already has an account" ? { text: `${a.email} already has a sign-in. They can use Forgot password if needed.` }
                    : { text: `Invite to ${a.email} didn't send: ${o?.invite}. See Setup, Sent emails.`, warn: true })}>Send invite</button>
              )}
              {isSuper && a.email !== data.me?.email && (
                <button className="link small nowrap" onClick={() => confirm(a.is_super ? `Stop ${a.email} being a super admin? They stay an admin.` : `Make ${a.email} a super admin? They'll be able to add and remove admins.`) && run(async () => {
                  const { error } = await supabase.from("admin_emails").update({ is_super: !a.is_super }).eq("email", a.email);
                  if (error) throw error;
                  loadAdmins();
                }, a.is_super ? "No longer a super admin" : "Now a super admin")}>{a.is_super ? "Remove super admin" : "Make super admin"}</button>
              )}
              {isSuper && <div className="row-actions">
                <IconButton icon="trash" label={`Remove ${a.email}`} danger disabled={admins.length < 2 || a.email === data.me?.email}
                  title={a.email === data.me?.email ? "You can't remove yourself" : admins.length < 2 ? "There must be at least one admin" : "Remove admin"}
                  onClick={() => confirm(`Remove ${a.email} as an admin?`) && run(async () => {
                    const { error } = await supabase.from("admin_emails").delete().eq("email", a.email);
                    if (error) throw error;
                    loadAdmins();
                  }, "Removed")} />
              </div>}
            </div>
          ))}
        </div>
        {isSuper && <div className="inline">
          <input type="email" placeholder="email@…" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
          <button disabled={!newAdmin} onClick={() => run(async () => {
            const email = newAdmin.trim().toLowerCase();
            const { error } = await supabase.from("admin_emails").insert({ email });
            if (error) throw error;
            setNewAdmin("");
            loadAdmins();
            return adminAction("invite_admin", null, { facilitator: { email } }).catch((e) => ({ invite: `invite failed: ${e.message}` }));
          }, (o) => o?.invite === "invited" ? "Admin added and emailed an invite to set their password."
            : o?.invite === "already has an account" ? "Admin added. They already have an account, so they can sign in now."
            : `Admin added, but the invite didn't send (${o?.invite ?? "unknown"}). They can use Forgot password on the sign-in page.`)}>Add admin</button>
        </div>}
      </section>

      {demoCount > 0 && (
        <section className="card">
          <div className="card-head"><h2>Demo data</h2></div>
          <p>{demoCount} demo circles are loaded for testing the schedule.</p>
          <button className="danger" onClick={() => confirm("Delete all demo circles and demo facilitators?") && run(async () => {
            const { error } = await supabase.from("circles").delete().eq("is_demo", true);
            if (error) throw error;
            const { error: e2 } = await supabase.from("facilitators").delete().like("email", "demo%@example.org");
            if (e2) throw e2;
          }, "Demo data cleared")}>Clear demo data</button>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Activity</h2></div>
        <div className="log">
          {data.log.map((l) => (
            <div key={l.id} className={`log-row ${String(l.action ?? "").includes("failed") ? "warn-text" : ""}`}>
              <span className="muted small">{fmtStamp(l.at)}</span>
              <span><b>{ACTION_LABEL[l.action] ?? l.action}</b> by {l.actor}</span>
              <code className="small">{JSON.stringify(l.detail)?.slice(0, 220)}</code>
            </div>
          ))}
          {!data.log.length && <p className="muted">Nothing yet.</p>}
        </div>
      </section>
    </>
  );
}

/* ---------------- Emails ---------------- */
// Renders a template for one circle, marking anything not set yet.
function EmailPreview({ template, circle, data, compact }) {
  const licence = data.licences.find((l) => l.id === circle?.licence_id);
  const vars = buildVars({ circle: circle ?? {}, facilitator: circle?.facilitator, licence, settings: data.settings, appUrl: APP_URL, sender: data.me?.name });
  // Before approval, show where the Zoom details will go instead of flagging them as missing.
  if (circle?.status !== "live") {
    for (const p of PLACEHOLDERS) if (p.auto && !vars[p.key]) vars[p.key] = `[${p.label.toLowerCase()}, added on approval]`;
    if (vars.start_date && !circle?.starts_on) vars.start_date = `${vars.start_date} (expected)`;
  }
  const { subject, html } = render(template, vars, { preview: true });
  return (
    <div className={`email-preview ${compact ? "compact" : ""}`}>
      <div className="email-subject"><span className="muted small">Subject</span> {subject}</div>
      <div className="email-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

const TEMPLATE_TABS = [
  ["approved", "Approval email", "Sent when a circle is approved, and by Resend details or a handover."],
  ["updated", "Details changed", "Sent when a live circle's day or time changes, or it moves to another licence."],
];
const LINK_SETTINGS = [
  ["drive_folder_link", "Google Drive folder", "https://drive.google.com/…"],
  ["support_contact", "Support contact", "e.g. circles@thinkgita.org"],
  ["youtube_playlist_link", "Default YouTube playlist (optional)", "Used if a circle has none of its own"],
];

function Emails({ data, run }) {
  const [key, setKey] = useState("approved");
  const [drafts, setDrafts] = useState(() => ({
    approved: { subject: data.templates.approved.subject, body: data.templates.approved.body },
    updated: { subject: data.templates.updated.subject, body: data.templates.updated.body },
  }));
  const [links, setLinks] = useState(() => Object.fromEntries(LINK_SETTINGS.map(([k]) => [k, data.settings[k] ?? ""])));
  const candidates = data.circles.filter((c) => !c.is_demo && c.status !== "rejected");
  const [previewId, setPreviewId] = useState(() => (candidates.find((c) => c.status === "live") ?? candidates[0] ?? data.circles[0])?.id ?? "");
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const draft = drafts[key];
  const saved = data.templates[key];
  const dirty = draft.subject !== saved.subject || draft.body !== saved.body;
  const linksDirty = LINK_SETTINGS.some(([k]) => (links[k] ?? "") !== (data.settings[k] ?? ""));
  const setDraft = (patch) => setDrafts({ ...drafts, [key]: { ...draft, ...patch } });
  const unknown = unknownPlaceholders(draft);
  const used = new Set(usedPlaceholders(draft));
  const previewCircle = data.circles.find((c) => c.id === previewId);
  const previewData = { ...data, settings: { ...data.settings, ...links } };
  const previewVars = previewCircle && buildVars({ circle: previewCircle, facilitator: previewCircle.facilitator, licence: data.licences.find((l) => l.id === previewCircle.licence_id), settings: previewData.settings, appUrl: APP_URL, sender: data.me?.name });
  const missing = previewVars ? missingValues(draft, previewVars, { beforeApproval: previewCircle.status !== "live" }) : [];

  function insert(k) {
    const el = bodyRef.current;
    const token = `{{${k}}}`;
    if (!el) return setDraft({ body: draft.body + token });
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    setDraft({ body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }

  const saveTemplate = () => run(async () => {
    if (!draft.subject.trim() || !draft.body.trim()) throw new Error("Subject and body can't be empty");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("email_templates").upsert({
      key, subject: draft.subject, body: draft.body, updated_at: new Date().toISOString(), updated_by: user?.email ?? null,
    });
    if (error) throw error;
  }, "Email saved. It's used from the next email sent.");

  const saveLinks = () => run(async () => {
    const patch = Object.fromEntries(LINK_SETTINGS.map(([k]) => [k, (links[k] ?? "").trim() || null]));
    const { error } = await supabase.from("settings").update(patch).eq("id", 1);
    if (error) throw error;
  }, "Links and contacts saved");

  async function sendTest() {
    setSending(true);
    await run(() => adminAction("test_email", previewId, { template_key: key, template: draft }), (o) => `Test email sent to ${o.to}`);
    setSending(false);
  }

  const groups = [...new Set(PLACEHOLDERS.map((p) => p.group))];

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Links and contacts</h2>
          <button className="primary" disabled={!linksDirty} onClick={saveLinks}>{linksDirty ? "Save" : "Saved"}</button>
        </div>
        <p className="muted small">Used in every email. Each circle's WhatsApp group and YouTube playlist are asked for when you approve it. Emails are signed by the admin who sends them (set your name under Settings → Admins).</p>
        <div className="form grid2">
          {LINK_SETTINGS.map(([k, label, ph]) => (
            <label key={k}>{label}<input value={links[k] ?? ""} placeholder={ph} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} /></label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Facilitator emails</h2>
          <div className="seg">
            {TEMPLATE_TABS.map(([k, label]) => (
              <button key={k} className={k === key ? "active" : ""} onClick={() => setKey(k)}>
                {label}{(drafts[k].subject !== data.templates[k].subject || drafts[k].body !== data.templates[k].body) ? " •" : ""}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">{TEMPLATE_TABS.find(([k]) => k === key)[2]} Write in plain text. Lines in CAPITALS become headings, and links become clickable.</p>

        <div className="email-editor">
          <div className="form">
            <label>Subject<input value={draft.subject} onChange={(e) => setDraft({ subject: e.target.value })} /></label>
            <label>Body
              <textarea ref={bodyRef} className="template-body" rows="26" value={draft.body} onChange={(e) => setDraft({ body: e.target.value })} spellCheck />
            </label>
            {unknown.length > 0 && <p className="error small">Not recognised: {unknown.map((k) => `{{${k}}}`).join(", ")}. Check the spelling, or pick from the list.</p>}
            <div className="placeholders">
              <span className="muted small">Click to insert at the cursor:</span>
              {groups.map((g) => (
                <div key={g} className="ph-group">
                  <span className="ph-group-name">{g}</span>
                  {PLACEHOLDERS.filter((p) => p.group === g).map((p) => (
                    <button key={p.key} type="button" className={`ph-chip ${used.has(p.key) ? "used" : ""}`} title={p.label} onClick={() => insert(p.key)}>{p.key}</button>
                  ))}
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => confirm("Replace this email with the original wording? Unsaved edits are lost.") && setDraft({ ...DEFAULT_TEMPLATES[key] })}>Reset to original</button>
              <button disabled={!dirty} onClick={() => setDraft({ subject: saved.subject, body: saved.body })}>Undo changes</button>
              <button className="primary" disabled={!dirty} onClick={saveTemplate}>{dirty ? "Save email" : "Saved"}</button>
            </div>
            {saved.updated_at && <p className="muted small">Last saved {fmtStamp(saved.updated_at)}{saved.updated_by ? ` by ${saved.updated_by}` : ""}.</p>}
          </div>

          <div className="preview-col">
            <div className="preview-head">
              <label>Preview with
                <select value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
                  {data.circles.map((c) => <option key={c.id} value={c.id}>{c.name} ({STATUS_LABEL[c.status]})</option>)}
                </select>
              </label>
              <button disabled={!previewId || sending} onClick={sendTest} title="Sends this version (saved or not) to your own email">{sending ? "Sending…" : "Send test to me"}</button>
            </div>
            {missing.length > 0 && (
              <p className="small warn-text">Nothing set for this circle: {missing.map(placeholderLabel).join(", ")}. These lines will say "to follow".</p>
            )}
            {previewCircle && previewCircle.status !== "live" && (
              <p className="muted small">Zoom link, meeting ID, passcode and exact first date are filled in when the circle is approved.</p>
            )}
            {previewCircle ? <EmailPreview template={draft} circle={previewCircle} data={previewData} /> : <p className="muted">Add a circle to preview.</p>}
          </div>
        </div>
      </section>
    </>
  );
}

// Approving: ask for the circle's WhatsApp group and YouTube playlist (created for each circle at this point),
// and make sure the approving admin has a name to sign the email with.
function ApproveDialog({ circle, data, run, onBusy, onClose }) {
  const [wa, setWa] = useState(circle.whatsapp_group_link ?? "");
  const [yt, setYt] = useState(circle.youtube_playlist_link ?? "");
  const [name, setName] = useState(data.me?.name ?? "");
  const [busy, setBusy] = useState(false);
  const licence = data.licences.find((l) => l.id === circle.licence_id);
  const badUrl = (v) => v.trim() && !/^https?:\/\/\S+$/i.test(v.trim());
  const draft = { ...circle, whatsapp_group_link: wa.trim() || null, youtube_playlist_link: yt.trim() || null };
  const gaps = emailGaps(draft, { ...data, me: { ...data.me, name: name.trim() } });
  const otherGaps = gaps.filter((k) => !["whatsapp_group_link", "youtube_playlist_link"].includes(k));

  async function approve(e) {
    e.preventDefault();
    if (badUrl(wa) || badUrl(yt) || !name.trim()) return;
    if ((!wa.trim() || !yt.trim()) && !confirm(`${!wa.trim() ? "No WhatsApp group" : "No YouTube playlist"} yet. The email will say "to follow" there. Approve anyway?`)) return;
    setBusy(true);
    onBusy?.(true);
    const ok = await run(async () => {
      if (name.trim() !== (data.me?.name ?? "")) {
        const { error } = await supabase.from("admin_emails").update({ name: name.trim() }).eq("email", data.me.email);
        if (error) throw error;
      }
      const { error } = await supabase.from("circles")
        .update({ whatsapp_group_link: wa.trim() || null, youtube_playlist_link: yt.trim() || null }).eq("id", circle.id);
      if (error) throw error;
      return adminAction("provision", circle.id);
    }, (o) => withEmail(`${o.mock ? "Mock meeting" : "Zoom meeting"} created.${INVITE_NOTE[o.invite] ?? (o.invite ? ` Invite: ${o.invite}.` : "")}`, o.email, circle.facilitator?.email));
    setBusy(false);
    onBusy?.(false);
    if (ok) onClose();
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <form className="card modal approve-modal" onClick={(e) => e.stopPropagation()} onSubmit={approve}>
        <h2>Approve {circle.name}</h2>
        <p className="muted small">
          Creates the weekly Zoom meeting on {licence?.label ?? "its licence"}{licence?.is_mock ? " (mock)" : ""} and emails{" "}
          {circle.facilitator?.name || "the facilitator"} their details.
        </p>
        <label>WhatsApp group link
          <input type="url" autoFocus value={wa} onChange={(e) => setWa(e.target.value)} placeholder="https://chat.whatsapp.com/…" />
        </label>
        {badUrl(wa) && <p className="error small">That doesn't look like a link. It should start with https://</p>}
        <label>YouTube playlist link
          <input type="url" value={yt} onChange={(e) => setYt(e.target.value)} placeholder={data.settings.youtube_playlist_link || "https://youtube.com/playlist?list=…"} />
        </label>
        {badUrl(yt) && <p className="error small">That doesn't look like a link. It should start with https://</p>}
        <label>Email signed by
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        </label>
        <p className="muted small">Saved as your name for future emails. Change it any time under Settings → Admins.</p>
        {otherGaps.length > 0 && (
          <p className="small warn-text">Also not set: {otherGaps.map(placeholderLabel).join(", ")}. Those lines will say "to follow".</p>
        )}
        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || badUrl(wa) || badUrl(yt) || !name.trim()}>{busy ? "Creating…" : "Approve + create Zoom"}</button>
        </div>
      </form>
    </div>
  );
}

function AdminName({ admin, run, onSaved }) {
  const [name, setName] = useState(admin.name ?? "");
  const dirty = name.trim() !== (admin.name ?? "");
  return (
    <span className="inline">
      <input value={name} placeholder="Name (signs emails)" onChange={(e) => setName(e.target.value)} />
      {dirty && (
        <button onClick={() => run(async () => {
          const { error } = await supabase.from("admin_emails").update({ name: name.trim() || null }).eq("email", admin.email);
          if (error) throw error;
          onSaved?.();
        }, "Name saved")}>Save</button>
      )}
    </span>
  );
}

/* ---------------- Zoom (what's actually booked in Zoom) ---------------- */
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function ZoomMeetings({ data, run, onSelect, onAttendance, initialAccount }) {
  const [snap, setSnap] = useState(undefined); // undefined = loading, null = never synced
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState(initialAccount ?? "all");
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState("all");

  const loadLatest = useCallback(async () => {
    const { data: rows } = await supabase.from("audit_log").select("at, actor, detail")
      .eq("action", "zoom_meetings_snapshot").order("at", { ascending: false }).limit(1);
    setSnap(rows?.[0] ?? null);
  }, []);
  useEffect(() => { loadLatest(); }, [loadLatest]);

  async function sync() {
    setSyncing(true);
    await run(() => adminAction("list_zoom_meetings"), (o) => {
      const n = o.accounts.reduce((t, a) => t + a.meetings.length, 0);
      return `Synced: ${n} meeting${n === 1 ? "" : "s"} across ${o.accounts.length} Zoom accounts`;
    });
    await loadLatest();
    setSyncing(false);
  }

  const accounts = snap?.detail?.accounts ?? [];
  const rows = useMemo(() => accounts.flatMap((a) => a.meetings.map((m) => ({
    ...m, account: a.label, account_email: a.email, account_active: a.active,
    weekly: m.type === "weekly/recurring", ours: Boolean(m.circle),
    when: m.next ?? m.start_time ?? null,
  }))).sort((x, y) => x.account.localeCompare(y.account, undefined, { numeric: true }) || String(x.when ?? "~").localeCompare(String(y.when ?? "~"))), [snap]);

  const shown = rows.filter((r) =>
    (account === "all" || r.account === account) &&
    (kind === "all" || (kind === "weekly" ? r.weekly : !r.weekly)) &&
    (source === "all" || (source === "ours" ? r.ours : !r.ours)) &&
    (!q || `${r.topic} ${r.account} ${r.account_email} ${r.circle ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  const weekly = rows.filter((r) => r.weekly).length;
  const ours = rows.filter((r) => r.ours).length;
  const outside = rows.length - ours;
  const errors = accounts.filter((a) => a.error);
  const outsideActive = rows.filter((r) => !r.ours && r.account_active).length;

  function exportCsv() {
    const head = ["Account", "Account email", "Meeting", "Type", "Repeats", "Next or start (UTC)", "Length (min)", "Meeting timezone", "Ends", "Sessions left", "Source", "Circle", "Zoom meeting ID"];
    const lines = shown.map((r) => [r.account, r.account_email, r.topic, r.weekly ? "Weekly" : r.type, r.repeats ?? "", r.when ?? "", r.duration ?? "",
      r.timezone ?? "", r.ends ?? "", r.sessions_left ?? "", r.ours ? "Circle" : "Other Zoom meeting", r.circle ?? "", r.id].map(csvCell).join(","));
    const blob = new Blob(["\uFEFF" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zoom-meetings-${(snap?.at ?? new Date().toISOString()).slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const openCircle = (r) => {
    const c = data.circles.find((x) => String(x.zoom_meeting_id) === String(r.id));
    if (c) onSelect(c);
  };

  return (
    <section className="card zoom-tab">
      <div className="card-head">
        <div>
          <h2>Meetings on Zoom</h2>
          <p className="muted small zoom-synced">
            {snap === undefined ? "Loading…" : snap
              ? <>Last synced <b>{ago(snap.at)}</b> · {fmtStamp(snap.at)} · by {snap.actor}</>
              : "Not synced yet."}
          </p>
        </div>
        <div className="filters">
          <button disabled={!shown.length} onClick={exportCsv} title="Downloads a CSV of the meetings in the table below">
            {shown.length === rows.length ? "Export all (CSV)" : `Export filtered: ${shown.length} of ${rows.length} (CSV)`}
          </button>
          <button className="primary" disabled={syncing} onClick={sync}>{syncing ? "Syncing…" : "Sync now"}</button>
        </div>
      </div>

      {snap === null && (
        <div className="empty">
          <p>See every meeting booked on your Zoom accounts, including ones set up directly in Zoom, so nothing clashes with new circles.</p>
          <p className="muted small">Needs the Zoom app scope <code>meeting:read:list_meetings:admin</code>.</p>
        </div>
      )}

      {snap && (
        <>
          <div className="stats zoom-stats">
            <Stat label="Weekly series" value={weekly} onClick={() => { setKind("weekly"); setSource("all"); }} />
            <Stat label="One-off meetings" value={rows.length - weekly} onClick={() => { setKind("oneoff"); setSource("all"); }} />
            <Stat label="Circles (made in this dashboard)" value={ours} tone="live" onClick={() => { setSource("ours"); setKind("all"); }} />
            <Stat label="Other Zoom meetings" value={outside} tone={outside ? "warn" : undefined} onClick={() => { setSource("outside"); setKind("all"); }} />
          </div>
          {outsideActive > 0 && (
            <p className="hint">{outsideActive} meeting{outsideActive > 1 ? "s were" : " was"} set up directly in Zoom on active licences. The clash checks don't know about {outsideActive > 1 ? "them" : "it"}, so a new circle could be booked over {outsideActive > 1 ? "them" : "it"}. Filter by "Other Zoom meetings" to review.</p>
          )}
          {errors.length > 0 && (
            <p className="error small">Couldn't read {errors.map((a) => a.label).join(", ")}: {errors[0].error}</p>
          )}

          <div className="zoom-accounts">
            {accounts.map((a) => {
              const n = a.meetings.length;
              const w = a.meetings.filter((m) => m.type === "weekly/recurring").length;
              const out = a.meetings.filter((m) => !m.circle).length;
              return (
                <button key={a.email} className={`zoom-acc ${account === a.label ? "on" : ""} ${a.active ? "" : "inactive"}`}
                  onClick={() => setAccount(account === a.label ? "all" : a.label)} title={a.email}>
                  <span className="za-label">{a.label}</span>
                  <span className="za-count">{a.error ? "!" : n}</span>
                  <span className="za-sub">{a.error ? "error" : n ? `${w} weekly${out ? ` · ${out} not circles` : ""}` : "free"}{a.active ? "" : " · inactive"}</span>
                </button>
              );
            })}
          </div>

          <div className="zoom-filters">
            <input type="search" placeholder="Search meeting, account or circle…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="seg">
              {[["all", "All"], ["weekly", "Weekly"], ["oneoff", "One-off"]].map(([k, l]) => <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{l}</button>)}
            </div>
            <div className="seg">
              {[["all", "All meetings"], ["ours", "Circles"], ["outside", "Other Zoom meetings"]].map(([k, l]) => <button key={k} className={source === k ? "active" : ""} onClick={() => setSource(k)}>{l}</button>)}
            </div>
            {(account !== "all" || kind !== "all" || source !== "all" || q) && (
              <button className="link small" onClick={() => { setAccount("all"); setKind("all"); setSource("all"); setQ(""); }}>Clear filters</button>
            )}
          </div>

          <div className="table-wrap">
            <table className="table zoom-table">
              <thead><tr><th>Meeting</th><th>Account</th><th>Repeats</th><th>Next session</th><th>Length</th><th>Ends</th><th>Source</th>{onAttendance && <th></th>}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.account}-${r.id}`} className={r.ours || onAttendance ? "clickable" : ""}
                    title={r.ours ? "Open the circle" : onAttendance ? "See who attended" : undefined}
                    onClick={() => (r.ours ? openCircle(r) : onAttendance?.(r.id))}>
                    <td><div className="zt-topic">{r.topic}<span className="muted small">ID {r.id}</span></div></td>
                    <td>{r.account}{!r.account_active && <span className="muted small"> (inactive)</span>}</td>
                    <td>{r.weekly ? (r.repeats ?? "Weekly").replace(/^weekly/, "Weekly") : "One-off"}</td>
                    <td>{fmtWhen(r.when) || "–"}</td>
                    <td>{r.duration ? `${r.duration} min` : "–"}</td>
                    <td className="small">{r.ends ? (String(r.ends).startsWith("after") ? r.ends : fmtDate(String(r.ends).slice(0, 10))) : r.weekly ? "–" : ""}{r.sessions_left ? <span className="muted"> · {r.sessions_left} left</span> : null}</td>
                    <td>{r.ours ? <span className="pill st-live">Circle</span> : <span className="pill st-pending">Not a circle</span>}</td>
                    {onAttendance && <td><button className="link small nowrap" onClick={(e) => { e.stopPropagation(); onAttendance(r.id); }}>Attendance →</button></td>}
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={onAttendance ? 8 : 7} className="muted">{rows.length ? "No meetings match these filters." : "No scheduled meetings on any account."}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small">Times are UK time. Click a circle to open it, or another meeting to see its attendance. Export includes every account unless you filter.</p>
        </>
      )}
    </section>
  );
}

/* ---------------- Attendance ---------------- */
// Shared definitions (Attendance and Insights use the same ones).
const DRIFT_SESSIONS = 3;  // "dropped off": missed this many sessions in a row (Insights: weeks)...
const DROP_MIN_VISITS = 3; // ...after coming at least this many times
const REGULAR_SESSIONS = 4; // "regular": came to at least this many sessions
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

// One circle's sessions and people, from raw rows.
function buildCircle(sessions, rowsBySession) {
  const ordered = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const people = new Map();
  ordered.forEach((s, i) => {
    for (const r of rowsBySession.get(s.id) ?? []) {
      const p = people.get(r.person_key) ?? { key: r.person_key, name: r.name, email: r.email, attended: new Map(), lastIdx: -1 };
      p.attended.set(s.id, r.minutes);
      p.lastIdx = Math.max(p.lastIdx, i);
      if (!p.name && r.name) p.name = r.name;
      if (!p.email && r.email) p.email = r.email;
      people.set(r.person_key, p);
    }
  });
  const list = [...people.values()].map((p) => ({
    ...p,
    count: p.attended.size,
    missedSince: ordered.length - 1 - p.lastIdx,
    drifting: p.attended.size >= DROP_MIN_VISITS && ordered.length - 1 - p.lastIdx >= DRIFT_SESSIONS,
    lastSeen: ordered[p.lastIdx]?.started_at,
  })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  return { sessions: ordered, people: list };
}

function HeadcountBars({ sessions, max, compact }) {
  const top = Math.max(1, max ?? Math.max(...sessions.map((s) => s.participant_count), 1));
  return (
    <div className={`hc-bars ${compact ? "compact" : ""}`} role="img"
      aria-label={`Headcount per session: ${sessions.map((s) => `${shortDate(s.started_at)} ${s.participant_count}`).join(", ")}`}>
      {sessions.map((s, i) => (
        <Hover key={s.id} content={<div><b>{fmtWhen(s.started_at)}</b><div>{s.participant_count} attended</div></div>}>
          <span className="hc-col" tabIndex={compact ? -1 : 0}>
            {!compact && i === sessions.length - 1 && <span className="hc-val">{s.participant_count}</span>}
            <span className="hc-bar" style={{ height: `${Math.max(4, (s.participant_count / top) * 100)}%` }} />
            {!compact && <span className="hc-date">{shortDate(s.started_at)}</span>}
          </span>
        </Hover>
      ))}
    </div>
  );
}

// Stacked headcount per session: people returning (bottom) and people there for the first time (top).
function NewReturningBars({ sessions, rowsBySession }) {
  const seen = new Set();
  const cols = sessions.map((s) => {
    const rows = rowsBySession.get(s.id) ?? [];
    let fresh = 0;
    for (const r of rows) if (!seen.has(r.person_key)) { fresh++; seen.add(r.person_key); }
    return { s, total: rows.length, fresh, back: rows.length - fresh };
  });
  const top = Math.max(1, ...cols.map((c) => c.total));
  return (
    <div>
      <div className="viz-legend">
        <span><i className="sw sw-back" /> Returning</span>
        <span><i className="sw sw-new" /> First time</span>
      </div>
      <div className="hc-bars nr-bars" role="img"
        aria-label={`Attendance per session: ${cols.map((c) => `${shortDate(c.s.started_at)} ${c.total} (${c.fresh} new)`).join(", ")}`}>
        {cols.map((c, i) => (
          <Hover key={c.s.id} content={<div><b>{fmtWhen(c.s.started_at)}</b><div>{c.total} attended</div><div>{c.back} returning · {c.fresh} first time</div></div>}>
            <span className="hc-col" tabIndex={0}>
              {i === cols.length - 1 && <span className="hc-val">{c.total}</span>}
              <span className="nr-stack" style={{ height: `${Math.max(4, (c.total / top) * 100)}%` }}>
                {c.fresh > 0 && <span className="nr-seg nr-new" style={{ flexGrow: c.fresh }} />}
                {c.back > 0 && <span className="nr-seg nr-back" style={{ flexGrow: c.back }} />}
                {!c.total && <span className="nr-seg nr-zero" style={{ flexGrow: 1 }} />}
              </span>
              <span className="hc-date">{shortDate(c.s.started_at)}</span>
            </span>
          </Hover>
        ))}
      </div>
    </div>
  );
}

// Who came when: one row per person, one column per week, shaded by how many sessions they joined that week.
const HEAT_WEEKS = 30;
function weekStart(iso) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// Month names above the week columns, at most one every 3 columns so they never overlap.
function monthLabels(weeks) {
  let last = -9;
  return weeks.map((w, i) => {
    const starts = i === 0 || w.getMonth() !== weeks[i - 1].getMonth();
    if (!starts || i - last < 3) return "";
    last = i;
    return w.toLocaleDateString([], { month: "short" });
  });
}
function PeopleHeatmap({ sessions, rowsBySession, nameFor }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);
  const [tip, setTip] = useState(null);
  const model = useMemo(() => {
    if (!sessions.length) return null;
    const ordered = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const lastWeek = weekStart(ordered.at(-1).started_at);
    let firstWeek = weekStart(ordered[0].started_at);
    const minWeek = new Date(lastWeek); minWeek.setDate(minWeek.getDate() - 7 * (HEAT_WEEKS - 1));
    if (firstWeek < minWeek) firstWeek = minWeek;
    const weeks = [];
    for (const d = new Date(firstWeek); d <= lastWeek; d.setDate(d.getDate() + 7)) weeks.push(new Date(d));
    const idx = new Map(weeks.map((w, i) => [w.getTime(), i]));
    const people = new Map();
    for (const s of ordered) {
      const wi = idx.get(weekStart(s.started_at).getTime());
      if (wi == null) continue;
      for (const r of rowsBySession.get(s.id) ?? []) {
        const p = people.get(r.person_key) ?? { key: r.person_key, name: r.name, email: r.email, total: 0, last: null, cells: new Map() };
        if (!p.cells.has(wi)) p.cells.set(wi, []);
        p.cells.get(wi).push({ s, minutes: r.minutes });
        p.total++;
        p.last = s.started_at;
        if (!p.name && r.name) p.name = r.name;
        if (!p.email && r.email) p.email = r.email;
        people.set(r.person_key, p);
      }
    }
    const list = [...people.values()].sort((a, b) => b.total - a.total || String(a.last).localeCompare(String(b.last)) * -1);
    return { weeks, list };
  }, [sessions, rowsBySession]);

  if (!model) return <p className="muted">No sessions in this view.</p>;
  const term = q.trim().toLowerCase();
  const filtered = term ? model.list.filter((p) => `${p.name ?? ""} ${p.email ?? ""} ${p.key}`.toLowerCase().includes(term)) : model.list;
  const rows = filtered.slice(0, limit);
  const cols = `minmax(150px, 230px) 44px repeat(${model.weeks.length}, 14px)`;

  const onOver = (e) => {
    const el = e.target.closest?.("[data-cell]");
    if (!el) return setTip(null);
    const [pi, wi] = el.dataset.cell.split(":").map(Number);
    const p = rows[pi];
    const items = p?.cells.get(wi) ?? [];
    const r = el.getBoundingClientRect();
    setTip({
      top: r.bottom + 8 + 160 > window.innerHeight ? r.top - 8 : r.bottom + 8, above: r.bottom + 8 + 160 > window.innerHeight,
      left: Math.min(r.left, window.innerWidth - 300),
      content: (
        <div>
          <b>{p.name || p.key}</b>
          <div className="muted small">Week of {shortDate(model.weeks[wi])}</div>
          {items.length ? items.map(({ s, minutes }) => <div key={s.id}>{fmtWhen(s.started_at)} · {nameFor(s)} · {minutes} min</div>) : <div>Didn't attend</div>}
        </div>
      ),
    });
  };

  return (
    <div className="heat">
      <div className="heat-tools">
        <input className="heat-search" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="viz-legend">
          <span>Sessions that week:</span>
          <span><i className="sw heat-0" /> 0</span>
          <span><i className="sw heat-1" /> 1</span>
          <span><i className="sw heat-2" /> 2</span>
          <span><i className="sw heat-3" /> 3+</span>
        </div>
      </div>
      <div className="heat-scroll" onMouseOver={onOver} onMouseLeave={() => setTip(null)}
        role="img" aria-label={`Weekly attendance for ${filtered.length} people over ${model.weeks.length} weeks. Use the export for the full table.`}>
        <div className="heat-row heat-head" style={{ gridTemplateColumns: cols }}>
          <span className="heat-name">Person</span><span className="heat-total">Total</span>
          {monthLabels(model.weeks).map((label, i) => <span key={i} className="heat-month">{label}</span>)}
        </div>
        {rows.map((p, pi) => (
          <div key={p.key} className="heat-row" style={{ gridTemplateColumns: cols }}>
            <span className="heat-name" title={p.email ?? ""}>{p.name || p.key}</span>
            <span className="heat-total">{p.total}</span>
            {model.weeks.map((_, wi) => {
              const n = p.cells.get(wi)?.length ?? 0;
              return <span key={wi} data-cell={`${pi}:${wi}`} className={`heat-cell heat-${Math.min(n, 3)}`} />;
            })}
          </div>
        ))}
        {!rows.length && <p className="muted small">Nobody matches.</p>}
      </div>
      {filtered.length > rows.length && (
        <button className="link small" onClick={() => setLimit((l) => l + 100)}>Show more ({filtered.length - rows.length} more people)</button>
      )}
      <p className="muted small">Most regular first. Covers the latest {model.weeks.length} weeks in this view. Hover a square for the sessions.</p>
      {tip && (
        <div className="hovercard" role="tooltip" style={{ top: tip.top, left: tip.left, transform: tip.above ? "translateY(-100%)" : undefined }}>
          {tip.content}
        </div>
      )}
    </div>
  );
}

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

// Who is who. Zoom only gives an email for people signed in to Zoom, so most people are matched by
// display name. Names are tidied so small differences still match: case, spacing, "(she/her)",
// "(Host)", emoji, and device names like "Priya's iPhone". Licence host accounts are left out.
const DEVICE = /\b(?:iphone|ipad|android|galaxy|samsung|pixel|oneplus|huawei|xiaomi|redmi|oppo|vivo|phone|mobile|tablet|laptop|macbook(?: pro| air)?|imac|desktop|pc|zoom user)\b(?:\s*(?:[a-z]{0,2}\d+\w*|pro|max|plus|ultra|mini|lite))*/g;
function personName(raw) {
  const tidy = String(raw ?? "").toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")      // (she/her), [Host], {guest}
    .replace(/[’`]/g, "'")
    .replace(/'s\s+(?=\S)/g, " ")               // "priya's iphone" -> "priya iphone"
    .replace(DEVICE, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")          // emoji and symbols
    .replace(/\s+/g, " ").trim();
  return tidy || String(raw ?? "").toLowerCase().trim();
}
function cleanAttendance(sessions = [], rows = [], licences = []) {
  const hostEmails = new Set(licences.map((l) => String(l.zoom_user_email ?? "").toLowerCase()).filter(Boolean));
  const hostNames = new Set(licences.map((l) => personName(l.label)));
  const merged = new Map(); // session|person -> row
  for (const r of rows) {
    const email = String(r.email ?? "").toLowerCase();
    if (email && hostEmails.has(email)) continue;
    const name = personName(r.name ?? r.person_key);
    if (!email && hostNames.has(name)) continue;
    const key = email || name;
    const id = `${r.session_id}|${key}`;
    const cur = merged.get(id);
    if (cur) { cur.minutes += r.minutes ?? 0; if (!cur.email && email) cur.email = email; }
    else merged.set(id, { ...r, person_key: key, email: email || null, minutes: r.minutes ?? 0 });
  }
  const clean = [...merged.values()];
  const counts = new Map();
  for (const r of clean) counts.set(r.session_id, (counts.get(r.session_id) ?? 0) + 1);
  return { sessions: sessions.map((x) => ({ ...x, participant_count: counts.get(x.id) ?? 0 })), rows: clean };
}

function Attendance({ data, run, focus, onFocused, open, setOpen, onSelect }) {
  const [state, setState] = useState(null); // { sessions, rows, last }
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null); // { done, left } during a long back-fill
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [kind, setKind] = useState("all"); // all | circles | other
  const [view, setView] = useState("meetings"); // meetings | people
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [s, a, l] = await Promise.all([
      fetchAll(() => supabase.from("attendance_sessions").select("*").order("started_at").order("id")),
      fetchAll(() => supabase.from("attendance").select("session_id, person_key, name, email, minutes").order("id")),
      supabase.from("audit_log").select("at, actor, detail").eq("action", "sync_attendance").order("at", { ascending: false }).limit(1),
    ]);
    const clean = cleanAttendance(s.data, a.data, data.licences);
    setState({ ...clean, last: l.data?.[0] ?? null, error: s.error?.message ?? a.error?.message });
    return l.data?.[0] ?? null;
  }, [data.licences]);

  async function sync() {
    setSyncing(true);
    let more = true, total = 0, guard = 0;
    const problems = new Set();
    while (more && guard++ < 40) { // first sync back-fills up to six months, 60 sessions per call
      let out;
      try { out = await adminAction("sync_attendance"); } catch (e) { problems.add(e.message); break; }
      if (out.busy) { setNotice("A sync is already running (maybe in another tab). It carries on there; refresh in a minute to see the new data."); break; }
      (out.problems ?? []).forEach((p) => problems.add(p));
      total += out.sessions_added;
      more = out.more && out.sessions_added > 0;
      setProgress(more ? { done: total } : null);
    }
    setProgress(null);
    if (problems.size) setNotice(`Some Zoom data couldn't be read (it's retried on the next sync): ${[...problems].slice(0, 3).join("; ")}${problems.size > 3 ? ` and ${problems.size - 3} more` : ""}`);
    await load();
    setSyncing(false);
    return total;
  }

  // Load, then sync automatically if the last sync is over 12 hours old or a back-fill was left unfinished.
  useEffect(() => {
    load().then((last) => { if (!last || last.detail?.more || Date.now() - Date.parse(last.at) > 12 * 3600e3) sync(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const model = useMemo(() => {
    if (!state) return null;
    const rowsBySession = new Map();
    for (const r of state.rows) {
      if (!rowsBySession.has(r.session_id)) rowsBySession.set(r.session_id, []);
      rowsBySession.get(r.session_id).push(r);
    }
    const groups = new Map();
    for (const s of state.sessions) {
      const key = s.circle_id ?? `meeting:${s.zoom_meeting_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const circles = [...groups.entries()].map(([key, sessions]) => {
      const live = data.circles.find((c) => c.id === key);
      const built = buildCircle(sessions, rowsBySession);
      const recent = built.sessions.slice(-4);
      const lastS = sessions[sessions.length - 1];
      return {
        key, name: live?.name ?? lastS.circle_name ?? lastS.topic ?? `Zoom meeting ${sessions[0].zoom_meeting_id}`,
        status: live?.status, ours: !!lastS.circle_id, account: lastS.licence_label ?? "", ...built,
        avg: recent.length ? recent.reduce((t, s) => t + s.participant_count, 0) / recent.length : 0,
        drifting: built.people.filter((p) => p.drifting).length,
      };
    }).sort((a, b) => String(b.sessions.at(-1)?.started_at).localeCompare(String(a.sessions.at(-1)?.started_at)));
    const weekAgo = Date.now() - 7 * 86400e3, monthAgo = Date.now() - 28 * 86400e3;
    const lastMonth = state.sessions.filter((s) => Date.parse(s.started_at) > monthAgo);
    return {
      circles, rowsBySession,
      thisWeek: state.sessions.filter((s) => Date.parse(s.started_at) > weekAgo).length,
      avg: lastMonth.length ? lastMonth.reduce((t, s) => t + s.participant_count, 0) / lastMonth.length : 0,
      people: new Set(state.rows.map((r) => r.person_key)).size,
      drifting: circles.reduce((t, c) => t + c.drifting, 0),
    };
  }, [state, data.circles]);

  // Opened from "Meetings on Zoom": jump straight to that meeting's attendance.
  useEffect(() => {
    if (!focus || !model) return;
    const hit = model.circles.find((c) => c.sessions.some((x) => String(x.zoom_meeting_id) === focus));
    if (hit) { setOpen(hit.key, { replace: true }); setNotice(null); }
    else setNotice(`No attendance recorded yet for Zoom meeting ${focus}. It appears here after a session has finished and been synced.`);
    onFocused?.();
  }, [focus, model]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv(circles) {
    const head = ["Meeting", "Session date (UK)", "Session start (UTC)", "Person", "Email", "Minutes"];
    const lines = [];
    for (const c of circles) for (const s of c.sessions) for (const r of model.rowsBySession.get(s.id) ?? []) {
      lines.push([c.name, ukDate(s.started_at), s.started_at, r.name ?? r.person_key, r.email ?? "", r.minutes].map(csvCell).join(","));
    }
    const blob = new Blob(["\uFEFF" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${circles.length === 1 ? "circle-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!state || !model) return <section className="card"><p className="muted">Loading attendance… (the very first sync can take a few minutes; keep this tab open)</p></section>;
  // Accounts whose history isn't fully loaded yet (cursor more than 2 days behind).
  const lagging = data.licences.filter((l) => l.zoom_user_email && !l.is_mock && (!l.attendance_scanned_to || Date.parse(l.attendance_scanned_to) < Date.now() - 2 * 86400e3))
    .sort((a, b) => String(a.attendance_scanned_to ?? "").localeCompare(String(b.attendance_scanned_to ?? "")));
  const behind = lagging.length ? { label: lagging[0].label, upTo: lagging[0].attendance_scanned_to, count: lagging.length } : null;
  const circle = open ? model.circles.find((c) => c.key === open) : null;
  const shown = model.circles.filter((c) => kind === "all" || (kind === "circles" ? c.ours : !c.ours));
  const counts = { all: model.circles.length, circles: model.circles.filter((c) => c.ours).length, other: model.circles.filter((c) => !c.ours).length };

  const header = (
    <div className="card-head">
      <div>
        <h2>{circle ? <><button className="link" onClick={() => setOpen(null)}>Attendance</button> <span className="muted">/</span> {circle.name}</> : "Attendance"}</h2>
        {circle?.ours && data.circles.some((c) => c.id === circle.key) && (
          <button className="link small" onClick={() => onSelect(data.circles.find((c) => c.id === circle.key))}>Open circle details</button>
        )}
        <p className="muted small zoom-synced">
          {syncing ? (progress ? `Syncing with Zoom… ${progress.done} sessions added so far` : "Syncing with Zoom…") : state.last ? <>Last synced <b>{ago(state.last.at)}</b> · {fmtStamp(state.last.at)}</> : "Not synced yet."}
        </p>
      </div>
      <div className="filters">
        <button disabled={!state.rows.length} onClick={() => exportCsv(circle ? [circle] : shown)}>{circle ? "Export this meeting (CSV)" : kind === "all" ? "Export all (CSV)" : `Export ${kind === "circles" ? "circles" : "other meetings"} (CSV)`}</button>
        <button className="primary" disabled={syncing} onClick={sync}>{syncing ? "Syncing…" : "Sync now"}</button>
      </div>
    </div>
  );

  if (circle) {
    const people = onlyDrift ? circle.people.filter((p) => p.drifting) : circle.people;
    return (
      <section className="card attendance">
        {header}
        <div className="att-chart">
          <span className="section-title">Attendance per session</span>
          <NewReturningBars sessions={circle.sessions} rowsBySession={model.rowsBySession} />
        </div>
        <div className="att-people-head">
          <span className="section-title">People ({circle.people.length})</span>
          {circle.drifting > 0 && (
            <label className="check"><input type="checkbox" checked={onlyDrift} onChange={(e) => setOnlyDrift(e.target.checked)} /> Only people not seen in {DRIFT_SESSIONS}+ sessions ({circle.drifting})</label>
          )}
        </div>
        <div className="table-wrap">
          <table className="table att-grid">
            <thead>
              <tr>
                <th>Person</th><th>Attended</th><th>Last seen</th>
                {circle.sessions.map((s) => <th key={s.id} className="att-col" title={fmtWhen(s.started_at)}>{shortDate(s.started_at)}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.key}>
                  <td><div className="att-person">{p.name || p.key}{p.email && <span className="muted small">{p.email}</span>}</div></td>
                  <td>{p.count} of {circle.sessions.length} <span className="muted small">({Math.round((p.count / circle.sessions.length) * 100)}%)</span></td>
                  <td>{shortDate(p.lastSeen)}{p.drifting && <span className="pill small st-conflict">Not seen in {p.missedSince}</span>}</td>
                  {circle.sessions.map((s) => {
                    const mins = p.attended.get(s.id);
                    return <td key={s.id} className="att-cell" title={mins != null ? `${shortDate(s.started_at)}: ${mins} min` : `${shortDate(s.started_at)}: absent`}>
                      {mins != null ? <span className="att-yes" aria-label="attended">●</span> : <span className="att-no" aria-label="absent">·</span>}
                    </td>;
                  })}
                </tr>
              ))}
              {!people.length && <tr><td colSpan={3 + circle.sessions.length} className="muted">Nobody to show.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">● attended · absent. Most people are matched by their Zoom name (emails only come through for people signed in to Zoom). Small differences are ignored, like capitals, "(she/her)" or "Priya's iPhone", but a different name such as "Priya" and "Priya Shah" still shows as two people. Host accounts aren't counted.</p>
      </section>
    );
  }

  return (
    <section className="card attendance">
      {header}
      {state.error && <p className="error small">{state.error}</p>}
      {notice && <p className="banner small">{notice} <button className="link small" onClick={() => setNotice(null)}>Dismiss</button></p>}
      {behind && (
        <p className="banner small">
          Still catching up on history: loaded up to <b>{behind.upTo ? shortDate(behind.upTo) : "the start"}</b> on {behind.label}
          {behind.count > 1 ? ` and ${behind.count - 1} other account${behind.count > 2 ? "s" : ""}` : ""}. {syncing ? "Keep this tab open while it runs." : "Click Sync now to carry on."}
        </p>
      )}
      <div className="stats zoom-stats">
        <Stat label="Sessions in the last 7 days" value={model.thisWeek} />
        <Stat label="Average per session (4 weeks)" value={model.avg ? model.avg.toFixed(1) : "–"} />
        <Stat label="People seen" value={model.people} />
        <Stat label={`Dropped off (came ${DROP_MIN_VISITS}+ times, missed last ${DRIFT_SESSIONS})`} value={model.drifting} tone={model.drifting ? "warn" : undefined} />
      </div>
      {!model.circles.length ? (
        <div className="empty">
          <p>No sessions recorded yet. Attendance appears here once a meeting on one of the licence accounts has finished and been synced.</p>
          <p className="muted small">Needs a paid Zoom plan and the scopes <code>report:read:user:admin</code> and <code>report:read:list_meeting_participants:admin</code>.</p>
        </div>
      ) : (
        <>
        <div className="att-bar">
          <div className="seg">
            {[["all", "All meetings"], ["circles", "Circles"], ["other", "Other Zoom meetings"]].map(([k, label]) => (
              <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{label} ({counts[k]})</button>
            ))}
          </div>
          <div className="seg">
            {[["meetings", "By meeting"], ["people", "By person"]].map(([k, label]) => (
              <button key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
        </div>
        {view === "people" ? (
          <PeopleHeatmap sessions={shown.flatMap((c) => c.sessions)} rowsBySession={model.rowsBySession}
            nameFor={(sess) => { const c = shown.find((x) => x.sessions.includes(sess)); return c ? (c.ours ? blockName(c.name) : c.name) : ""; }} />
        ) : (
        <div className="table-wrap">
          <table className="table att-circles">
            <thead><tr><th>Meeting</th><th>Account</th><th>Sessions</th><th>Avg (last 4)</th><th>Last session</th><th>Recent headcount</th><th>Not seen lately</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const last = c.sessions.at(-1);
                return (
                  <tr key={c.key} className="clickable" onClick={() => { setOnlyDrift(false); setOpen(c.key); }}>
                    <td>{c.ours ? blockName(c.name) : c.name}{c.status && c.status !== "live" && <span className="muted small"> ({STATUS_LABEL[c.status]})</span>}{!c.ours && <span className="pill small att-outside">Not a circle</span>}</td>
                    <td className="muted small">{c.account}</td>
                    <td>{c.sessions.length}</td>
                    <td>{c.avg.toFixed(1)}</td>
                    <td>{shortDate(last.started_at)} · {last.participant_count}</td>
                    <td><HeadcountBars sessions={c.sessions.slice(-8)} compact /></td>
                    <td>{c.drifting ? <span className="pill small st-conflict">{c.drifting}</span> : <span className="muted">0</span>}</td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={7} className="muted">Nothing in this view.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
      <p className="muted small">Covers every meeting held on the licence accounts in the last six months (Zoom keeps reports that long), synced from Zoom's usage reports; refreshes automatically when you open this tab if the last sync is over 12 hours old. Rejoins are merged into one attendance. Click a meeting for its sessions and people.</p>
    </section>
  );
}

// ---------- Attendance insights ----------
// Weekly trends across meetings: growth, new people, how consistently people come back, and who has stopped.
const DROP_WEEKS = DRIFT_SESSIONS; // weekly view of the same rule
const weekKey = (iso) => weekStart(iso).getTime();
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

function WeekBars({ weeks, series, height = 140, fmtTip }) {
  const totals = weeks.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const top = Math.max(1, ...totals);
  const lastIdx = totals.reduce((li, t, i) => (t ? i : li), -1); // label the latest week that has data
  return (
    <div>
      {series.length > 1 && (
        <div className="viz-legend">{series.map((s) => <span key={s.key}><i className={`sw ${s.cls}`} /> {s.label}</span>)}</div>
      )}
      <div className="wk-bars" style={{ height }} role="img"
        aria-label={weeks.map((w, i) => `${shortDate(w)}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(", ")}`).join("; ")}>
        {weeks.map((w, i) => (
          <Hover key={i} content={<div><b>Week of {shortDate(w)}</b>{series.map((s) => <div key={s.key}>{s.label}: {s.values[i] ?? 0}</div>)}{fmtTip?.(i)}</div>}>
            <span className="wk-col" tabIndex={0}>
              {i === lastIdx && <span className="hc-val">{totals[i]}</span>}
              <span className="nr-stack wk-stack" style={{ height: `${totals[i] ? Math.max(3, (totals[i] / top) * 100) : 0}%` }}>
                {[...series].reverse().map((s) => (s.values[i] ? <span key={s.key} className={`nr-seg ${s.cls}`} style={{ flexGrow: s.values[i] }} /> : null))}
              </span>
            </span>
          </Hover>
        ))}
      </div>
      <div className="wk-axis">{monthLabels(weeks).map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

function RateLine({ weeks, values, sizes = [], height = 140 }) {
  const W = 600, H = height, pad = 6;
  const pts = values.map((v, i) => (v == null ? null : [pad + (i * (W - 2 * pad)) / Math.max(1, weeks.length - 1), H - pad - (v / 100) * (H - 2 * pad)]));
  let path = "", pen = false; // gaps (weeks too recent or with no newcomers) break the line
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    path += `${pen ? " L" : " M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    pen = true;
  }
  const last = [...values].reverse().find((v) => v != null);
  return (
    <div className="rate">
      <div className="rate-plot" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Return rate by week: ${values.map((v, i) => `${shortDate(weeks[i])} ${v ?? "n/a"}%`).join(", ")}`}>
          {[25, 50, 75].map((g) => <line key={g} x1="0" x2={W} y1={H - pad - (g / 100) * (H - 2 * pad)} y2={H - pad - (g / 100) * (H - 2 * pad)} className="rate-grid" />)}
          <path d={path} className="rate-line" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="rate-hits">
          {weeks.map((w, i) => (
            <Hover key={i} content={<div><b>New in week of {shortDate(w)}</b><div>{values[i] == null ? (sizes[i] ? "Too recent to tell" : "No first-timers") : `${values[i]}% of ${sizes[i]} came back within 4 weeks`}</div></div>}>
              <span className="rate-hit" tabIndex={0}>{pts[i] && <i style={{ top: `${(pts[i][1] / H) * 100}%` }} />}</span>
            </Hover>
          ))}
        </div>
        <span className="rate-y">100%</span><span className="rate-y0">0%</span>
      </div>
      <div className="wk-axis">{monthLabels(weeks).map((l, i) => <span key={i}>{l}</span>)}</div>
      {last != null && <p className="muted small">Latest full cohort: <b>{last}%</b> of first-timers came back within 4 weeks.</p>}
    </div>
  );
}

function Insights({ data, openMeeting, onSelect }) {
  const [raw, setRaw] = useState(null);
  const [kind, setKind] = useState("all");
  const [span, setSpan] = useState(26);
  const [meeting, setMeeting] = useState("all");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    (async () => {
      const [s, a] = await Promise.all([
        fetchAll(() => supabase.from("attendance_sessions").select("*").order("started_at").order("id")),
        fetchAll(() => supabase.from("attendance").select("session_id, person_key, name, email, minutes").order("id")),
      ]);
      setRaw({ ...cleanAttendance(s.data, a.data, data.licences), error: s.error?.message ?? a.error?.message });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!raw) return [];
    const m = new Map();
    for (const x of raw.sessions) {
      const key = x.circle_id ?? `meeting:${x.zoom_meeting_id}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(x);
    }
    return [...m.entries()].map(([key, sessions]) => {
      const live = data.circles.find((c) => c.id === key);
      const lastS = sessions[sessions.length - 1];
      const name = live?.name ?? lastS.circle_name ?? lastS.topic ?? `Zoom meeting ${lastS.zoom_meeting_id}`;
      return { key, sessions, ours: !!lastS.circle_id, name: lastS.circle_id ? blockName(name) : name, account: lastS.licence_label ?? "" };
    });
  }, [raw, data.circles]);

  const model = useMemo(() => {
    if (!raw) return null;
    const rowsBy = new Map();
    for (const r of raw.rows) { if (!rowsBy.has(r.session_id)) rowsBy.set(r.session_id, []); rowsBy.get(r.session_id).push(r); }
    const inKind = groups.filter((g) => kind === "all" || (kind === "circles" ? g.ours : !g.ours));
    const scoped = meeting === "all" ? inKind : inKind.filter((g) => g.key === meeting);
    const thisWeek = weekStart(new Date().toISOString());
    const weeks = [];
    for (let i = span - 1; i >= 0; i--) { const d = new Date(thisWeek); d.setDate(d.getDate() - 7 * i); weeks.push(d); }
    const idx = new Map(weeks.map((w, i) => [w.getTime(), i]));

    // Per person: which weeks they came (all history in scope, so "first time" is truly first).
    const people = new Map();
    const sessionsPerWeek = weeks.map(() => 0);
    for (const g of scoped) for (const x of g.sessions) {
      const wk = weekKey(x.started_at);
      const wi = idx.get(wk);
      if (wi != null) sessionsPerWeek[wi]++;
      for (const r of rowsBy.get(x.id) ?? []) {
        const p = people.get(r.person_key) ?? { weeks: new Set() };
        p.weeks.add(wk);
        people.set(r.person_key, p);
      }
    }
    const newPer = weeks.map(() => 0), backPer = weeks.map(() => 0), dropPer = weeks.map(() => 0);
    const returned = weeks.map(() => [0, 0]); // [came back within 4 weeks, newcomers]
    const buckets = { "1 week": 0, "2 to 3 weeks": 0, "4 to 7 weeks": 0, "8+ weeks": 0 };
    const nowKey = thisWeek.getTime();
    for (const p of people.values()) {
      const ws = [...p.weeks].sort((a, b) => a - b);
      const first = ws[0], last = ws[ws.length - 1];
      const inRange = ws.filter((w) => idx.has(w));
      for (const w of inRange) (w === first ? newPer : backPer)[idx.get(w)]++;
      if (inRange.length) {
        const n = inRange.length;
        buckets[n === 1 ? "1 week" : n <= 3 ? "2 to 3 weeks" : n <= 7 ? "4 to 7 weeks" : "8+ weeks"]++;
      }
      if (idx.has(first)) {
        const back = ws.some((w) => w > first && w <= first + 4 * 7 * 86400e3);
        returned[idx.get(first)][1]++;
        if (back) returned[idx.get(first)][0]++;
      }
      if (ws.length >= DROP_MIN_VISITS && (nowKey - last) / (7 * 86400e3) >= DROP_WEEKS && idx.has(last)) dropPer[idx.get(last)]++;
    }
    const fourAgo = nowKey - 4 * 7 * 86400e3;
    const returnRate = weeks.map((w, i) => (w.getTime() > fourAgo ? null : returned[i][1] ? pct(returned[i][0], returned[i][1]) : null));
    const active = weeks.map((_, i) => newPer[i] + backPer[i]);

    // Compare meetings.
    const compare = inKind.map((g) => {
      const ss = [...g.sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
      const counts = ss.map((x) => (rowsBy.get(x.id) ?? []).length);
      const avg = (arr) => (arr.length ? arr.reduce((t, n) => t + n, 0) / arr.length : null);
      const recent = avg(counts.slice(-4)), before = avg(counts.slice(-8, -4));
      const seen = new Map(); // person -> [first idx, last idx, count]
      ss.forEach((x, i) => { for (const r of rowsBy.get(x.id) ?? []) { const v = seen.get(r.person_key) ?? [i, i, 0]; v[1] = i; v[2]++; seen.set(r.person_key, v); } });
      let newRecent = 0, regulars = 0, dropped = 0;
      for (const [f, l, c] of seen.values()) {
        if (f >= ss.length - 4) newRecent++;
        if (c >= REGULAR_SESSIONS) regulars++;
        if (c >= DROP_MIN_VISITS && ss.length - 1 - l >= DRIFT_SESSIONS) dropped++;
      }
      const lastAt = ss.at(-1)?.started_at;
      return {
        key: g.key, name: g.name, ours: g.ours, account: g.account, sessions: ss.length, lastAt,
        recent, before, change: recent != null && before ? Math.round(((recent - before) / before) * 100) : null,
        people: seen.size, newRecent, regulars, regularShare: pct(regulars, seen.size), dropped,
        stale: lastAt && Date.now() - Date.parse(lastAt) > 21 * 86400e3,
      };
    });
    const sorters = {
      recent: (a, b) => (b.recent ?? -1) - (a.recent ?? -1),
      change: (a, b) => (b.change ?? -999) - (a.change ?? -999),
      new: (a, b) => b.newRecent - a.newRecent,
      regular: (a, b) => (b.regularShare ?? -1) - (a.regularShare ?? -1),
      dropped: (a, b) => b.dropped - a.dropped,
    };
    compare.sort(sorters[sort]);

    const sum = (arr, from, to) => arr.slice(from, to).reduce((t, n) => t + n, 0);
    return {
      cohortSizes: returned.map((r) => r[1]),
      weeks, sessionsPerWeek, newPer, backPer, dropPer, returnRate, active, buckets, compare, inKind,
      totalPeople: [...people.values()].filter((p) => [...p.weeks].some((w) => idx.has(w))).length,
      // Last 4 complete weeks (this week is still under way) vs the 4 before.
      new4: sum(newPer, -5, -1), newPrev4: sum(newPer, -9, -5),
      active4: Math.round(sum(active, -5, -1) / 4), activePrev4: Math.round(sum(active, -9, -5) / 4),
      drops: dropPer.reduce((t, n) => t + n, 0),
    };
  }, [raw, groups, kind, meeting, span, sort]);

  if (!raw || !model) return <section className="card"><p className="muted">Loading insights…</p></section>;
  const trend = (now, prev) => {
    if (!prev) return null;
    const d = Math.round(((now - prev) / prev) * 100);
    return <span className={`trend ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "■"} {Math.abs(d)}% vs previous 4 weeks</span>;
  };
  const bucketMax = Math.max(1, ...Object.values(model.buckets));
  const sortBtn = (k, label) => <button className={sort === k ? "link small on" : "link small"} onClick={() => setSort(k)}>{label}</button>;

  return (
    <section className="card insights">
      <div className="card-head">
        <div>
          <h2>Attendance insights</h2>
          <p className="muted small">Week by week, from the synced Zoom attendance</p>
        </div>
        <div className="filters">
          <select value={meeting} onChange={(e) => setMeeting(e.target.value)} aria-label="Meeting">
            <option value="all">All meetings in view</option>
            {model.inKind.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
          <div className="seg">
            {[[12, "12 weeks"], [26, "26 weeks"]].map(([n, l]) => <button key={n} className={span === n ? "active" : ""} onClick={() => setSpan(n)}>{l}</button>)}
          </div>
        </div>
      </div>
      {raw.error && <p className="error small">{raw.error}</p>}
      <div className="seg ins-kind">
        {[["all", "All meetings"], ["circles", "Circles"], ["other", "Other Zoom meetings"]].map(([k, l]) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => { setKind(k); setMeeting("all"); }}>{l}</button>
        ))}
      </div>

      <div className="stats zoom-stats">
        <Stat label="People each week (avg of last 4 full weeks)" value={model.active4} />
        <Stat label="New people (last 4 full weeks)" value={model.new4} />
        <Stat label={`People seen (${span} weeks)`} value={model.totalPeople} />
        <Stat label={`Dropped off (${span} weeks)`} value={model.drops} tone={model.drops ? "warn" : undefined} />
      </div>
      <div className="ins-trends small">
        <span>People each week: {trend(model.active4, model.activePrev4) ?? <span className="muted">not enough history</span>}</span>
        <span>New people: {trend(model.new4, model.newPrev4) ?? <span className="muted">not enough history</span>}</span>
      </div>

      <div className="ins-grid">
        <div className="ins-panel">
          <h3>Growth: people each week</h3>
          <p className="muted small">Different people who joined at least one session that week, split into first-timers and returners. The last bar is this week so far.</p>
          <WeekBars weeks={model.weeks} series={[
            { key: "back", label: "Returning", cls: "nr-back", values: model.backPer },
            { key: "new", label: "First time", cls: "nr-new", values: model.newPer },
          ]} fmtTip={(i) => <div className="muted">{model.sessionsPerWeek[i]} session{model.sessionsPerWeek[i] === 1 ? "" : "s"} held</div>} />
        </div>
        <div className="ins-panel">
          <h3>Do first-timers come back?</h3>
          <p className="muted small">Of the people who came for the first time each week, the share who came again within 4 weeks.</p>
          <RateLine weeks={model.weeks} values={model.returnRate} sizes={model.cohortSizes} />
        </div>
        <div className="ins-panel">
          <h3>Consistency</h3>
          <p className="muted small">How many different weeks each person came in the last {span} weeks.</p>
          <div className="hbars">
            {Object.entries(model.buckets).map(([label, n]) => (
              <div key={label} className="hbar-row">
                <span className="hbar-label">{label}</span>
                <span className="hbar-track">{n > 0 && <span className="hbar" style={{ width: `${(n / bucketMax) * 100}%` }} />}</span>
                <span className="hbar-val">{n} <span className="muted">({pct(n, model.totalPeople) ?? 0}%)</span></span>
              </div>
            ))}
          </div>
        </div>
        <div className="ins-panel">
          <h3>Drop-offs</h3>
          <p className="muted small">People who came {DROP_MIN_VISITS}+ times, then haven't been back for {DROP_WEEKS}+ weeks, shown in the week they were last seen.</p>
          <WeekBars weeks={model.weeks} series={[{ key: "drop", label: "Last seen this week", cls: "nr-drop", values: model.dropPer }]} height={110} />
        </div>
      </div>

      <div className="att-people-head">
        <span className="section-title">Compare meetings ({model.compare.length})</span>
        <span className="small muted">Sort: {sortBtn("recent", "Attendance")} · {sortBtn("change", "Growth")} · {sortBtn("new", "New people")} · {sortBtn("regular", "Regulars")} · {sortBtn("dropped", "Drop-offs")}</span>
      </div>
      <div className="table-wrap">
        <table className="table att-circles ins-compare">
          <thead><tr><th>Meeting</th><th>Avg (last 4)</th><th>vs previous 4</th><th>New (last 4)</th><th>Regulars</th><th>Dropped off</th><th>Last session</th></tr></thead>
          <tbody>
            {model.compare.map((c) => (
              <tr key={c.key} className="clickable" onClick={() => openMeeting(c.key)} title="Open in Attendance">
                <td>{c.name}<div className="muted small">{c.account}{c.stale ? " · no sessions for 3+ weeks" : ""}
                  {c.ours && data.circles.some((x) => x.id === c.key) && <> · <button className="link small" onClick={(e) => { e.stopPropagation(); onSelect(data.circles.find((x) => x.id === c.key)); }}>Circle details</button></>}</div></td>
                <td>{c.recent != null ? c.recent.toFixed(1) : "–"}</td>
                <td>{c.change == null ? <span className="muted">–</span> : <span className={`trend ${c.change > 0 ? "up" : c.change < 0 ? "down" : ""}`}>{c.change > 0 ? "▲" : c.change < 0 ? "▼" : "■"} {Math.abs(c.change)}%</span>}</td>
                <td>{c.newRecent}</td>
                <td>{c.regulars} <span className="muted small">({c.regularShare ?? 0}%)</span></td>
                <td>{c.dropped ? <span className="pill small st-conflict">{c.dropped}</span> : <span className="muted">0</span>}</td>
                <td>{c.lastAt ? shortDate(c.lastAt) : "–"}</td>
              </tr>
            ))}
            {!model.compare.length && <tr><td colSpan={7} className="muted">No meetings in this view.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small">Regulars came to {REGULAR_SESSIONS}+ sessions. People are matched by Zoom name (or email when signed in), so the same person under a very different name counts twice. Click a meeting to open its attendance.</p>
    </section>
  );
}
