// Facilitators as people the system knows: pick one for a circle, or add a new person once (checked against
// everyone already on file), then assign them. Names, photos and contact details are only edited on the person
// (Circles > Facilitators), never from a circle, so every circle shows the same details.
import { useMemo, useState } from "react";
import { supabase } from "./lib.js";
import { Avatar, facilitatorNames } from "./FacilitatorsPage.jsx";

const clean = (v) => String(v ?? "").trim();
const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 5 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fold = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Everything a search can match on: names, initiated name and email.
const haystack = (f) => fold([f.name, f.initiated_name, f.first_name, f.last_name, f.email].filter(Boolean).join(" "));

// Facilitators matching the search, best first: name starts with it, then contains it. Excluded ids are left out.
export function searchFacilitators(facilitators, q, exclude = []) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const skip = new Set(exclude.filter(Boolean));
  const list = (facilitators ?? []).filter((f) => !skip.has(f.id) && words.every((w) => haystack(f).includes(w)));
  const title = (f) => fold(facilitatorNames(f).title);
  return list.sort((a, b) => {
    const sa = words.length && title(a).startsWith(words[0]) ? 0 : 1;
    const sb = words.length && title(b).startsWith(words[0]) ? 0 : 1;
    return sa - sb || title(a).localeCompare(title(b));
  });
}

// The stored name for a new person, the same shape the form uses: "Initiated (First Last)" or "First Last".
export function displayNameFor({ initiated_name, first_name, last_name, email }) {
  const full = [clean(first_name), clean(last_name)].filter(Boolean).join(" ");
  const ini = clean(initiated_name);
  return ini ? `${ini} (${full || clean(email)})` : full || clean(email);
}

// Problems with a new person before saving, and anyone already on file who looks like the same person.
export function newPersonCheck(p, facilitators) {
  const email = clean(p.email).toLowerCase();
  const problems = {};
  if (!clean(p.first_name) && !clean(p.initiated_name)) problems.first_name = "Add a first name or initiated name.";
  if (!EMAIL_RE.test(email)) problems.email = "Enter a valid email.";
  const sameEmail = (facilitators ?? []).find((f) => clean(f.email).toLowerCase() === email) ?? null;
  if (sameEmail) problems.email = "Someone already uses this email.";
  // Same first name (or initiated name) and same last name, or same initiated name: worth a second look.
  const key = (v) => fold(v).split(/\s+/)[0] ?? "";
  const first = key(p.first_name), last = fold(p.last_name), ini = fold(p.initiated_name);
  const similar = sameEmail ? [] : (facilitators ?? []).filter((f) => {
    if (ini && fold(f.initiated_name) === ini) return true;
    if (first.length >= 3 && last && haystack(f).includes(first) && haystack(f).includes(last)) return true;
    return false;
  }).slice(0, 3);
  return { email, problems, sameEmail, similar };
}

// Verified: an admin has vouched for them (approved a circle they run, or verified them on their profile).
export const isVerified = (f) => Boolean(f?.verified_at);
export function UnverifiedTag({ fac, label = "Unverified" }) {
  if (!fac || isVerified(fac)) return null;
  return <span className="tag unverified" title="Not verified yet: approve a circle they run, or verify them on their profile">{label}</span>;
}

export function PersonLine({ fac, size = 32, children }) {
  const n = facilitatorNames(fac);
  return (
    <span className="person-line">
      <Avatar fac={fac} size={size} />
      <span className="person-text">
        <span className="person-name">{n.title}{n.sub && <span className="muted"> · {n.sub}</span>}<UnverifiedTag fac={fac} /></span>
        <span className="muted small">{fac.email}{fac.phone ? ` · ${fac.phone}` : ""}</span>
        {children}
      </span>
    </span>
  );
}

