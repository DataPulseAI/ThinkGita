// Setup, Website: a preview of the circles page on thinkgita.org built from the website's content in Framer,
// with controls to show, hide and reorder listings. Circle listings are changed through the circle (switch and order);
// hand-made listings that no circle is linked to are changed directly in Framer through framer-sync.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, websiteSnapshot, websitePreview, websiteSetItem } from "./lib.js";
import "./website-fields.css";

const LIVE_PAGE = "https://www.thinkgita.org/circles";
const WEEKLY = "Weekly sessions on Zoom (75 mins)";
const num = (v) => (String(v ?? "").trim() === "" ? null : Number(v));
const byOrder = (a, b) => (num(a.order) ?? 9999) - (num(b.order) ?? 9999) || String(a.title).localeCompare(String(b.title));
const isCircleListing = (it) => /circle|circulo|beginner|bhakti|sadhana|japa|reading/i.test(it.all?.MainTitle ?? "");

const I = {
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  book: <svg viewBox="0 0 24 24"><path d="M3 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H3Z" /><path d="M21 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7Z" /></svg>,
  laptop: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="1" /><path d="M2 19h20" /></svg>,
};

// One listing, drawn like the card on the website.
function SiteCard({ card, children, muted }) {
  const [imgOk, setImgOk] = useState(true);
  const [bannerOk, setBannerOk] = useState(true);
  return (
    <div className={`site-card ${muted ? "muted-card" : ""}`}>
      {card.banner && bannerOk ? <img className="site-banner" src={card.banner} alt="" loading="lazy" onError={() => setBannerOk(false)} /> : <div className="site-banner" />}
      <div className="site-body">
        <div className="site-title">{card.title}</div>
        <div className="site-desc">{card.description}</div>
        <div className="site-meta">
          {card.time && <span>{I.clock}{card.time}</span>}
          {card.lesson && <span>{I.book}{card.lesson}</span>}
        </div>
        <div className="site-meta"><span>{I.laptop}{WEEKLY}</span></div>
        <div className="site-author">
          {card.photo && imgOk
            ? <img src={card.photo} alt="" onError={() => setImgOk(false)} />
            : <span className="site-avatar-empty" title="No photo">?</span>}
          <span>{card.author || <span className="muted">No name</span>}</span>
        </div>
      </div>
      {children && <div className="site-controls">{children}</div>}
    </div>
  );
}

function OrderInput({ value, onSave, disabled }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const save = () => {
    const n = num(v);
    if (n === num(value)) return;
    if (n !== null && !(Number.isInteger(n) && n > 0)) { setV(value ?? ""); return; }
    onSave(n);
  };
  return (
    <label className="site-order" title="Position on the page (lower comes first)">
      Order
      <input type="number" min="1" step="1" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)}
        onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
    </label>
  );
}

