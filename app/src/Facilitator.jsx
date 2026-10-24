import { useEffect, useState } from "react";
import { supabase, DAY_NAMES, hhmm, endTime, STATUS_LABEL, tzName, fmtDate, circleMessage, REQUEST_TYPES, requestSummary } from "./lib.js";
import { CopyButton } from "./ui.jsx";
import Profile from "./Profile.jsx";
import { signupLink } from "./signupLink.js";
import { SignupDetail, personName, downloadCsv } from "./AttendeesPage.jsx";

export default function Facilitator({ email }) {
  const [circles, setCircles] = useState(null);
  const [requests, setRequests] = useState([]);
  const [parts, setParts] = useState({});
  const [signups, setSignups] = useState([]);
  const [error, setError] = useState(null);
  // Top toggle: the circle cards, or the attendee list (optionally for one circle).
  const [view, setView] = useState("circles");
  const [attCircle, setAttCircle] = useState("all");
  const showAttendees = (id = "all") => { setAttCircle(id); setView("attendees"); window.scrollTo(0, 0); };

  const load = async () => {
    const [c, r, p, s] = await Promise.all([
      supabase.rpc("my_circles_v2"),
      supabase.from("change_requests").select("*").order("created_at", { ascending: false }),
      supabase.rpc("my_circle_link_parts"),
      supabase.rpc("my_circle_signups"),
    ]);
    if (c.error) setError(c.error.message);
    setCircles(c.data ?? []);
    setRequests(r.data ?? []);
    setParts(Object.fromEntries((p.data ?? []).map((x) => [x.id, x])));
    setSignups(s.data ?? []);
  };
  useEffect(() => { load(); }, []);

  if (!circles) return <div className="center muted">Loading…</div>;

  const VIEWS = [["circles", "Your circles", 0], ["attendees", "Attendees", signups.length]];
  return (
    <main className="content narrow">
      {circles.length > 0 && (
        <div className="seg fac-views" role="tablist" aria-label="Portal view">
          {VIEWS.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "active" : ""}
              onClick={() => (k === "attendees" ? showAttendees("all") : setView(k))}>
              {label}{n > 0 && <span className="fac-att-count fac-tab-n">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {view === "attendees" ? (
        <AttendeesPane circles={circles} signups={signups} circle={attCircle} setCircle={setAttCircle} />
      ) : (<>
      <Profile email={email} />
      <h1>Your circles</h1>
      {error && <p className="error">{error}</p>}
      {!circles.length && (
        <div className="card">
          <p>There are no circles linked to <b>{email}</b> yet.</p>
          <p className="muted">If you've just submitted the form, the team still needs to approve it. You'll get an email once your Zoom link is ready. If you used a different email on the form, sign in with that one instead.</p>
        </div>
      )}
      {circles.map((c) => (
        <CircleCard key={c.id} c={c} parts={parts[c.id]} signups={signups.filter((s) => s.circle_id === c.id)}
          requests={requests.filter((r) => r.circle_id === c.id)} onSent={load} onAttendees={() => showAttendees(c.id)} />
      ))}
      </>)}
    </main>
  );
}

const REQUEST_STATUS = { open: "Waiting for the team", done: "Done", dismissed: "Closed" };

// WhatsApp group, participant sign-up and resources, when the team has set them.
function CircleLinks({ c, parts }) {
  // The sign-up link carries the circle's id, so each sign-up shows under Attendees.
  const signup = parts ? signupLink(parts) : c.participant_signup_link;
  const links = [
    ["WhatsApp group", c.whatsapp_group_link],
    ["Participant sign-up link", signup, "Share this exact link so sign-ups are linked to your circle."],
    ["YouTube playlist", c.youtube_playlist_link],
    ["Google Drive folder", c.drive_folder_link, "Request access and the team will approve it."],
  ].filter(([, v]) => v);
  if (!links.length) return null;
  return (
    <div className="details">
      <span className="section-title">Links</span>
      {links.map(([label, v, note]) => (
        <div key={label} className="detail">
          <span className="muted small">{label}</span>
          <span className="detail-value"><a href={v} target="_blank" rel="noreferrer">{v}</a>{note && <span className="detail-note muted">{note}</span>}</span>
          <CopyButton text={v} />
        </div>
      ))}
    </div>
  );
}

function CircleCard({ c, parts, signups, requests, onSent, onAttendees }) {
  const live = c.status === "live";
  const mock = live && /mock=1/.test(c.join_url ?? "");
  return (
    <section className="card">
      <div className="card-head">
        <h2>{c.name}</h2>
        <span className={`pill st-${c.status}`}>{live ? "Ready" : STATUS_LABEL[c.status]}</span>
      </div>
      <p className="lead">
        Every {DAY_NAMES[c.weekday]}, {hhmm(c.start_time)}–{endTime(c.start_time, c.duration_min)}{" "}
        <span className="muted">({tzName(c.timezone)} time)</span>
      </p>

      {live ? (
        <>
          {mock && <p className="banner small">Test circle: these Zoom details are placeholders, not a real meeting.</p>}
          <div className="details">
            {[
              ["Join link", c.join_url],
              ["Meeting ID", c.zoom_meeting_id],
              ["Passcode", c.passcode],
            ].map(([label, v]) => (
              <div key={label} className="detail">
                <span className="muted small">{label}</span>
                <span className="detail-value">{v ?? "–"}</span>
                {v ? <CopyButton text={v} /> : <span />}
              </div>
            ))}
            <HostKey value={c.host_key} />
            <div className="copy-all">
              <CopyButton primary label="Copy all my details" text={circleMessage(c, c.host_key)} />
              <CopyButton label="Copy for my group" text={circleMessage(c, null, { forFacilitator: false })} />
            </div>
            <p className="muted small"><b>Copy for my group</b> leaves out the host key, so it's safe to post in WhatsApp. <b>Copy all my details</b> is for you only.</p>
          </div>
          <ol className="steps">
            <li>Open the join link a few minutes before your circle.</li>
            {parts?.zoom_registration && <li>Zoom asks for your first name, last name and email. Fill them in and choose <b>Register</b> (once; it's approved straight away). Everyone joining does the same.</li>}
            <li>In Zoom, open <b>Participants</b> and choose <b>Claim host</b>.</li>
            <li>Enter the host key above. You now have host controls.</li>
          </ol>
          <p className="muted small">The link is the same every week, from {fmtDate(c.starts_on)} until {fmtDate(c.ends_on)}. Pin it in your WhatsApp group.</p>
          <CircleLinks c={c} parts={parts} />
        </>
      ) : (
        <p className="muted">Your Zoom link will appear here once the team approves your circle.</p>
      )}

      {["live", "paused", "ended"].includes(c.status) && (
        <div className="details fac-att-line">
          <span><span className="section-title">Attendees</span> <span className="fac-att-count">{signups.length}</span></span>
          <button type="button" className="small" onClick={onAttendees}>{signups.length ? "See attendees" : "Attendees"}</button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="history">
          <span className="muted small">Your requests</span>
          {requests.map((r) => (
            <div key={r.id} className="history-row">
              <span>
                <b>{REQUEST_TYPES[r.request_type]?.label ?? "Request"}</b>
                <span className="muted"> · {r.message}</span>
              </span>
              <span className={`pill small ${r.status === "open" ? "st-pending" : r.status === "done" ? "st-live" : "st-ended"}`}>{REQUEST_STATUS[r.status]}</span>
            </div>
          ))}
        </div>
      )}

      <ChangeRequest circle={c} onSent={onSent} />
    </section>
  );
}

// Attendee list helpers (no dates of birth in the portal).
const shortDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const initials = (s) => (personName(s).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
const waLink = (phone) => { const d = String(phone ?? "").replace(/[^\d]/g, ""); return d.length >= 8 ? `https://wa.me/${d}` : null; };

// The Attendees pane (top toggle): everyone who signed up for the facilitator's circles, filter by circle, search,
// CSV. Click a person for their answers, with Email and WhatsApp buttons.
function AttendeesPane({ circles, signups, circle, setCircle }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState(null);
  const nameOf = (id) => circles.find((c) => c.id === id)?.name ?? "";
  const needle = q.trim().toLowerCase();
  const list = signups.filter((s) => (circle === "all" || s.circle_id === circle)
    && (!needle || [s.first_name, s.last_name, s.email, s.phone, s.city].some((v) => String(v ?? "").toLowerCase().includes(needle))));
  const shown = all ? list : list.slice(0, 50);
  const many = circles.length > 1;
  return (
    <section className="card fac-att" aria-label="Attendees">
      <div className="fac-att-head">
        <h1 className="fac-att-title">Attendees</h1>
        <span className="fac-att-count">{list.length}</span>
        {list.length > 0 && (
          <button type="button" className="small fac-att-csv" onClick={() => downloadCsv(list, "attendees.csv", nameOf)}>Download CSV</button>
        )}
      </div>
      <div className="fac-att-filters">
        {many && (
          <select value={circle} onChange={(e) => setCircle(e.target.value)} aria-label="Circle">
            <option value="all">All my circles</option>
            {circles.map((c) => <option key={c.id} value={c.id}>{c.name} ({signups.filter((s) => s.circle_id === c.id).length})</option>)}
          </select>
        )}
        {signups.length > 0 && <input type="search" placeholder="Search name, email, phone, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />}
      </div>
      {!signups.length && <p className="muted small fac-att-empty">Nobody has signed up yet. Share your circle's <b>Participant sign-up link</b> (under Links on your circle) and sign-ups appear here.</p>}
      {signups.length > 0 && !list.length && <p className="muted small fac-att-empty">No attendees match.</p>}
      {list.length > 0 && (
        <ul className="fac-att-list">
          {shown.map((s) => {
            const open = openId === s.id;
            const wa = waLink(s.phone);
            return (
              <li key={s.id} className={`fac-att-row ${open ? "open" : ""}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="fac-att-avatar" aria-hidden="true">{initials(s)}</span>
                  <span className="fac-att-who">
                    <span className="fac-att-name">{personName(s)}</span>
                    <span className="fac-att-sub">{[s.email, s.phone].filter(Boolean).join(" · ")}</span>
                    {many && circle === "all" && <span className="fac-att-circle">{nameOf(s.circle_id)}</span>}
                  </span>
                  <span className="fac-att-date" title={`Signed up ${fmtDate(String(s.submitted_at).slice(0, 10))}`}>{shortDay(s.submitted_at)}</span>
                  <span className="fac-att-chev" aria-hidden="true">›</span>
                </button>
                {open && (
                  <div className="fac-att-open">
                    <SignupDetail s={s} contact={false} />
                    <div className="fac-att-contact">
                      {s.email && <a href={`mailto:${s.email}`}>Email</a>}
                      {wa && <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown.length && <button type="button" className="link small fac-att-more" onClick={() => setAll(true)}>Show all {list.length}</button>}
    </section>
  );
}

// The host key gives full host control of every meeting on this Zoom licence,
// so it's hidden until asked for and clearly marked as private.
function HostKey({ value }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="detail host-key">
      <span className="muted small">Host key</span>
      <span className="detail-value">
        {value ? (shown ? value : "••••••") : "–"}
        <span className="detail-note">Private: for you only. Never share it or post it in the group.</span>
      </span>
      {value ? (
        <span className="hk-actions">
          <button type="button" className="copy-btn" onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
          <CopyButton text={value} />
        </span>
      ) : <span />}
    </div>
  );
}

// Structured change request: pick what's needed, fill only the fields that matter.
function ChangeRequest({ circle, onSent }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [d, setD] = useState({});
  const [note, setNote] = useState("");
  const [state, setState] = useState({ status: "idle" });
  const fields = type ? REQUEST_TYPES[type].fields : [];
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const complete = type && fields.every((f) => d[f]) && (type !== "other" || note.trim());

  async function send(e) {
    e.preventDefault();
    if (!complete) return;
    setState({ status: "sending" });
    const details = { ...d, ...(d.weekday ? { weekday: Number(d.weekday) } : {}) };
    const summary = type === "other" ? note.trim() : `${requestSummary(type, details)}${note.trim() ? `. ${note.trim()}` : ""}`;
    const { error } = await supabase.from("change_requests").insert({
      circle_id: circle.id, request_type: type, details, message: summary,
    });
    if (error) return setState({ status: "error", message: "Couldn't send your request. Please try again, or contact the team." });
    setType(""); setD({}); setNote(""); setOpen(false);
    setState({ status: "sent" });
    onSent();
  }

  if (!open) {
    return (
      <div className="request">
        <button type="button" className="link" onClick={() => { setOpen(true); setState({ status: "idle" }); }}>Need to change something?</button>
        {state.status === "sent" && <p className="ok-text small">Thanks, the team has your request. You'll see its status above.</p>}
      </div>
    );
  }

  return (
    <form className="request request-form" onSubmit={send}>
      <label>What do you need?
        <select value={type} onChange={(e) => { setType(e.target.value); setD({}); }} autoFocus>
          <option value="">Choose…</option>
          {Object.entries(REQUEST_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
      </label>

      {fields.includes("weekday") && (
        <div className="grid2">
          <label>New day
            <select value={d.weekday ?? ""} onChange={set("weekday")}>
              <option value="">Choose…</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{DAY_NAMES[n]}</option>)}
            </select>
          </label>
          <label>New start time ({tzName(circle.timezone)} time)
            <input type="time" value={d.start_time ?? ""} onChange={set("start_time")} />
          </label>
        </div>
      )}
      {fields.includes("from") && (
        <div className="grid2">
          <label>{type === "change_start" ? "New start date" : type === "stop" ? "Last session on or after" : type === "pause" ? "Pause from" : "From"}
            <input type="date" value={d.from ?? ""} onChange={set("from")} />
          </label>
          {fields.includes("until") && (
            <label>Restart on
              <input type="date" value={d.until ?? ""} min={d.from} onChange={set("until")} />
            </label>
          )}
        </div>
      )}
      {fields.includes("name") && (
        <div className="grid2">
          <label>New facilitator's name<input value={d.name ?? ""} onChange={set("name")} /></label>
          <label>Their email<input type="email" value={d.email ?? ""} onChange={set("email")} /></label>
        </div>
      )}

      {type && (
        <label>{type === "other" ? "Tell us what you need" : "Anything else? (optional)"}
          <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={type === "other" ? "e.g. Can we make the sessions 90 minutes?" : ""} />
        </label>
      )}
      {type && type !== "other" && complete && <p className="muted small">We'll send: <b>{requestSummary(type, { ...d, weekday: Number(d.weekday) })}</b></p>}
      {state.status === "error" && <p className="error small">{state.message}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary" disabled={!complete || state.status === "sending"}>
          {state.status === "sending" ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}