// Choose an existing facilitator, or add a new one. Calls onPick(facilitator) with the chosen or created row.
export function FacilitatorPicker({ facilitators, exclude = [], onPick, onCancel, label = "Choose a facilitator", busy }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const results = useMemo(() => searchFacilitators(facilitators, q, exclude), [facilitators, q, exclude]);
  if (adding) {
    return <NewFacilitator facilitators={facilitators} initial={q} onCreated={onPick} onUseExisting={onPick} onCancel={() => setAdding(false)} />;
  }
  return (
    <div className="picker" role="group" aria-label="Facilitator picker">
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label={label} disabled={busy} />
      <div className="picker-list" role="listbox" aria-label="Facilitators">
        {results.slice(0, 8).map((f) => (
          <button key={f.id} type="button" role="option" aria-selected="false" className="picker-option" disabled={busy} onClick={() => onPick(f)}>
            <PersonLine fac={f} size={28} />
          </button>
        ))}
        {!results.length && <p className="muted small picker-empty">{q ? "Nobody matches. Add them as a new facilitator." : "No facilitators yet."}</p>}
        {results.length > 8 && <p className="muted small picker-empty">{results.length - 8} more: keep typing to narrow it down.</p>}
      </div>
      <div className="picker-foot">
        <button type="button" className="link small" disabled={busy} onClick={() => setAdding(true)}>+ New facilitator</button>
        {onCancel && <button type="button" className="ghost small" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

// Adds a person to the system once. An email already on file can't be added again: that person is offered instead.
export function NewFacilitator({ facilitators, initial = "", onCreated, onUseExisting, onCancel, cancelLabel = "Back", standalone = false }) {
  const words = clean(initial).includes("@") ? [] : clean(initial).split(/\s+/).filter(Boolean);
  const [p, setP] = useState({
    initiated_name: "", first_name: words[0] ?? "", last_name: words.slice(1).join(" "),
    email: clean(initial).includes("@") ? clean(initial) : "", phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoErr, setPhotoErr] = useState("");
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const { email, problems, sameEmail, similar } = newPersonCheck(p, facilitators);

  // The photo goes up before the person exists, into a folder of its own (admins can write anywhere in the bucket).
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setPhotoErr("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setPhotoErr("Use a JPEG, PNG or WebP image.");
    if (file.size > PHOTO_MAX) return setPhotoErr("That image is over 5 MB.");
    setBusy(true);
    try {
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const path = `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) throw error;
      setPhoto(supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
    } catch (x) {
      setPhotoErr(`Upload failed: ${x.message ?? x}`);
    } finally {
      setBusy(false);
    }
  }
  const invalid = Object.keys(problems).length > 0;

  async function create(e) {
    e.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setErr("");
    const row = {
      name: displayNameFor({ ...p, email }), email, phone: clean(p.phone) || null,
      first_name: clean(p.first_name) || null, last_name: clean(p.last_name) || null, initiated_name: clean(p.initiated_name) || null,
      ...(photo ? { photo_url: photo } : {}),
    };
    const { data, error } = await supabase.from("facilitators").insert(row).select("*").single();
    setBusy(false);
    if (error) return setErr(error.code === "23505" || /duplicate/.test(error.message) ? "Someone already uses this email. Refresh and pick them instead." : error.message);
    onCreated(data);
  }

  return (
    <form className={`picker new-person ${standalone ? "standalone" : ""}`} onSubmit={create} aria-label="New facilitator">
      {!standalone && (
        <div className="new-person-head">
        <span className="section-title">New facilitator</span>
        <span className="muted small">Added to the system once, then assigned.</span>
      </div>
      )}
      <div className="new-person-photo">
        <Avatar fac={{ ...p, name: displayNameFor({ ...p, email }) || "?", photo_url: photo }} size={64} />
        <div className="new-person-photo-actions small">
          <label className="fac-upload">
            <input type="file" accept={PHOTO_TYPES.join(",")} disabled={busy} onChange={upload} aria-label="Photo" />
            <span className="link">{photo ? "Change photo" : "Upload a photo"}</span>
          </label>
          {photo && <button type="button" className="link small" disabled={busy} onClick={() => setPhoto("")}>Remove</button>}
          <span className="muted">Optional. JPEG, PNG or WebP, up to 5 MB.</span>
          {photoErr && <span className="error">{photoErr}</span>}
        </div>
      </div>
      <label>Initiated name (if any)<input value={p.initiated_name} onChange={set("initiated_name")} autoFocus disabled={busy} /></label>
      <div className="grid2">
        <label>First name<input value={p.first_name} onChange={set("first_name")} disabled={busy} /></label>
        <label>Last name<input value={p.last_name} onChange={set("last_name")} disabled={busy} /></label>
      </div>
      <div className="grid2">
        <label>Email<input type="email" value={p.email} onChange={set("email")} disabled={busy} /></label>
        <label>Phone<input type="tel" value={p.phone} onChange={set("phone")} placeholder="+44…" disabled={busy} /></label>
      </div>
      {sameEmail ? (
        <div className="person-match">
          <span className="small warn-text">Already in the system:</span>
          <PersonLine fac={sameEmail} size={28} />
          <button type="button" className="small" onClick={() => onUseExisting(sameEmail)}>Use them</button>
        </div>
      ) : (p.email && problems.email && <p className="error small">{problems.email}</p>)}
      {similar.length > 0 && (
        <div className="person-match">
          <span className="small muted">Is this one of these people?</span>
          {similar.map((f) => (
            <div key={f.id} className="person-match-row">
              <PersonLine fac={f} size={28} />
              <button type="button" className="small" onClick={() => onUseExisting(f)}>Use them</button>
            </div>
          ))}
        </div>
      )}
      {problems.first_name && (p.last_name || p.email) && <p className="error small">{problems.first_name}</p>}
      {err && <p className="error small">{err}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className="primary" disabled={invalid || busy}>{busy ? "Adding…" : "Add to the system"}</button>
      </div>
    </form>
  );
}
