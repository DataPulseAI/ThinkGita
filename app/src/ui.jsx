// Shared UI building blocks: icons, icon buttons, copy buttons, hover card, theme toggle.
import { useLayoutEffect, useRef, useState } from "react";

const svg = (paths) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

export const Icon = {
  edit: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  trash: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>),
  copy: svg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />),
};

export function IconButton({ icon, label, onClick, danger, disabled, title }) {
  return (
    <button
      type="button"
      className={`icon-btn ${danger ? "danger" : ""}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
    >
      {Icon[icon]}
    </button>
  );
}

// Copies `text` and shows a brief "Copied" confirmation.
export function CopyButton({ text, label = "Copy", className = "", primary }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button type="button" className={`copy-btn ${primary ? "primary" : ""} ${copied ? "copied" : ""} ${className}`} onClick={copy} disabled={!text}>
      {copied ? Icon.check : Icon.copy} {copied ? "Copied" : label}
    </button>
  );
}

// Fast custom hover card. Wrap any element; `content` renders in a floating card
// positioned below (or above, if there's no room) and kept inside the viewport.
export function Hover({ content, children }) {
  const anchor = useRef(null);
  const card = useRef(null);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState(null);

  // Measure the wrapped element (the anchor span itself may have no box, e.g. around absolutely positioned blocks).
  const show = () => setRect((anchor.current?.firstElementChild ?? anchor.current)?.getBoundingClientRect() ?? null);
  const hide = () => { setRect(null); setPos(null); };

  useLayoutEffect(() => {
    if (!rect || !card.current) return;
    const { width, height } = card.current.getBoundingClientRect();
    const gap = 8;
    const below = rect.bottom + gap + height <= window.innerHeight;
    const top = below ? rect.bottom + gap : Math.max(8, rect.top - gap - height);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPos({ top, left });
  }, [rect]);

  return (
    <span ref={anchor} className="hover-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {rect && (
        <div ref={card} className="hovercard" role="tooltip" style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
          {content}
        </div>
      )}
    </span>
  );
}

// Light / dark theme, remembered per browser. Light is the default.
export function getTheme() {
  try { return localStorage.getItem("tg-theme") || "light"; } catch { return "light"; }
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("tg-theme", theme); } catch { /* private mode */ }
}
export function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme());
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="ghost theme-toggle"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => { applyTheme(next); setTheme(next); }}
    >
      {theme === "dark" ? Icon.sun : Icon.moon}
    </button>
  );
}
