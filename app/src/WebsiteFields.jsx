// Website listing fields and the "ready for the website" check for one circle.
// The rule in websiteMissing() mirrors websiteMissing() in supabase/functions/framer-sync/index.ts: keep them in step.
// framer-sync keeps a circle's website item as a draft until nothing is missing, even when the switch is on.
import { useEffect, useState } from "react";
import { supabase } from "./lib.js";
import "./website-fields.css";

const RUNNING = ["live", "paused"];
const UPCOMING = ["pending", "approved"];
const LANGS = ["English", "Spanish", "Hindi", "Portuguese", "Greek", "Italian", "French", "Slovak", "Czech", "Polish",
  "Norwegian", "Bengali", "Croatian", "Dutch", "Tamil", "German", "Russian"];
// framer-sync stores the reason a switched-on circle is held back in framer_error with this prefix.
export const READINESS_PREFIX = "Not shown on the website until set: ";
export const isReadinessNote = (err) => typeof err === "string" && err.startsWith(READINESS_PREFIX);

const PHOTO_BUCKET = "facilitator-photos";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 5 * 1024 * 1024;
const isUrl = (v) => /^https?:\/\/\S+$/i.test((v ?? "").trim());

function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (_) { return false; }
}
const localToday = (tz) => new Date().toLocaleDateString("en-CA", { timeZone: validTz(tz) ? tz : "Europe/London" });
// Advertised start date: the confirmed start, or for circles awaiting approval the facilitator's preferred start.
export const startDate = (c) => c.starts_on ?? (UPCOMING.includes(c.status) ? c.preferred_start : null) ?? null;

const listJoin = (xs) => (xs.length > 2 ? `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}` : xs.join(" & "));
// Host names as people know them (same as framer-sync): the name in an imported Zoom title, else facilitators' names.
function hostNames(c) {
  const segs = String(c.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!c.name_auto && /^TG\b/i.test(segs[0] ?? "") && segs.length >= 3) {
    const rest = segs.slice(2).filter((s) => !/\d/.test(s) && !LANGS.includes(s));
    if (rest.length) return [rest.join(" & ").replace(/\s+/g, " ")];
  }
  const people = [c.facilitator, ...(c.cofacilitators ?? []).map((x) => x.facilitator)].filter(Boolean);
  return people.map((p) => (p.initiated_name || p.name || "").trim()).filter((n) => n && !n.includes("@"));
}
// Name shown on the website card when no website name is set.
export const derivedName = (c) => listJoin(hostNames(c));
export const displayName = (c) => (c.website_name ?? "").trim() || derivedName(c);
export const photoFor = (c) => (c.website_photo_url ?? "").trim() || (c.facilitator?.photo_url ?? "").trim() || null;

// Every item a good listing needs, with whether it is set. Labels match framer-sync's reasons.
// circles.framer_has (written by framer-sync) says what the website item already holds, e.g. a photo added in Framer.
export function websiteChecks(c) {
  const has = c.framer_has ?? {};
  const handMade = !c.framer_created && has.link;
  const st = startDate(c);
  const running = RUNNING.includes(c.status) || handMade;
  const startOk = running || (st && st >= localToday(c.timezone));
  const inFramer = " (already set on the website)";
  return [
    { label: "photo", ok: Boolean(photoFor(c) || has.photo), how: photoFor(c) || !has.photo ? "Facilitator photo, or a photo for this circle" : `Photo${inFramer}` },
    { label: "display name", ok: Boolean(displayName(c) || has.name), how: "Short name on the card" },
    { label: "WhatsApp group link", ok: isUrl(c.whatsapp_group_link) || Boolean(has.whatsapp), how: isUrl(c.whatsapp_group_link) || !has.whatsapp ? "Goes into the signup link" : `In the signup link${inFramer}` },
    {
      label: !running && st && !startOk ? "start date (it is in the past)" : "start date", ok: Boolean(startOk),
      how: handMade ? "Managed on the website" : running ? "Running weekly" : st ? `Starts ${st}` : "Needed until the circle is live",
    },
    { label: "weekday", ok: c.weekday >= 1 && c.weekday <= 7 },
    { label: "start time", ok: Boolean(c.start_time) },
    { label: "timezone", ok: validTz(c.timezone) },
    { label: "language", ok: Boolean(c.language) },
    { label: "website order", ok: c.website_order > 0 || Boolean(has.order), how: c.website_order > 0 || !has.order ? "Position on the website (LessonNumber)" : `Position${inFramer}` },
  ];
}
// What still has to be set before the circle can be shown on the website (empty = ready).
export const websiteMissing = (c) => websiteChecks(c).filter((x) => !x.ok).map((x) => x.label);

