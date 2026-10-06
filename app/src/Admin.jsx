import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, adminAction, DAYS, DAY_NAMES, hhmm, toMin, endTime, STATUS_LABEL } from "./lib.js";

const ACTIVE = ["pending", "approved", "live"];
const TABS = ["Overview", "Schedule", "Queue", "Circles", "Licences", "Requests", "Settings"];

export default function Admin() {
  const [tab, setTab] = useState("Overview");
  const [day, setDay] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const [circles, licences, settings, requests, log] = await Promise.all([
      supabase.from("circles").select("*, facilitator:facilitators(name,email,phone), licence:licences(label)").order("weekday").order("start_time"),
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

  if (!data) return <div className="center muted">Loading data…</div>;
  const openRequests = data.requests.filter((r) => r.status === "open").length;
  const queueCount = data.circles.filter((c) => c.status === "pending" || c.status === "conflict").length;

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
        {tab === "Schedule" && <Schedule data={data} day={day} setDay={setDay} onSelect={setSelected} />}
        {tab === "Queue" && <Queue data={data} run={run} onSelect={setSelected} />}
        {tab === "Circles" && <Circles data={data} onSelect={setSelected} onNew={() => setSelected("new")} />}
        {tab === "Licences" && <Licences data={data} run={run} />}
        {tab === "Requests" && <Requests data={data} run={run} onSelect={(id) => setSelected(data.circles.find((c) => c.id === id))} />}
        {tab === "Settings" && <Settings data={data} run={run} />}
      </main>
      {selected && (
        <CircleDrawer
          circle={selected === "new" ? null : data.circles.find((c) => c.id === selected.id) ?? selected}
          data={data}
          run={run}
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
  const missingZoom = active.filter((l) => !l.zoom_user_email).length;
  const matrix = active.map((l) => ({
    l,
    days: [1, 2, 3, 4, 5, 6, 7].map((d) => circles.filter((c) => c.licence_id === l.id && c.weekday === d && ACTIVE.includes(c.status)).length),
  }));
  const max = Math.max(1, ...matrix.flatMap((r) => r.days));
  const demo = circles.some((c) => c.is_demo);

  return (
    <>
      {demo && <div className="banner">Demo data is loaded (circles named "Demo Circle"). Clear it from Settings before going live.</div>}
      <div className="stats">
        <Stat label="Live circles" value={count("live")} />
        <Stat label="Awaiting approval" value={count("pending")} onClick={() => onTab("Queue")} />
        <Stat label="No licence free" value={count("conflict")} tone={count("conflict") ? "warn" : ""} onClick={() => onTab("Queue")} />
        <Stat label="Open change requests" value={requests.filter((r) => r.status === "open").length} onClick={() => onTab("Requests")} />
        <Stat label="Licences without Zoom user" value={missingZoom} tone={missingZoom ? "warn" : ""} onClick={() => onTab("Licences")} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Week at a glance</h2>
          <span className="muted">Circles per licence per day. Click a day to see the timeline.</span>
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
                  <th className="rowhead">{l.label}</th>
                  {days.map((n, i) => (
                    <td key={i} onClick={() => onDay(i + 1)} style={{ "--a": n / max }} className={n ? "filled" : ""}>{n || ""}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th className="rowhead warn-text">No licence</th>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const n = circles.filter((c) => c.status === "conflict" && c.weekday === d).length;
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

function Stat({ label, value, tone, onClick }) {
  return (
    <button className={`stat ${tone ?? ""}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}

/* ---------------- Schedule (day timeline) ---------------- */
function Schedule({ data, day, setDay, onSelect }) {
  const { circles, licences, settings } = data;
  const todays = circles.filter((c) => c.weekday === day && (ACTIVE.includes(c.status) || c.status === "conflict"));
  const startH = Math.min(6, ...todays.map((c) => Math.floor(toMin(c.start_time) / 60)));
  const endH = Math.max(23, ...todays.map((c) => Math.ceil((toMin(c.start_time) + c.duration_min) / 60)));
  const span = (endH - startH) * 60;
  const pos = (min) => `${((min - startH * 60) / span) * 100}%`;
  const lanes = [
    ...licences.filter((l) => l.active).map((l) => ({ key: l.id, label: l.label, items: todays.filter((c) => c.licence_id === l.id) })),
    { key: "none", label: "No licence", items: todays.filter((c) => c.status === "conflict"), warn: true },
  ];

  return (
    <section className="card">
      <div className="card-head">
        <h2>{DAY_NAMES[day]}</h2>
        <div className="seg">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} className={d === day ? "on" : ""} onClick={() => setDay(d)}>{DAYS[d]}</button>
          ))}
        </div>
      </div>
      <p className="muted small">Shaded tail = {settings.buffer_minutes}-minute buffer before the licence can be reused.</p>
      <div className="timeline">
        <div className="hours">
          {Array.from({ length: endH - startH }, (_, i) => (
            <span key={i} style={{ left: pos((startH + i) * 60) }}>{String(startH + i).padStart(2, "0")}</span>
          ))}
        </div>
        {lanes.map((lane) => (
          <div key={lane.key} className={`lane ${lane.warn ? "lane-warn" : ""}`}>
            <div className="lane-label">{lane.label}</div>
            <div className="lane-track" style={lane.warn ? { height: Math.max(1, lane.items.length) * 30 + 8 } : undefined}>
              {Array.from({ length: endH - startH }, (_, i) => (
                <i key={i} className="gridline" style={{ left: pos((startH + i) * 60) }} />
              ))}
              {lane.items.map((c, idx) => {
                const s = toMin(c.start_time);
                const top = lane.warn ? 4 + idx * 30 : 4;
                return (
                  <button
                    key={c.id}
                    className={`block st-${c.status}`}
                    style={{ left: pos(s), width: `calc(${pos(s + c.duration_min)} - ${pos(s)})`, top, height: lane.warn ? 26 : undefined }}
                    title={`${c.name}\n${hhmm(c.start_time)}–${endTime(c.start_time, c.duration_min)} · ${STATUS_LABEL[c.status]}`}
                    onClick={() => onSelect(c)}
                  >
                    <span>{hhmm(c.start_time)} {c.name}</span>
                    {!lane.warn && (
                      <em className="buffer" style={{ width: `${(settings.buffer_minutes / c.duration_min) * 100}%`, right: `-${(settings.buffer_minutes / c.duration_min) * 100}%` }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Legend />
    </section>
  );
}

function Legend() {
  return (
    <div className="legend">
      {["pending", "live", "conflict"].map((s) => (
        <span key={s}><i className={`swatch st-${s}`} /> {STATUS_LABEL[s]}</span>
      ))}
    </div>
  );
}

/* ---------------- Queue ---------------- */
function Queue({ data, run, onSelect }) {
  const items = data.circles
    .filter((c) => c.status === "pending" || c.status === "conflict")
    .sort((a, b) => (a.status === "conflict" ? -1 : 0) - (b.status === "conflict" ? -1 : 0) || a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
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
    }, (out) => `${c.name} moved to ${hhmm(start)}: ${STATUS_LABEL[out.status]}`);
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
              <div className="row-title">{c.name} {c.is_demo && <span className="tag">demo</span>}</div>
              <div className="muted small">
                {DAY_NAMES[c.weekday]} {hhmm(c.start_time)}–{endTime(c.start_time, c.duration_min)} · {c.facilitator?.name ?? "No facilitator"}
              </div>
              <div className="small">
                {c.status === "conflict" ? <span className="warn-text">{c.conflict_reason}</span> : <>Assigned to <b>{c.licence?.label}</b></>}
              </div>
              {suggestions[c.id] && (
                <div className="suggest">
                  {suggestions[c.id].error && <span className="error">{suggestions[c.id].error}</span>}
                  {Array.isArray(suggestions[c.id]) && !suggestions[c.id].length && <span className="muted">No free time within 3 hours that day.</span>}
                  {Array.isArray(suggestions[c.id]) && suggestions[c.id].map((s) => (
                    <button key={s.start_time} className="chip" onClick={(e) => { e.stopPropagation(); moveTo(c, s.start_time); }}>
                      {hhmm(s.start_time)} · {s.licence_label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="row-actions">
              {c.status === "pending" && (
                <button className="primary" onClick={() => run(() => adminAction("provision", c.id), (o) => `Zoom meeting created. Invite: ${o.invite}. Email: ${o.email}`)}>
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
function Circles({ data, onSelect, onNew }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const rows = useMemo(() => data.circles.filter((c) => {
    if (status === "active" && !(ACTIVE.includes(c.status) || c.status === "conflict")) return false;
    if (status !== "active" && status !== "all" && c.status !== status) return false;
    const hay = `${c.name} ${c.facilitator?.name ?? ""} ${c.facilitator?.email ?? ""} ${c.licence?.label ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [data.circles, q, status]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Circles <span className="muted">({rows.length})</span></h2>
        <div className="filters">
          <input placeholder="Search name, facilitator, licence" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active + conflicts</option>
            <option value="all">All</option>
            {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="primary" onClick={onNew}>Add circle</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Circle</th><th>Facilitator</th><th>When</th><th>Licence</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => onSelect(c)}>
                <td>{c.name}</td>
                <td>{c.facilitator?.name}<div className="muted small">{c.facilitator?.email}</div></td>
                <td>{DAYS[c.weekday]} {hhmm(c.start_time)}–{endTime(c.start_time, c.duration_min)}</td>
                <td>{c.licence?.label ?? <span className="muted">none</span>}</td>
                <td><span className={`pill st-${c.status}`}>{STATUS_LABEL[c.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Circle drawer ---------------- */
function CircleDrawer({ circle, data, run, onClose }) {
  const isNew = !circle;
  const editable = isNew || ["pending", "conflict", "approved"].includes(circle.status);
  const [f, setF] = useState(() => ({
    name: circle?.name ?? "",
    facilitator_name: circle?.facilitator?.name ?? "",
    facilitator_email: circle?.facilitator?.email ?? "",
    weekday: circle?.weekday ?? 1,
    start_time: hhmm(circle?.start_time) || "19:00",
    duration_min: circle?.duration_min ?? data.settings.default_duration_min,
    licence_id: circle?.licence_id ?? "auto",
    notes: circle?.notes ?? "",
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    await run(async () => {
      let facilitator_id = circle?.facilitator_id ?? null;
      if (f.facilitator_email) {
        const { data: fac, error } = await supabase.from("facilitators")
          .upsert({ email: f.facilitator_email.trim().toLowerCase(), name: f.facilitator_name || f.facilitator_email }, { onConflict: "email" })
          .select("id").single();
        if (error) throw error;
        facilitator_id = fac.id;
      }
      const row = {
        name: f.name, facilitator_id, weekday: Number(f.weekday), start_time: f.start_time,
        duration_min: Number(f.duration_min), notes: f.notes || null,
      };
      let id = circle?.id;
      if (isNew) {
        const { data: created, error } = await supabase.from("circles").insert({ ...row, source: "manual", timezone: data.settings.default_timezone }).select("id").single();
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
    }, (out) => `Saved: ${STATUS_LABEL[out.status]}`);
    onClose();
  }

  const copy = (t) => navigator.clipboard?.writeText(t);
  const licence = data.licences.find((l) => l.id === circle?.licence_id);

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{isNew ? "New circle" : circle.name}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        {!isNew && <span className={`pill st-${circle.status}`}>{STATUS_LABEL[circle.status]}</span>}

        {circle?.status === "live" && (
          <div className="details">
            <Detail label="Join link" value={circle.join_url} copy={copy} />
            <Detail label="Meeting ID" value={circle.zoom_meeting_id} copy={copy} />
            <Detail label="Passcode" value={circle.passcode} copy={copy} />
            <Detail label="Host key" value={licence?.host_key ?? "not set on licence"} copy={copy} />
            <Detail label="Licence" value={licence?.label} />
            <Detail label="Runs" value={`${DAY_NAMES[circle.weekday]}s ${hhmm(circle.start_time)}, ${circle.starts_on} to ${circle.ends_on}`} />
            <div className="actions">
              <button onClick={() => run(() => adminAction("resend", circle.id), (o) => `Email ${o.email}`)}>Resend details email</button>
              <button className="danger" onClick={() => confirm("Delete the Zoom meeting and end this circle?") && run(() => adminAction("cancel", circle.id), "Circle ended").then(onClose)}>End circle</button>
            </div>
            <p className="muted small">To change the time of a live circle, end it and add it again. That frees the licence and creates a new link.</p>
          </div>
        )}

        <div className="form">
          <label>Circle name<input value={f.name} onChange={set("name")} disabled={!editable} /></label>
          <div className="grid2">
            <label>Facilitator name<input value={f.facilitator_name} onChange={set("facilitator_name")} disabled={!editable} /></label>
            <label>Facilitator email<input type="email" value={f.facilitator_email} onChange={set("facilitator_email")} disabled={!editable} /></label>
          </div>
          <div className="grid3">
            <label>Day
              <select value={f.weekday} onChange={set("weekday")} disabled={!editable}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
              </select>
            </label>
            <label>Start<input type="time" value={f.start_time} onChange={set("start_time")} disabled={!editable} /></label>
            <label>Minutes<input type="number" min="15" max="240" step="5" value={f.duration_min} onChange={set("duration_min")} disabled={!editable} /></label>
          </div>
          <label>Licence
            <select value={f.licence_id} onChange={set("licence_id")} disabled={!editable}>
              <option value="auto">Pick automatically</option>
              {data.licences.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label>Notes<textarea rows="3" value={f.notes} onChange={set("notes")} disabled={!editable} /></label>
          {editable && <button className="primary wide" disabled={!f.name} onClick={save}>{isNew ? "Add circle" : "Save changes"}</button>}
        </div>

        {circle?.facilitator?.phone && <p className="muted small">Phone: {circle.facilitator.phone}</p>}
        {circle && <p className="muted small">Source: {circle.source} · created {new Date(circle.created_at).toLocaleString()}</p>}
      </aside>
    </div>
  );
}

function Detail({ label, value, copy }) {
  return (
    <div className="detail">
      <span className="muted small">{label}</span>
      <span className="detail-value">{value ?? "–"}</span>
      {copy && value && <button className="ghost small" onClick={() => copy(String(value))}>Copy</button>}
    </div>
  );
}

/* ---------------- Licences ---------------- */
function Licences({ data, run }) {
  const [rows, setRows] = useState(data.licences);
  useEffect(() => setRows(data.licences), [data.licences]);
  const edit = (id, k, v) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v, _dirty: true } : r)));
  const booked = (id) => data.circles.filter((c) => c.licence_id === id && ACTIVE.includes(c.status)).length;

  async function saveAll() {
    await run(async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        const { error } = await supabase.from("licences").update({
          label: r.label, zoom_user_email: r.zoom_user_email ? r.zoom_user_email.trim().toLowerCase() : null,
          host_key: r.host_key || null, active: r.active,
        }).eq("id", r.id);
        if (error) throw error;
      }
    }, "Licences saved");
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
          <button className="primary" disabled={!rows.some((r) => r._dirty)} onClick={saveAll}>Save</button>
        </div>
      </div>
      <p className="muted small">Each licence is one licensed Zoom user. Meetings are created under that user, and facilitators get its host key so they can claim host without a password.</p>
      <div className="table-wrap">
        <table className="table edit">
          <thead><tr><th>Label</th><th>Zoom user email</th><th>Host key</th><th>Active</th><th>Booked</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input value={r.label} onChange={(e) => edit(r.id, "label", e.target.value)} /></td>
                <td><input value={r.zoom_user_email ?? ""} placeholder="zoom-user@…" onChange={(e) => edit(r.id, "zoom_user_email", e.target.value)} /></td>
                <td><input value={r.host_key ?? ""} placeholder="6 digits" onChange={(e) => edit(r.id, "host_key", e.target.value)} /></td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => edit(r.id, "active", e.target.checked)} /></td>
                <td>{booked(r.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Requests ---------------- */
function Requests({ data, run, onSelect }) {
  const setStatus = (id, status) => run(async () => {
    const { error } = await supabase.from("change_requests").update({ status }).eq("id", id);
    if (error) throw error;
  }, "Updated");
  return (
    <section className="card">
      <div className="card-head"><h2>Change requests from facilitators</h2></div>
      {!data.requests.length && <p className="muted">No requests yet.</p>}
      <div className="list">
        {data.requests.map((r) => (
          <div key={r.id} className={`row ${r.status !== "open" ? "row-done" : ""}`}>
            <div className="row-main" onClick={() => onSelect(r.circle_id)}>
              <div className="row-title">{r.circle?.name}</div>
              <div>{r.message}</div>
              <div className="muted small">{r.requested_by} · {new Date(r.created_at).toLocaleString()} · {r.status}</div>
            </div>
            {r.status === "open" && (
              <div className="row-actions">
                <button className="primary" onClick={() => setStatus(r.id, "done")}>Mark done</button>
                <button className="ghost" onClick={() => setStatus(r.id, "dismissed")}>Dismiss</button>
              </div>
            )}
          </div>
        ))}
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
          <label>Default timezone<input value={s.default_timezone} onChange={set("default_timezone")} /></label>
          <label>Term starts<input type="date" value={s.term_start ?? ""} onChange={set("term_start")} /></label>
          <label>Term ends<input type="date" value={s.term_end ?? ""} onChange={set("term_end")} /></label>
        </div>
        <p className="muted small">Zoom meetings repeat weekly from the first matching day on or after the term start until the term end (max 50 weeks).</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Admins</h2></div>
        <div className="list">
          {admins.map((a) => (
            <div key={a.email} className="row">
              <div className="row-main">{a.email}</div>
              <div className="row-actions">
                <button className="ghost danger" disabled={admins.length < 2} onClick={() => run(async () => {
                  const { error } = await supabase.from("admin_emails").delete().eq("email", a.email);
                  if (error) throw error;
                  loadAdmins();
                }, "Removed")}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="inline">
          <input type="email" placeholder="email@…" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
          <button onClick={() => run(async () => {
            const { error } = await supabase.from("admin_emails").insert({ email: newAdmin.trim().toLowerCase() });
            if (error) throw error;
            setNewAdmin("");
            loadAdmins();
          }, "Admin added. Invite them from Supabase Auth so they can sign in.")}>Add admin</button>
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
