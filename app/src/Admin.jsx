import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  supabase, adminAction, DAYS, DAY_NAMES, hhmm, toMin, endTime, STATUS_LABEL,
  ukDay, ukStart, ukWhen, localWhen, isUk, tzName, TIMEZONES, UK_TZ, fmtDate, circleMessage, REQUEST_TYPES, requestSummary,
} from "./lib.js";
import { Icon, IconButton, CopyButton, Hover } from "./ui.jsx";
import { PLACEHOLDERS, DEFAULT_TEMPLATES, buildVars, render, missingValues, unknownPlaceholders, usedPlaceholders } from "./emailTemplate.js";

const ACTIVE = ["pending", "approved", "live"];
const TABS = ["Overview", "Schedule", "Queue", "Circles", "Licences", "Requests", "Emails", "Settings"];
const APP_URL = window.location.href.split("#")[0];

// Approval email values still blank for a circle (Zoom details are filled in on approval).
function emailGaps(c, data) {
  const template = data.templates.approved;
  const vars = buildVars({ circle: c, facilitator: c.facilitator, licence: data.licences.find((l) => l.id === c.licence_id), settings: data.settings, appUrl: APP_URL });
  return missingValues(template, vars, { beforeApproval: true });
}
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

export default function Admin() {
  const [tab, setTab] = useState("Overview");
  const [day, setDay] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const [circles, licences, settings, requests, log, templates] = await Promise.all([
      supabase.from("circles").select("*, facilitator:facilitators(*), licence:licences(label,is_mock,host_key)").order("ref_weekday").order("ref_start_time"),
      supabase.from("licences").select("*").order("sort_order").order("label"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("change_requests").select("*, circle:circles(name)").order("created_at", { ascending: false }),
      supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(60),
      supabase.from("email_templates").select("*"),
    ]);
    const err = [circles, licences, settings, requests, log, templates].find((r) => r.error);
    if (err) setToast({ kind: "error", text: err.error.message });
    setData({
      circles: circles.data ?? [],
      licences: licences.data ?? [],
      settings: settings.data,
      requests: requests.data ?? [],
      log: log.data ?? [],
      templates: {
        approved: templates.data?.find((t) => t.key === "approved") ?? { key: "approved", ...DEFAULT_TEMPLATES.approved },
        updated: templates.data?.find((t) => t.key === "updated") ?? { key: "updated", ...DEFAULT_TEMPLATES.updated },
      },
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const notify = (kind, text) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 6000);
  };

  // Wraps an async action with refresh + toast.
  const run = async (fn, okText) => {
    try {
      const out = await fn();
      if (okText) notify("ok", typeof okText === "function" ? okText(out) : okText);
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
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {t}
            {t === "Queue" && queueCount > 0 && <span className="count">{queueCount}</span>}
            {t === "Requests" && openRequests > 0 && <span className="count">{openRequests}</span>}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === "Overview" && <Overview data={data} onDay={(d) => { setDay(d); setTab("Schedule"); }} onTab={setTab} />}
        {tab === "Schedule" && <Schedule data={data} day={day} setDay={setDay} onSelect={select} />}
        {tab === "Queue" && <Queue data={data} run={run} onSelect={select} />}
        {tab === "Circles" && <Circles data={data} onSelect={select} onNew={() => setSelected("new")} onDelete={deleteCircle} />}
        {tab === "Licences" && <Licences data={data} run={run} notify={notify} />}
        {tab === "Requests" && <Requests data={data} run={run} onSelect={(id) => select(data.circles.find((c) => c.id === id))} />}
        {tab === "Emails" && <Emails data={data} run={run} />}
        {tab === "Settings" && <Settings data={data} run={run} />}
      </main>
      {selected && (
        <CircleDrawer
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
function Overview({ data, onDay, onTab }) {
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
        <Stat label="Live circles" value={count("live")} onClick={() => onTab("Circles")} />
        <Stat label="Awaiting approval" value={count("pending")} onClick={() => onTab("Queue")} />
        <Stat label="Clashes to resolve" value={count("conflict")} tone={count("conflict") ? "warn" : ""} onClick={() => onTab("Queue")} />
        <Stat label="Open change requests" value={requests.filter((r) => r.status === "open").length} onClick={() => onTab("Requests")} />
        <Stat label="Licences without Zoom user" value={missingZoom} tone={missingZoom ? "warn" : ""} onClick={() => onTab("Licences")} />
      </div>

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
      how: "Licences tab: add each licensed Zoom user's email and host key, then Check with Zoom.",
      tab: "Licences",
    },
    {
      done: !active.some((l) => l.is_mock),
      what: "Turn off mock licences",
      how: "Mock licences create fake Zoom links. Untick Mock in the Licences tab before going live.",
      tab: "Licences",
    },
    {
      done: Boolean(settings.term_start && settings.term_end),
      what: "Set the term dates",
      how: "Settings tab: meetings repeat weekly between these dates.",
      tab: "Settings",
    },
    {
      done: !circles.some((c) => c.is_demo),
      what: "Clear the demo data",
      how: "Settings tab: Clear demo data.",
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
      {!todays.length && <p className="muted">No circles on {DAY_NAMES[day]}.</p>}
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
                      <span className="b-name">{c.name}</span>
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
  async function approveOne(c) {
    if (!confirmGaps([c], data)) return;
    setApproving(c.id);
    await run(() => adminAction("provision", c.id), (o) => `${o.mock ? "Mock meeting" : "Zoom meeting"} created. Invite: ${o.invite}. Email: ${o.email}`);
    setApproving(null);
  }
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
        await adminAction("provision", ready[i].id);
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false, name: ready[i].name, error: e.message });
      }
    }
    setBulk(null);
    const failed = results.filter((r) => !r.ok);
    await run(async () => {
      if (failed.length) throw new Error(`${failed.length} failed. First error (${failed[0].name}): ${failed[0].error}`);
    }, `${results.length} circles provisioned`);
  }

  return (
    <section className="card">
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
function Circles({ data, onSelect, onNew, onDelete }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
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
function CircleDrawer({ circle, data, run, onClose, onDelete, onOpen }) {
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
      const { error } = await supabase.from("facilitators").update({ name: form.facilitator_name || email, phone: form.phone || null }).eq("id", c.facilitator_id);
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
      if (Object.keys(patch).length) {
        await adminAction("reschedule", id, { patch });
        done.push("Zoom meeting moved, same link");
      }

      const newEmail = f.facilitator_email.trim().toLowerCase();
      if (newEmail && newEmail !== circle.facilitator?.email) {
        await adminAction("handover", id, { facilitator: { name: f.facilitator_name, email: newEmail } });
        done.push("handed over");
      } else if (circle.facilitator_id) {
        const { error: e2 } = await supabase.from("facilitators")
          .update({ name: f.facilitator_name || newEmail, phone: f.phone || null }).eq("id", circle.facilitator_id);
        if (e2) throw e2;
      }

      const hasAlt = f.alt_weekday && f.alt_start_time;
      const { error } = await supabase.from("circles").update({
        name: f.name, circle_type: f.circle_type || null, language: f.language || null, notes: f.notes || null,
        alt_weekday: hasAlt ? Number(f.alt_weekday) : null, alt_start_time: hasAlt ? f.alt_start_time : null,
        ...linkFields(),
      }).eq("id", id);
      if (error) throw error;
      return done;
    }, (done) => `Saved${done?.length ? `: ${done.join(", ")}` : ""}`);
    if (ok) onClose();
  }

  async function save() {
    if (live) return saveLive();
    const ok = await run(async () => {
      const facilitator_id = await linkFacilitator(circle, f);
      const hasAlt = f.alt_weekday && f.alt_start_time;
      const row = {
        name: f.name, facilitator_id, weekday: Number(f.weekday), start_time: f.start_time,
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
  const gaps = circle && ["pending", "conflict"].includes(circle.status) ? emailGaps(circle, data) : [];
  const signupDefault = (data.settings.participant_signup_link ?? "").replace(/\{circle_code\}/g, circle ? String(circle.id).slice(0, 8) : "{circle_code}");

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
    await run(() => adminAction("move_licence", circle.id, { licence_id: moveTo }), (o) => `Moved to ${o.licence}. New link sent to the facilitator.`);
    setBusy(false);
    setMoveTo("");
  }

  async function endOnDate() {
    if (!endDate) return;
    const now = endDate <= new Date().toISOString().slice(0, 10);
    if (!confirm(now ? `End "${circle.name}" now? This deletes its Zoom meeting.` : `Make ${fmtDate(endDate)} the last date for "${circle.name}"? Sessions until then carry on with the same link.`)) return;
    setBusy(true);
    const ok = await run(() => adminAction("end_on", circle.id, { date: endDate }), now ? "Circle ended" : `Circle now ends on ${fmtDate(endDate)}`);
    setBusy(false);
    if (ok && now) onClose();
  }

  // Approve straight from the drawer; it stays open and switches to the live Zoom details.
  async function approve() {
    if (!confirmGaps([circle], data)) return;
    setBusy(true);
    await run(() => adminAction("provision", circle.id),
      (o) => `${o.mock ? "Mock meeting" : "Zoom meeting"} created. Invite: ${o.invite}. Email: ${o.email}`);
    setBusy(false);
  }
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
              <span className="small warn-text">Approval email has nothing for: {gaps.map(placeholderLabel).join(", ")}. Fill these in below or under Emails.</span>
            ) : (
              <span className="small muted">{circle.status === "live" ? "Facilitator email" : "Approval email is complete."}</span>
            )}
            <button className="link small" onClick={() => setShowEmail(!showEmail)}>{showEmail ? "Hide email" : "Preview email"}</button>
          </div>
        )}
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
              <button onClick={() => run(() => adminAction("resend", circle.id), (o) => `Email ${o.email}`)}>Resend details email</button>
              <button className="danger" onClick={() => confirm("Delete the Zoom meeting and end this circle?") && run(() => adminAction("cancel", circle.id), "Circle ended").then(onClose)}>End circle</button>
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

        {requests.length > 0 && (
          <div className="details">
            <span className="muted small">Change requests</span>
            {requests.map((r) => (
              <div key={r.id} className="small"><b>{r.status}</b> · {r.message}</div>
            ))}
          </div>
        )}

        <div className="form">
          <label>Circle name<input value={f.name} onChange={set("name")} disabled={!editable} /></label>
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
            <label>Participant sign-up link<input type="url" value={f.participant_signup_link} onChange={set("participant_signup_link")} placeholder={signupDefault || "Set a default under Emails"} /></label>
            <div className="grid2">
              <label>YouTube playlist<input type="url" value={f.youtube_playlist_link} onChange={set("youtube_playlist_link")} placeholder={data.settings.youtube_playlist_link || "Default from Emails"} /></label>
              <label>Drive folder<input type="url" value={f.drive_folder_link} onChange={set("drive_folder_link")} placeholder={data.settings.drive_folder_link || "Default from Emails"} /></label>
            </div>
            <p className="muted small">Leave sign-up, YouTube and Drive blank to use the defaults set under Emails.</p>
          </fieldset>
          <label>Notes<textarea rows="3" value={f.notes} onChange={set("notes")} disabled={!editable} /></label>
          {live && <p className="hint">Changing the day, time or length moves the existing Zoom meeting. The join link stays the same, and the facilitator is emailed the update.</p>}
          {editable && (
            <button className="primary wide" disabled={!f.name} onClick={save}>
              {isNew ? "Add circle" : circle.status === "rejected" ? "Save and put back in queue" : "Save changes"}
            </button>
          )}
        </div>

        {circle && (
          <div className="drawer-foot">
            <span className="muted small">Source: {circle.source} · created {new Date(circle.created_at).toLocaleString()}</span>
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

/* ---------------- Licences ---------------- */
function Licences({ data, run, notify }) {
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

  async function saveAll() {
    await run(async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        const { error } = await supabase.from("licences").update({
          label: r.label, zoom_user_email: r.zoom_user_email ? r.zoom_user_email.trim().toLowerCase() : null,
          host_key: r.host_key || null, zoom_password: r.zoom_password || null, active: r.active, is_mock: r.is_mock,
        }).eq("id", r.id);
        if (error) throw error;
      }
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
          <button onClick={() => run(() => adminAction("sync_licences"), (o) => o.results.map((r) => `${r.label}: ${r.ok ? (r.licensed ? "ok" : "found, but not a licensed user") : r.error}`).join(" · ") || "No licences have a Zoom email yet")}>Check with Zoom</button>
          <button className="primary" disabled={!dirty} onClick={saveAll}>{dirty ? "Save changes" : "Saved"}</button>
        </div>
      </div>
      <p className="muted small">
        Each licence is one licensed Zoom user. Meetings are created under that user, and facilitators get its host key so they can claim host without a password.
        <b> Mock</b> is for testing only: approving a circle on a mock licence creates fake Zoom details.
      </p>
      <p className="muted small">
        <b>Login password</b> is only used if an email template includes {"{{zoom_password}}"}. Anyone with it can sign in to the whole licence,
        including other circles' meetings, so the host key is the safer option. Only admins can see it.
      </p>
      <div className="table-wrap">
        <table className="table edit">
          <thead><tr><th>Label</th><th>Zoom user email</th><th>Host key</th><th>Login password</th><th>Active</th><th>Mock</th><th>Booked</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r._dirty ? "dirty" : ""}>
                <td><input value={r.label} onChange={(e) => edit(r.id, "label", e.target.value)} /></td>
                <td><input value={r.zoom_user_email ?? ""} placeholder={r.is_mock ? "not needed for mock" : "zoom-user@…"} onChange={(e) => edit(r.id, "zoom_user_email", e.target.value)} /></td>
                <td><input value={r.host_key ?? ""} placeholder="6 digits" onChange={(e) => edit(r.id, "host_key", e.target.value)} /></td>
                <td><SecretInput value={r.zoom_password ?? ""} placeholder="optional" onChange={(v) => edit(r.id, "zoom_password", v)} /></td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => edit(r.id, "active", e.target.checked)} /></td>
                <td><input type="checkbox" checked={r.is_mock} onChange={(e) => edit(r.id, "is_mock", e.target.checked)} /></td>
                <td>{booked(r.id)}</td>
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
const today = () => new Date().toISOString().slice(0, 10);
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
    const { error: e2 } = await supabase.rpc("allocate_circle", { p_circle: c.id });
    if (e2) throw e2;
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
      await applyRequest(r, c);
      const { error } = await supabase.from("change_requests").update({ status: "done" }).eq("id", r.id);
      if (error) throw error;
    }, "Change applied and request marked done");
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
      <p className="card-sub">Most requests can be applied in one click. Pauses and other requests are handled by hand: use <b>Edit circle</b>, then mark the request done.</p>
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
                <div className="muted small">{r.requested_by} · {new Date(r.created_at).toLocaleString()} · <b>{r.status}</b></div>
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
        <div className="list">
          {admins.map((a) => (
            <div key={a.email} className="row">
              <div className="row-main">{a.email}</div>
              <div className="row-actions">
                <IconButton icon="trash" label={`Remove ${a.email}`} danger disabled={admins.length < 2}
                  title={admins.length < 2 ? "There must be at least one admin" : "Remove admin"}
                  onClick={() => confirm(`Remove ${a.email} as an admin?`) && run(async () => {
                    const { error } = await supabase.from("admin_emails").delete().eq("email", a.email);
                    if (error) throw error;
                    loadAdmins();
                  }, "Removed")} />
              </div>
            </div>
          ))}
        </div>
        <div className="inline">
          <input type="email" placeholder="email@…" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
          <button disabled={!newAdmin} onClick={() => run(async () => {
            const { error } = await supabase.from("admin_emails").insert({ email: newAdmin.trim().toLowerCase() });
            if (error) throw error;
            setNewAdmin("");
            loadAdmins();
          }, "Admin added. Invite them in Supabase Auth so they can sign in.")}>Add admin</button>
        </div>
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
            <div key={l.id} className={`log-row ${l.action.includes("failed") ? "warn-text" : ""}`}>
              <span className="muted small">{new Date(l.at).toLocaleString()}</span>
              <span><b>{l.action}</b> by {l.actor}</span>
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
function SecretInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <span className="secret">
      <input type={show ? "text" : "password"} autoComplete="new-password" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="link small" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
    </span>
  );
}