export function WebsitePage({ data, run, onSelect }) {
  const [snap, setSnap] = useState(null);
  const [prev, setPrev] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [s, p] = await Promise.all([websiteSnapshot(), websitePreview()]);
      setSnap(Array.isArray(s) ? s : []); setPrev(Array.isArray(p) ? p : []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const circleById = useMemo(() => new Map(data.circles.map((c) => [c.id, c])), [data.circles]);
  const prevById = useMemo(() => new Map((prev ?? []).map((p) => [p.id, p])), [prev]);

  // What is on the website now (published items), as Framer holds them.
  const shown = useMemo(() => (snap ?? []).filter((it) => !it.draft).map((it) => {
    const a = it.all ?? {};
    const c = it.circle ? circleById.get(it.circle.id) : null;
    return {
      key: it.id, item: it, circle: c, title: a.MainTitle, description: a.Description, time: a.Time, lesson: a.Lesson,
      author: a.AuthorName, photo: a.AuthorImg, banner: a.MainImg, order: a.LessonNumber,
      pending: Boolean(c?.framer_dirty), leaving: c && !c.website_visible,
    };
  }).sort(byOrder), [snap, circleById]);

  const shownCircleIds = new Set(shown.filter((x) => x.circle).map((x) => x.circle.id));
  const ready = (prev ?? []).filter((p) => !p.missing.length && !shownCircleIds.has(p.id)).sort(byOrder);
  const notReady = (prev ?? []).filter((p) => p.missing.length).sort((a, b) => a.missing.length - b.missing.length);
  // Hand-made listings (they have a photo) that are hidden; leftovers without a photo are ignored.
  const handMadeHidden = (snap ?? []).filter((it) => it.draft && !it.circle && isCircleListing(it) && it.all?.AuthorImg);

  // Changes: circle listings go through the circle row (the sync follows); hand-made ones go straight to Framer.
  async function act(key, fn, okText) {
    setBusy(key);
    await run(fn, okText);
    setBusy(null);
    setTimeout(load, 6000); // the website update runs in the background
  }
  const setCircle = (c, patch, okText) => act(c.id, async () => {
    const { error } = await supabase.from("circles").update(patch).eq("id", c.id);
    if (error) throw error;
  }, okText);
  const setHandMade = (id, change, okText) => act(id, async () => {
    const r = await websiteSetItem(id, change);
    if (r?.busy) throw new Error("A website update is running. Try again in a minute.");
    return r;
  }, okText);

  const s = data.settings;
  return (
    <div className="website-page">
      <section className="card">
        <div className="card-head">
          <h2>Website preview</h2>
          <div className="actions">
            <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
            <a className="button-link" href={LIVE_PAGE} target="_blank" rel="noreferrer">Open live page</a>
          </div>
        </div>
        <p className="muted small">
          The circles listed on thinkgita.org/circles, built from the website's content in Framer and sorted by order.
          Changes here go live automatically{s.framer_auto_publish === false ? " once someone publishes in Framer (auto publish is off in Settings)" : ""}.
          {s.framer_publish_pending && <span className="warn-text"> Some changes are saved but not live yet.</span>}
        </p>
        {err && <p className="error small">Couldn't load the website: {err}</p>}
      </section>

      {snap && (
        <section className="card">
          <div className="card-head"><h2>On the website <span className="muted">({shown.length})</span></h2></div>
          {!shown.length && <p className="muted">Nothing is listed right now.</p>}
          <div className="site-grid">
            {shown.map((x) => (
              <SiteCard key={x.key} card={x} muted={x.leaving}>
                <OrderInput value={x.circle ? x.circle.website_order ?? x.order : x.order} disabled={busy === x.key}
                  onSave={(n) => x.circle
                    ? setCircle(x.circle, { website_order: n }, "Order saved")
                    : setHandMade(x.item.id, { order: n }, "Order saved")} />
                <span className="grow" />
                {x.pending && <span className="muted small">Update pending</span>}
                {x.circle
                  ? <button className="link small" onClick={() => onSelect(x.circle)}>Circle</button>
                  : <span className="muted small" title="Made by hand in Framer, not linked to a circle">Hand-made</span>}
                <button className="small" disabled={busy === x.key || x.leaving} onClick={() => x.circle
                  ? setCircle(x.circle, { website_visible: false }, "Hidden from the website")
                  : setHandMade(x.item.id, { draft: true }, "Hidden from the website")}>
                  {x.leaving ? "Hiding…" : "Hide"}
                </button>
              </SiteCard>
            ))}
          </div>
        </section>
      )}

      {prev && (ready.length > 0 || handMadeHidden.length > 0) && (
        <section className="card">
          <div className="card-head"><h2>Ready to show <span className="muted">({ready.length + handMadeHidden.length})</span></h2></div>
          <p className="muted small">Everything a listing needs is filled in. Show one to add it to the page.</p>
          <div className="site-grid">
            {ready.map((p) => {
              const c = circleById.get(p.id);
              return (
                <SiteCard key={p.id} card={p} muted>
                  <span className="muted small">{p.visible ? "Going live shortly" : c?.status === "live" ? "Live circle" : "Starts soon"}</span>
                  <span className="grow" />
                  {c && <button className="link small" onClick={() => onSelect(c)}>Circle</button>}
                  <button className="small primary" disabled={!c || p.visible || busy === p.id}
                    onClick={() => setCircle(c, { website_visible: true }, "Set to show on the website")}>Show</button>
                </SiteCard>
              );
            })}
            {handMadeHidden.map((it) => {
              const a = it.all ?? {};
              return (
                <SiteCard key={it.id} muted card={{ title: a.MainTitle, description: a.Description, time: a.Time, lesson: a.Lesson, author: a.AuthorName, photo: a.AuthorImg, banner: a.MainImg }}>
                  <span className="muted small">Hand-made, hidden</span>
                  <span className="grow" />
                  <button className="small primary" disabled={busy === it.id}
                    onClick={() => setHandMade(it.id, { draft: false }, "Shown on the website")}>Show</button>
                </SiteCard>
              );
            })}
          </div>
        </section>
      )}

      {prev && notReady.length > 0 && (
        <section className="card">
          <details>
            <summary><h2 className="summary-title">Not ready yet <span className="muted">({notReady.length})</span></h2></summary>
            <p className="muted small">These can't be shown until the missing details are set in the circle's Website section.</p>
            <div className="list">
              {notReady.map((p) => {
                const c = circleById.get(p.id);
                return (
                  <div key={p.id} className="row">
                    <div className="row-main">{p.circle}<div className="muted small">Needs {p.missing.join(", ")}</div></div>
                    {c && <button className="link small" onClick={() => onSelect(c)}>Open</button>}
                  </div>
                );
              })}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