// Checklist of what a website listing needs. `compact` shows only the summary line.
export function WebsiteReadiness({ circle, compact }) {
  const checks = websiteChecks(circle);
  const missing = checks.filter((x) => !x.ok);
  if (compact) {
    return missing.length
      ? <span className="warn-text small" title={missing.map((x) => x.label).join(", ")}>Missing {missing.length}</span>
      : <span className="ok-text small">Ready</span>;
  }
  return (
    <div className="wf-ready">
      <p className={`small ${missing.length ? "warn-text" : "ok-text"}`}>
        {missing.length
          ? <>Not ready for the website. {circle.website_visible ? "It stays hidden until" : "Before it can be shown, set"}: {missing.map((x) => x.label).join(", ")}.</>
          : <>Ready for the website.</>}
      </p>
      <ul className="checklist wf-checklist">
        {checks.map((x) => (
          <li key={x.label} className={x.ok ? "done" : ""}>
            <span className="tick">{x.ok ? "✓" : ""}</span>
            <span className="what">{x.label.charAt(0).toUpperCase() + x.label.slice(1)}{x.how && <span className="how">{x.how}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thumb({ url }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!isUrl(url)) return <span className="wf-thumb wf-thumb-empty" aria-hidden="true" />;
  if (broken) return <span className="wf-thumb wf-thumb-empty" title="This image did not load">!</span>;
  return <img className="wf-thumb" src={url.trim()} alt="" onError={() => setBroken(true)} />;
}

// Edits the website fields: facilitator photo (shared by their circles), optional circle photo, display name and order.
// `run(fn, okText)` is the Admin wrapper that saves, shows a toast, reloads and schedules the website sync.
export function WebsiteFields({ circle, run, editable = true }) {
  const lead = circle.facilitator;
  const initial = () => ({
    facPhoto: lead?.photo_url ?? "",
    circlePhoto: circle.website_photo_url ?? "",
    name: circle.website_name ?? "",
    order: circle.website_order ?? "",
  });
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  useEffect(() => { setF(initial()); setUploadErr(""); }, [circle.id, circle.website_photo_url, circle.website_name, circle.website_order, lead?.photo_url]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const orderNum = String(f.order).trim() === "" ? null : Number(f.order);
  const badOrder = orderNum !== null && !(Number.isInteger(orderNum) && orderNum > 0);
  const badFacPhoto = f.facPhoto.trim() && !isUrl(f.facPhoto);
  const badCirclePhoto = f.circlePhoto.trim() && !isUrl(f.circlePhoto);
  const facChanged = Boolean(lead) && f.facPhoto.trim() !== (lead.photo_url ?? "");
  const circleRow = {
    website_photo_url: f.circlePhoto.trim() || null,
    website_name: f.name.trim() || null,
    website_order: orderNum,
  };
  const circleChanged = circleRow.website_photo_url !== (circle.website_photo_url ?? null)
    || circleRow.website_name !== (circle.website_name ?? null)
    || circleRow.website_order !== (circle.website_order ?? null);
  const invalid = badOrder || badFacPhoto || badCirclePhoto;

  async function upload(e, target) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setUploadErr("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setUploadErr("Use a JPEG, PNG or WebP image.");
    if (file.size > PHOTO_MAX) return setUploadErr("That image is over 5 MB.");
    setBusy(true);
    try {
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const path = `${target === "facPhoto" ? lead?.id ?? "unknown" : `circle-${circle.id}`}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) throw error;
      const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      setF((x) => ({ ...x, [target]: data.publicUrl }));
    } catch (err) {
      setUploadErr(`Upload failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (invalid || (!facChanged && !circleChanged)) return;
    setBusy(true);
    await run(async () => {
      if (facChanged) {
        const { error } = await supabase.from("facilitators").update({ photo_url: f.facPhoto.trim() || null }).eq("id", lead.id);
        if (error) throw error;
      }
      if (circleChanged) {
        const { error } = await supabase.from("circles").update(circleRow).eq("id", circle.id);
        if (error) throw error;
      }
    }, "Website details saved");
    setBusy(false);
  }

  const preview = { ...circle, ...circleRow, facilitator: lead ? { ...lead, photo_url: f.facPhoto.trim() || null } : lead };
  return (
    <form className="form wf-form" onSubmit={save}>
      <div className="wf-photo-row">
        <Thumb url={photoFor(preview)} />
        <div className="wf-photo-fields">
          <label>Facilitator photo {lead?.name ? `(${lead.name}, used for all their circles)` : ""}
            <input type="url" value={f.facPhoto} onChange={set("facPhoto")} disabled={!editable || !lead || busy} placeholder="https://…jpg" />
          </label>
          {badFacPhoto && <p className="error small">That doesn't look like a link. It should start with https://</p>}
          {editable && lead && (
            <label className="wf-upload small">
              <input type="file" accept={PHOTO_TYPES.join(",")} disabled={busy} onChange={(e) => upload(e, "facPhoto")} />
              <span className="link">Upload a photo</span>
            </label>
          )}
          <label>Photo for this circle only (optional, e.g. a group photo)
            <input type="url" value={f.circlePhoto} onChange={set("circlePhoto")} disabled={!editable || busy} placeholder="Leave empty to use the facilitator photo" />
          </label>
          {badCirclePhoto && <p className="error small">That doesn't look like a link. It should start with https://</p>}
          {editable && (
            <label className="wf-upload small">
              <input type="file" accept={PHOTO_TYPES.join(",")} disabled={busy} onChange={(e) => upload(e, "circlePhoto")} />
              <span className="link">Upload a circle photo</span>
            </label>
          )}
          {uploadErr && <p className="error small">{uploadErr}</p>}
        </div>
      </div>
      <div className="grid2">
        <label>Name on the website card
          <input value={f.name} onChange={set("name")} disabled={!editable || busy} placeholder={derivedName(circle) || "e.g. Isvara, Isvari & Gopali"} maxLength={60} />
        </label>
        <label>Website order
          <input type="number" min="1" step="1" inputMode="numeric" value={f.order} onChange={set("order")} disabled={!editable || busy} placeholder="e.g. 3" />
        </label>
      </div>
      {badOrder && <p className="error small">Order must be a whole number from 1.</p>}
      <p className="muted small">The signup link keeps the fuller name ({derivedName(circle) || "facilitator name"}). Photos must be public image links; Framer copies them when the website updates.</p>
      {editable && (
        <div className="actions">
          <button className="primary" disabled={busy || invalid || (!facChanged && !circleChanged)}>{busy ? "Saving…" : "Save website details"}</button>
          {(facChanged || circleChanged) && <button type="button" className="ghost" disabled={busy} onClick={() => setF(initial())}>Undo</button>}
        </div>
      )}
    </form>
  );
}