// Renders a template for one circle, marking anything not set yet.
function EmailPreview({ template, circle, data, compact }) {
  const licence = data.licences.find((l) => l.id === circle?.licence_id);
  const vars = buildVars({ circle: circle ?? {}, facilitator: circle?.facilitator, licence, settings: data.settings, appUrl: APP_URL });
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
  ["youtube_playlist_link", "YouTube playlist", "https://youtube.com/playlist?list=…"],
  ["drive_folder_link", "Google Drive folder", "https://drive.google.com/…"],
  ["participant_signup_link", "Participant sign-up link", "https://tally.so/r/…?circle={circle_code}"],
  ["support_contact", "Support contact", "e.g. circles@thinkgita.org or +44 …"],
  ["sender_name", "Sender name (signs the email)", "e.g. Niraj Mulji"],
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
  const previewVars = previewCircle && buildVars({ circle: previewCircle, facilitator: previewCircle.facilitator, licence: data.licences.find((l) => l.id === previewCircle.licence_id), settings: previewData.settings, appUrl: APP_URL });
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
        <p className="muted small">Used in every email. A circle can override the YouTube, Drive and sign-up links in its own drawer. WhatsApp groups are set per circle.</p>
        <div className="form grid2">
          {LINK_SETTINGS.map(([k, label, ph]) => (
            <label key={k}>{label}<input value={links[k] ?? ""} placeholder={ph} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} /></label>
          ))}
        </div>
        <p className="muted small">In the sign-up link, <code>{"{circle_code}"}</code> is replaced with each circle's short code, so sign-ups can be matched to the circle.</p>
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
            {used.has("zoom_password") && (
              <p className="hint">This email includes the licence login password. Anyone with it can sign in to the whole licence and other circles' meetings. <code>{"{{host_key}}"}</code> lets a facilitator take host of their own meeting without that access.</p>
            )}
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
            {saved.updated_at && <p className="muted small">Last saved {new Date(saved.updated_at).toLocaleString()}{saved.updated_by ? ` by ${saved.updated_by}` : ""}.</p>}
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
