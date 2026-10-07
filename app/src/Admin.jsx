import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, adminAction, DAYS, DAY_NAMES, hhmm, toMin, endTime, STATUS_LABEL,
  ukDay, ukStart, ukWhen, localWhen, isUk, tzName, TIMEZONES, UK_TZ, fmtDate, circleMessage, REQUEST_TYPES, requestSummary,
} from "./lib.js";
import { Icon, IconButton, CopyButton, Hover } from "./ui.jsx";

const ACTIVE = ["pending", "approved", "live"];
const TABS = ["Overview", "Schedule", "Queue", "Circles", "Licences", "Requests", "Settings"];

// "Wed 19:30–20:30" plus local time when the facilitator isn't in the UK.
function When({ c, block }) {
  return (
    <span className={block ? "when stacked" : "when"}>
      <span className="nowrap">{ukWhen(c)} <span className="muted small">UK</span></span>
      {!isUk(c) && <span className="local small nowrap">{localWhen(c)}</span>}
    </span>
  );
}

export default function Admin() {
  const [tab, setTab] = useState("Overview");
  const [day, setDay] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const [circles, licences, settings, requests, log] = await Promise.all([
      supabase.from("circles").select("*, facilitator:facilitators(*), licence:licences(label,is_mock,host_key)").order("ref_weekday").order("ref_start_time"),
      supabase.from("licences").select("*").order("sort_order").order("label"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("change_requests").select("*, circle:circles(name)").order("created_at", { ascending: false }),
      supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(60),
    ]);
    const err = [circles, licences, settings, requests, log].find((r) => r.error);
    if (err) setToast({ kind: "error", text: err.error.message });
    setData({
      circles: circles.data ?? [],
      licences: licences.data ?? [],
      settings: settings.data,
      requests: requests.data ?? [],
      log: log.data ?? [],
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
      return out;
    } catch (e) {
      notify("error", e.message ?? String(e));
      await load();
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
        {tab === "Settings" && <Settings data={data} run={run} />}
      </main>
      {selected && (
        <CircleDrawer
          circle={selected === "new" ? null : data.circles.find((c) => c.id === selected.id) ?? selected}
          data={data}
          run={run}
          onDelete={deleteCircle}
          onClose={() => setSelected(null)}
        />
      )}
      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
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
                      style={{ left: pos(s), width: `calc(${pos(s + c.duration_min)} - ${pos(s)})`, top, height: lane.warn ? 26 : undefined }}
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
        <button className="primary" disabled={!ready.length || bulk} onClick={provisionAll}>
          {bulk ? `Creating ${bulk.done + 1} of ${bulk.total}…` : `Approve all ready (${ready.length})`}
        </button>
      </div>
      {!items.length && <p className="muted">Nothing waiting. New Tally submissions appear here.</p>}
      <div className="list">
        {items.map((c) => (
          <div key={c.id} className={`row ${c.status === "conflict" ? "row-warn" : ""}`}>
            <div className="row-main" onClick={() => onSelect(c)}>
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
                <button className="primary" onClick={() => run(() => adminAction("provision", c.id), (o) => `${o.mock ? "Mock meeting" : "Zoom meeting"} created. Invite: ${o.invite}. Email: ${o.email}`)}>
                  Approve + create Zoom
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
function CircleDrawer({ circle, data, run, onClose, onDelete }) {
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
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tzOptions = TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES];

  // Live circles: details save directly; a new facilitator goes through handover (invite + email);
  // day/time/length/timezone changes move the existing Zoom meeting, so the link stays the same.
  async function saveLive() {
    await run(async () => {
      const id = circle.id;
      const hasAlt = f.alt_weekday && f.alt_start_time;
      const { error } = await supabase.from("circles").update({
        name: f.name, circle_type: f.circle_type || null, language: f.language || null, notes: f.notes || null,
        alt_weekday: hasAlt ? Number(f.alt_weekday) : null, alt_start_time: hasAlt ? f.alt_start_time : null,
      }).eq("id", id);
      if (error) throw error;

      const newEmail = f.facilitator_email.trim().toLowerCase();
      const done = [];
      if (newEmail && newEmail !== circle.facilitator?.email) {
        await adminAction("handover", id, { facilitator: { name: f.facilitator_name, email: newEmail } });
        done.push("handed over");
      } else if (circle.facilitator_id) {
        const { error: e2 } = await supabase.from("facilitators")
          .update({ name: f.facilitator_name || newEmail, phone: f.phone || null }).eq("id", circle.facilitator_id);
        if (e2) throw e2;
      }

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
      return done;
    }, (done) => `Saved${done?.length ? `: ${done.join(", ")}` : ""}`);
    onClose();
  }

  async function save() {
    if (live) return saveLive();
    await run(async () => {
      let facilitator_id = circle?.facilitator_id ?? null;
      if (f.facilitator_email) {
        const { data: fac, error } = await supabase.from("facilitators")
          .upsert({ email: f.facilitator_email.trim().toLowerCase(), name: f.facilitator_name || f.facilitator_email, phone: f.phone || null }, { onConflict: "email" })
          .select("id").single();
        if (error) throw error;
        facilitator_id = fac.id;
      }
      const hasAlt = f.alt_weekday && f.alt_start_time;
      const row = {
        name: f.name, facilitator_id, weekday: Number(f.weekday), start_time: f.start_time,
        alt_weekday: hasAlt ? Number(f.alt_weekday) : null, alt_start_time: hasAlt ? f.alt_start_time : null,
        duration_min: Number(f.duration_min), timezone: f.timezone, preferred_start: f.preferred_start || null,
        circle_type: f.circle_type || null, language: f.language || null, notes: f.notes || null,
      };
      if (circle?.status === "rejected") Object.assign(row, { status: "pending" });
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
    onClose();
  }

  const licence = data.licences.find((l) => l.id === circle?.licence_id);
  const requests = circle ? data.requests.filter((r) => r.circle_id === circle.id) : [];
  const [busy, setBusy] = useState(false);

  // Approve straight from the drawer; it stays open and switches to the live Zoom details.
  async function approve() {
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
        {circle?.status === "conflict" && (
          <div className="approve-bar warn">
            <div>
              <div className="approve-title">Can't approve yet</div>
              <div className="small">{circle.conflict_reason}. Change the time below, or re-check if a licence has been freed.</div>
            </div>
            <button disabled={busy} onClick={recheck}>Re-check licences</button>
          </div>
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
          {live && <p className="muted small">The licence can't change while a circle is live. To move licence, end the circle and add it again.</p>}
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
  useEffect(() => setRows(data.licences), [data.licences]);
  const edit = (id, k, v) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v, _dirty: true } : r)));
  const booked = (id) => data.circles.filter((c) => c.licence_id === id && ACTIVE.includes(c.status)).length;
  const dirty = rows.some((r) => r._dirty);

  async function saveAll() {
    await run(async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        const { error } = await supabase.from("licences").update({
          label: r.label, zoom_user_email: r.zoom_user_email ? r.zoom_user_email.trim().toLowerCase() : null,
          host_key: r.host_key || null, active: r.active, is_mock: r.is_mock,
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
            const { error } = await supabase.from("licences").insert({ label: `Licence ${String(rows.length + 1).padStart(2, "0")}`, sort_order: rows.length + 1 });
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
      <div className="table-wrap">
        <table className="table edit">
          <thead><tr><th>Label</th><th>Zoom user email</th><th>Host key</th><th>Active</th><th>Mock</th><th>Booked</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r._dirty ? "dirty" : ""}>
                <td><input value={r.label} onChange={(e) => edit(r.id, "label", e.target.value)} /></td>
                <td><input value={r.zoom_user_email ?? ""} placeholder={r.is_mock ? "not needed for mock" : "zoom-user@…"} onChange={(e) => edit(r.id, "zoom_user_email", e.target.value)} /></td>
                <td><input value={r.host_key ?? ""} placeholder="6 digits" onChange={(e) => edit(r.id, "host_key", e.target.value)} /></td>
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
const APPLY = {
  change_time: { label: "Apply new time", confirm: (r, c) => `Move "${c.name}" to ${requestSummary(r.request_type, r.details).replace(/^Move to /, "")}?${c.status === "live" ? " The Zoom link stays the same." : ""}` },
  change_start: { label: "Apply start date", confirm: (r, c) => `Change the start date of "${c.name}" to ${fmtDate(r.details.from)}?` },
  handover: { label: "Hand over", confirm: (r, c) => `Hand "${c.name}" over to ${r.details.name || r.details.email}?${c.status === "live" ? " They'll be invited and emailed the details." : ""}` },
  stop: { label: "End circle", confirm: (r, c) => `End "${c.name}"?${c.status === "live" ? " This deletes its Zoom meeting." : ""}` },
};

async function applyRequest(r, c) {
  const d = r.details ?? {};
  const live = c.status === "live";
  if (r.request_type === "change_time") {
    const patch = { weekday: Number(d.weekday), start_time: d.start_time, ...(d.from ? { preferred_start: d.from } : {}) };
    if (live) return adminAction("reschedule", c.id, { patch });
    const { error } = await supabase.from("circles").update(patch).eq("id", c.id);
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
  if (r.request_type === "stop") return adminAction("cancel", c.id);
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
          const canApply = r.status === "open" && APPLY[r.request_type] && c && c.status !== "ended";
          return (
            <div key={r.id} className={`row ${r.status !== "open" ? "row-done" : ""}`}>
              <div className="row-main" onClick={() => onSelect(r.circle_id)}>
                <div className="row-title">
                  {r.circle?.name}
                  <span className="tag info">{REQUEST_TYPES[r.request_type]?.label ?? "Request"}</span>
                </div>
                <div className="request-msg">{r.message}</div>
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

  const save = () => run(async () => {
    const { error } = await supabase.from("settings").update({
      buffer_minutes: Number(s.buffer_minutes), default_duration_min: Number(s.default_duration_min),
      default_timezone: s.default_timezone, term_start: s.term_start || null, term_end: s.term_end || null,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) throw error;
    const { error: e2 } = await supabase.rpc("recompute_slots");
    if (e2) throw new Error(/no_licence_clash/.test(e2.message) ? "Saved settings, but the new buffer causes a clash on an existing licence. Reduce the buffer or move a circle." : e2.message);
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
