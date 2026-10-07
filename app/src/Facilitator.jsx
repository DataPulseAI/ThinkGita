import { useEffect, useState } from "react";
import { supabase, DAY_NAMES, hhmm, endTime, STATUS_LABEL, tzName, fmtDate, circleMessage, REQUEST_TYPES, requestSummary } from "./lib.js";
import { CopyButton } from "./ui.jsx";

export default function Facilitator({ email }) {
  const [circles, setCircles] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);

  const load = async () => {
    const [c, r] = await Promise.all([
      supabase.rpc("my_circles_v2"),
      supabase.from("change_requests").select("*").order("created_at", { ascending: false }),
    ]);
    if (c.error) setError(c.error.message);
    setCircles(c.data ?? []);
    setRequests(r.data ?? []);
  };
  useEffect(() => { load(); }, []);

  if (!circles) return <div className="center muted">Loading…</div>;

  return (
    <main className="content narrow">
      <h1>Your circles</h1>
      {error && <p className="error">{error}</p>}
      {!circles.length && (
        <div className="card">
          <p>There are no circles linked to <b>{email}</b> yet.</p>
          <p className="muted">If you've just submitted the form, the team still needs to approve it. You'll get an email once your Zoom link is ready. If you used a different email on the form, sign in with that one instead.</p>
        </div>
      )}
      {circles.map((c) => (
        <CircleCard key={c.id} c={c} requests={requests.filter((r) => r.circle_id === c.id)} onSent={load} />
      ))}
    </main>
  );
}

const REQUEST_STATUS = { open: "Waiting for the team", done: "Done", dismissed: "Closed" };

// WhatsApp group, participant sign-up and resources, when the team has set them.
function CircleLinks({ c }) {
  const links = [
    ["WhatsApp group", c.whatsapp_group_link],
    ["Participant sign-up link", c.participant_signup_link, "Share this exact link so sign-ups are linked to your circle."],
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

function CircleCard({ c, requests, onSent }) {
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
            <li>In Zoom, open <b>Participants</b> and choose <b>Claim host</b>.</li>
            <li>Enter the host key above. You now have host controls.</li>
          </ol>
          <p className="muted small">The link is the same every week, from {fmtDate(c.starts_on)} until {fmtDate(c.ends_on)}. Pin it in your WhatsApp group.</p>
          <CircleLinks c={c} />
        </>
      ) : (
        <p className="muted">Your Zoom link will appear here once the team approves your circle.</p>
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
