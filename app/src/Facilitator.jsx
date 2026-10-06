import { useEffect, useState } from "react";
import { supabase, DAY_NAMES, hhmm, endTime, STATUS_LABEL } from "./lib.js";

export default function Facilitator({ email }) {
  const [circles, setCircles] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    const { data, error: e } = await supabase.rpc("my_circles");
    if (e) setError(e.message);
    setCircles(data ?? []);
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
          <p className="muted">If you've just submitted the form, the team still needs to approve it. You'll get an email once your Zoom link is ready.</p>
        </div>
      )}
      {circles.map((c) => <CircleCard key={c.id} c={c} />)}
    </main>
  );
}

function CircleCard({ c }) {
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(null);
  const copy = (k, v) => {
    navigator.clipboard?.writeText(v);
    setCopied(k);
    setTimeout(() => setCopied(null), 1500);
  };

  async function request(e) {
    e.preventDefault();
    const { error } = await supabase.from("change_requests").insert({ circle_id: c.id, message: msg });
    if (!error) { setSent(true); setMsg(""); }
    else alert(error.message);
  }

  const live = c.status === "live";
  return (
    <section className="card">
      <div className="card-head">
        <h2>{c.name}</h2>
        <span className={`pill st-${c.status}`}>{live ? "Ready" : STATUS_LABEL[c.status]}</span>
      </div>
      <p className="lead">Every {DAY_NAMES[c.weekday]}, {hhmm(c.start_time)}–{endTime(c.start_time, c.duration_min)} <span className="muted">({c.timezone})</span></p>

      {live ? (
        <>
          <div className="details">
            {[
              ["link", "Join link", c.join_url],
              ["id", "Meeting ID", c.zoom_meeting_id],
              ["pass", "Passcode", c.passcode],
              ["host", "Host key", c.host_key],
            ].map(([k, label, v]) => (
              <div key={k} className="detail">
                <span className="muted small">{label}</span>
                <span className="detail-value">{v ?? "–"}</span>
                {v && <button className="ghost small" onClick={() => copy(k, v)}>{copied === k ? "Copied" : "Copy"}</button>}
              </div>
            ))}
          </div>
          <ol className="steps">
            <li>Open the join link a few minutes before your circle.</li>
            <li>In Zoom, open <b>Participants</b> and choose <b>Claim host</b>.</li>
            <li>Enter the host key above. You now have host controls.</li>
          </ol>
          <p className="muted small">The link is the same every week, from {c.starts_on} until {c.ends_on}. Pin it in your WhatsApp group.</p>
        </>
      ) : (
        <p className="muted">Your Zoom link will appear here once the team approves your circle.</p>
      )}

      <details className="request">
        <summary>Need to change something?</summary>
        {sent ? (
          <p>Thanks, the team has your request.</p>
        ) : (
          <form onSubmit={request}>
            <textarea rows="3" required value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Can we move to Thursdays at 8pm from February?" />
            <button className="primary">Send request</button>
          </form>
        )}
      </details>
    </section>
  );
}
