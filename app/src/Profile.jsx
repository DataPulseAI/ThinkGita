// "Your details" card in the facilitator portal: their photo, names and phone, editable by them.
// Reads their own facilitators row (policy self_read); saves through the update_my_profile RPC, which only touches
// these fields on their own row. Photos upload to <their facilitator id>/ in the public facilitator-photos bucket.
import { useEffect, useState } from "react";
import { supabase } from "./lib.js";
import { Avatar, facilitatorNames } from "./FacilitatorsPage.jsx";

const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 5 * 1024 * 1024;
export const PROFILE_FIELDS = ["initiated_name", "first_name", "last_name", "phone", "photo_url"];
const clean = (v) => String(v ?? "").trim();

// Same rules as update_my_profile in the database, so most mistakes show before saving.
export function profileProblems(form) {
  const p = {};
  if (!clean(form.initiated_name) && !clean(form.first_name)) p.first_name = "Add your first name or initiated name.";
  for (const k of ["initiated_name", "first_name", "last_name"]) if (clean(form[k]).length > 80) p[k] = "Keep this under 80 characters.";
  if (clean(form.phone) && !/^\+?[0-9 ()./-]{6,30}$/.test(clean(form.phone))) p.phone = "Use digits, spaces or dashes, with the country code (for example +44 7700 900123).";
  return p;
}
// The form's starting values. When first and last name were never filled in, split the name on record
// ("Esha Specimen", or the part in brackets of "Initiated (First Last)") so the person only has to check it.
export function profileForm(fac) {
  const f = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, fac?.[k] ?? ""]));
  if (!clean(f.first_name) && !clean(f.last_name)) {
    const n = facilitatorNames(fac ?? {});
    const legal = clean(fac?.initiated_name) ? n.sub : n.title;
    const words = /@/.test(legal) ? [] : legal.split(/\s+/).filter(Boolean);
    if (words.length) { f.first_name = words[0]; f.last_name = words.slice(1).join(" "); }
  }
  return f;
}
export function profileChanged(fac, form) {
  return PROFILE_FIELDS.some((k) => clean(form[k]) !== clean(fac?.[k]));
}
// Plain text for the database errors raised by update_my_profile.
export function profileError(err) {
  const m = String(err?.message ?? err ?? "");
  const known = m.match(/invalid_profile: (.+)$/)?.[1];
  if (known) return known.charAt(0).toUpperCase() + known.slice(1) + ".";
  if (/not_a_facilitator/.test(m)) return "We couldn't find a facilitator profile for this email. Please contact the team.";
  return "Couldn't save your details. Please try again, or contact the team.";
}

export default function Profile({ email }) {
  const [fac, setFac] = useState(undefined);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    supabase.from("facilitators").select("id, name, email, phone, first_name, last_name, initiated_name, photo_url")
      .eq("email", String(email ?? "").toLowerCase()).maybeSingle()
      .then(({ data }) => setFac(data ?? null));
  }, [email]);

  if (!fac) return null; // still loading, or no facilitator row for this sign-in (nothing to edit)
  const names = facilitatorNames(fac);

  return (
    <section className="card profile-card" aria-label="Your details">
      {!editing ? (
        <div className="profile-view">
          <Avatar fac={fac} size={64} />
          <div className="profile-info">
            <span className="profile-name">{names.title}</span>
            {names.sub && <span className="muted small">{names.sub}</span>}
            <span className="small">{fac.email}</span>
            <span className={`small ${fac.phone ? "" : "muted"}`}>{fac.phone || "No phone number yet"}</span>
            {!clean(fac.photo_url) && <span className="small warn-text">Add a photo so people can see who's leading their circle.</span>}
          </div>
          <button type="button" className="ghost profile-edit" onClick={() => setEditing(true)}>Edit my details</button>
        </div>
      ) : (
        <ProfileForm fac={fac} onCancel={() => setEditing(false)} onSaved={(row) => { setFac(row); setEditing(false); }} />
      )}
    </section>
  );
}

function ProfileForm({ fac, onCancel, onSaved }) {
  const [f, setF] = useState(() => profileForm(fac));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const problems = profileProblems(f);
  const changed = profileChanged(fac, f);
  const preview = { ...fac, ...f };

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setUploadErr("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setUploadErr("Use a JPEG, PNG or WebP image.");
    if (file.size > PHOTO_MAX) return setUploadErr("That image is over 5 MB. Try a smaller one.");
    setBusy(true);
    try {
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const path = `${fac.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) throw error;
      const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      setF((x) => ({ ...x, photo_url: data.publicUrl }));
    } catch {
      setUploadErr("The upload didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (busy || Object.keys(problems).length || !changed) return;
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("update_my_profile", {
      p_initiated_name: clean(f.initiated_name), p_first_name: clean(f.first_name), p_last_name: clean(f.last_name),
      p_phone: clean(f.phone), p_photo_url: clean(f.photo_url),
    });
    setBusy(false);
    if (error) return setErr(profileError(error));
    onSaved(data);
  }

  return (
    <form className="request-form profile-form" onSubmit={save}>
      <div className="profile-photo-row">
        <Avatar fac={preview} size={72} />
        <div className="profile-photo-actions small">
          <label className="fac-upload">
            <input type="file" accept={PHOTO_TYPES.join(",")} disabled={busy} onChange={upload} />
            <span className="link">{clean(f.photo_url) ? "Change photo" : "Upload a photo"}</span>
          </label>
          {clean(f.photo_url) && <button type="button" className="link" disabled={busy} onClick={() => setF({ ...f, photo_url: "" })}>Remove</button>}
          <span className="muted">A clear, friendly photo of your face. JPEG, PNG or WebP, up to 5 MB.</span>
          {uploadErr && <span className="error">{uploadErr}</span>}
        </div>
      </div>
      <label>Initiated name (if you have one)
        <input value={f.initiated_name} onChange={set("initiated_name")} disabled={busy} placeholder="Optional" />
      </label>
      {problems.initiated_name && <p className="error small">{problems.initiated_name}</p>}
      <div className="grid2">
        <label>First name
          <input value={f.first_name} onChange={set("first_name")} disabled={busy} autoComplete="given-name" />
        </label>
        <label>Last name
          <input value={f.last_name} onChange={set("last_name")} disabled={busy} autoComplete="family-name" />
        </label>
      </div>
      {(problems.first_name || problems.last_name) && <p className="error small">{problems.first_name || problems.last_name}</p>}
      <label>Phone (with country code)
        <input type="tel" value={f.phone} onChange={set("phone")} disabled={busy} autoComplete="tel" placeholder="+44 7700 900123" />
      </label>
      {problems.phone && <p className="error small">{problems.phone}</p>}
      <p className="muted small">Your photo and name appear on the ThinkGita website next to your circles. To change your email, contact the team: it's how you sign in.</p>
      {err && <p className="error small">{err}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="primary" disabled={busy || !changed || Object.keys(problems).length > 0}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
