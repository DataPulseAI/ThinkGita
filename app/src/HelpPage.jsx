// In-app Help: searchable step-by-step guides with screenshots, shown by what the signed-in person can do.
// Guides live in src/help/*.js; screenshots in public/help/. Pages use the URL hash: #/Help and #/Help/<guide id>.
import { useEffect, useMemo, useState } from "react";
import { GUIDES, SECTIONS, guidesFor, minutesFor, plainText } from "./help/index.js";
import "./help.css";

const BASE = import.meta.env.BASE_URL;

/* routing (the dashboard keeps its own hash routes; Help is just another one) */
export function readHelpRoute() {
  const m = location.hash.match(/^#\/Help(?:\/([A-Za-z0-9-]+))?$/);
  return m ? { open: true, id: m[1] ?? null } : { open: false, id: null };
}
const ROUTE_EVENT = "tg-help-route";
export function goHelp(id = null, { replace = false } = {}) {
  const hash = `#/Help${id ? `/${id}` : ""}`;
  if (hash === location.hash) return;
  const idx = history.state?.tgIdx ?? 0;
  if (replace) history.replaceState({ ...(history.state ?? {}), tgIdx: idx }, "", hash);
  else history.pushState({ tgIdx: idx + 1, tgHelp: true }, "", hash);
  window.dispatchEvent(new Event(ROUTE_EVENT));
  window.scrollTo(0, 0);
}
export function useHelpRoute() {
  const [route, setRoute] = useState(readHelpRoute);
  useEffect(() => {
    const update = () => setRoute(readHelpRoute());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    window.addEventListener(ROUTE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      window.removeEventListener(ROUTE_EVENT, update);
    };
  }, []);
  return route;
}
export function closeHelp() {
  if ((history.state?.tgIdx ?? 0) > 0 && history.state?.tgHelp) history.back();
  else { history.replaceState({ tgIdx: 0 }, "", "#/"); window.dispatchEvent(new Event(ROUTE_EVENT)); }
}

/* icons */
const ico = (d) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS = {
  key: ico(<><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 9-9M16 7l3 3M14 9l2 2" /></>),
  compass: ico(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>),
  flow: ico(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6H12a3 3 0 0 1 3 3v.5M8.5 18H12a3 3 0 0 0 3-3v-.5" /></>),
  check: ico(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>),
  warn: ico(<><path d="M12 3 2.5 20h19Z" /><path d="M12 10v4M12 17.5v.01" /></>),
  plus: ico(<path d="M12 5v14M5 12h14" />),
  edit: ico(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  inbox: ico(<><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6Z" /></>),
  grid: ico(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  users: ico(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>),
  userplus: ico(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>),
  video: ico(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>),
  chart: ico(<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>),
  globe: ico(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
  mail: ico(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  cap: ico(<><path d="m2 9 10-5 10 5-10 5Z" /><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" /></>),
  link: ico(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></>),
  gear: ico(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>),
  shield: ico(<><path d="M12 3 4 6v6c0 4.5 3.2 7.5 8 9 4.8-1.5 8-4.5 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>),
  user: ico(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  clock: ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  trash: ico(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>),
  star: ico(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z" />),
  help: ico(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01" /></>),
};
const icon = (name) => ICONS[name] ?? ICONS.help;

/* the header button */
export function HelpButton() {
  const route = useHelpRoute();
  return (
    <button type="button" className={`ghost help-btn ${route.open ? "on" : ""}`} onClick={() => (route.open ? closeHelp() : goHelp())} aria-label="Help guides" aria-pressed={route.open}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01" /></svg>
      Help
    </button>
  );
}

/* text: a tiny markup (paragraphs, "- " bullets, **bold**, `code`) */
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={k++}>{tok.slice(2, -2)}</strong> : <code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Rich({ text }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return blocks.map((b, i) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-\d.]+\s/.test(l) || /^- /.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const Tag = ordered ? "ol" : "ul";
      return <Tag key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*(-|\d+\.)\s+/, ""))}</li>)}</Tag>;
    }
    return <p key={i}>{inline(lines.join(" "))}</p>;
  });
}

/* landing */
function Landing({ guides, audiences }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => (words.length ? guides.filter((g) => {
    const hay = `${g.title} ${g.summary} ${plainText(g)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }) : guides), [q, guides]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = SECTIONS.filter((s) => shown.some((g) => g.section === s));
  return (
    <div className="help-page">
      <div className="help-head">
        <div>
          <h1>Help</h1>
          <p className="muted">Short, step-by-step guides for everything in ThinkGita Circles that you can do as {audiences.label}.</p>
        </div>
        <label className="help-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides, e.g. password" aria-label="Search guides" />
        </label>
      </div>
      {words.length > 0 && <p className="muted small help-count" aria-live="polite">{shown.length} {shown.length === 1 ? "guide" : "guides"} found</p>}
      {sections.map((s) => (
        <section key={s} className="help-section">
          <h2 className="help-section-title">{s}</h2>
          <div className="help-grid">
            {shown.filter((g) => g.section === s).map((g) => (
              <a key={g.id} className="help-card" href={`#/Help/${g.id}`} onClick={(e) => { e.preventDefault(); goHelp(g.id); }}>
                <span className="help-card-icon">{icon(g.icon)}</span>
                <span className="help-card-body">
                  <span className="help-card-title">{g.title}</span>
                  <span className="help-card-sum">{g.summary}</span>
                  <span className="help-card-meta">{g.steps.length} steps · about {minutesFor(g)} min</span>
                </span>
                <span className="help-chev" aria-hidden="true">›</span>
              </a>
            ))}
          </div>
        </section>
      ))}
      {!shown.length && <p className="card help-empty">No guides match "{q}". Try a shorter word, such as "circle" or "email".</p>}
    </div>
  );
}

/* one guide */
function Guide({ guide, guides }) {
  const [zoom, setZoom] = useState(null);
  const [copied, setCopied] = useState(false);
  const i = guides.findIndex((g) => g.id === guide.id);
  const prev = guides[i - 1], next = guides[i + 1];
  const related = (guide.related ?? []).map((id) => guides.find((g) => g.id === id)).filter(Boolean);
  useEffect(() => { document.title = `${guide.title} · Help · ThinkGita Circles`; return () => { document.title = "ThinkGita Circles"; }; }, [guide.title]);
  useEffect(() => {
    if (!zoom) return undefined;
    const esc = (e) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [zoom]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(location.href); } catch { /* clipboard blocked: the address bar still has it */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="help-guide-layout">
      <nav className="help-rail" aria-label="All guides">
        <a className="help-rail-all" href="#/Help" onClick={(e) => { e.preventDefault(); goHelp(); }}>{ICONS.help} All guides</a>
        <ol>
          {guides.map((g, n) => (
            <li key={g.id}>
              <a href={`#/Help/${g.id}`} className={g.id === guide.id ? "on" : ""} aria-current={g.id === guide.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); goHelp(g.id); }}>
                <span className="n">{n + 1}</span>{g.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="help-article">
        <select className="help-jump" value={guide.id} onChange={(e) => goHelp(e.target.value)} aria-label="Jump to another guide">
          {guides.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <p className="muted small help-kicker">Guide {i + 1} of {guides.length} · {guide.section}</p>
        <div className="help-title-row">
          <div>
            <h1>{guide.title}</h1>
            <p className="help-lead">{guide.summary}</p>
          </div>
          <div className="help-tools">
            <button type="button" className="link small" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
            <button type="button" className="link small" onClick={() => window.print()}>Print or save as PDF</button>
          </div>
        </div>
        {guide.steps.map((s, n) => (
          <section key={n} className="help-step card">
            <h2><span className="help-num">{n + 1}</span>{s.title}</h2>
            <div className="help-body"><Rich text={s.body} /></div>
            {s.note && <div className="help-note"><Rich text={s.note} /></div>}
            {s.shot && (
              <figure className="help-shot">
                <button type="button" onClick={() => setZoom(s)} aria-label={`Enlarge screenshot: ${s.alt ?? s.title}`}>
                  <img src={`${BASE}help/${s.shot}.webp`} alt={s.alt ?? s.title} loading="lazy" />
                </button>
              </figure>
            )}
          </section>
        ))}
        {related.length > 0 && (
          <div className="help-related card">
            <h2>Related guides</h2>
            <ul>{related.map((g) => <li key={g.id}><a href={`#/Help/${g.id}`} onClick={(e) => { e.preventDefault(); goHelp(g.id); }}>{g.title}</a></li>)}</ul>
          </div>
        )}
        <div className="help-pager">
          {prev ? <a href={`#/Help/${prev.id}`} onClick={(e) => { e.preventDefault(); goHelp(prev.id); }}>‹ {prev.title}</a> : <span />}
          {next ? <a href={`#/Help/${next.id}`} onClick={(e) => { e.preventDefault(); goHelp(next.id); }}>{next.title} ›</a> : <span />}
        </div>
      </article>
      {zoom && (
        <div className="help-zoom" role="dialog" aria-label="Screenshot" onClick={() => setZoom(null)}>
          <img src={`${BASE}help/${zoom.shot}.webp`} alt={zoom.alt ?? zoom.title} />
          <span className="help-zoom-x">Click anywhere or press Escape to close</span>
        </div>
      )}
    </div>
  );
}

/* the page */
// audiences: { keys: ["admin", "super"], label: "an admin" }
export function HelpPage({ audiences, id }) {
  const guides = useMemo(() => guidesFor(audiences.keys), [audiences.keys.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const guide = id ? guides.find((g) => g.id === id) : null;
  const known = id ? GUIDES.some((g) => g.id === id) : true;
  useEffect(() => { window.scrollTo(0, 0); }, [id]);
  return (
    <main className="content help">
      <div className="help-top">
        <button type="button" className="ghost subtle" onClick={closeHelp}>← Back to the dashboard</button>
      </div>
      {id && !guide && <p className="banner">{known ? "That guide is for a different kind of account, so it isn't listed for you." : "We couldn't find that guide."} Here are all the guides you can use.</p>}
      {guide ? <Guide guide={guide} guides={guides} /> : <Landing guides={guides} audiences={audiences} />}
    </main>
  );
}
