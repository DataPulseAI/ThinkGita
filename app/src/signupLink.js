// The participant sign-up link for a circle (the Tally form "Think Gita Circles Sign Up"), as the website sync builds it
// in supabase/functions/framer-sync/index.ts link(). Keep the two in step (tests/unit/signup-link.test.js checks they match).
// The form gets the circle's id and name back as hidden fields, so each sign-up is linked to its circle.
export const SIGNUP_FORM = "https://forms.thinkgita.org/circlesignup";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LANG_CODE = {
  English: "Eng", Spanish: "Esp", Hindi: "Hin", Portuguese: "Por", Greek: "Gre", Italian: "Ita", French: "Fra", Slovak: "Slk", Czech: "Cze", Polish: "Pol",
};
const LANGS = [...Object.keys(LANG_CODE), "Norwegian", "Bengali", "Croatian", "Dutch", "Tamil", "German", "Russian"];
const UPCOMING = ["pending", "approved"];
const langCode = (lang) => LANG_CODE[lang] ?? (lang.slice(0, 3).charAt(0).toUpperCase() + lang.slice(1, 3).toLowerCase());
const utmDate = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`; };
const startDate = (c) => c.starts_on ?? (UPCOMING.includes(c.status) ? c.preferred_start : null) ?? null;
const isBeginners = (c) => /beginner/i.test(c.circle_type ?? "");

// Host names as people know them: the name in an imported Zoom title ("TG Circles | Mon | 7.30pm UK | Anjali"), else each
// facilitator's initiated name or name. `c.hosts` (a list of names, from my_circle_link_parts) or the facilitator rows.
export function hostNames(c) {
  const segs = String(c.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!c.name_auto && /^TG\b/i.test(segs[0] ?? "") && segs.length >= 3) {
    const rest = segs.slice(2).filter((s) => !/\d/.test(s) && !LANGS.includes(s));
    if (rest.length) return [rest.join(" & ").replace(/\s+/g, " ")];
  }
  const names = c.hosts ?? [c.facilitator, ...(c.cofacilitators ?? []).map((x) => x.facilitator)]
    .filter(Boolean).map((p) => p.initiated_name || p.name || "");
  return names.map((n) => String(n ?? "").trim()).filter((n) => n && !n.includes("@"));
}

export function signupLink(c) {
  const p = [
    `utm_facilitator=${encodeURIComponent(hostNames(c).join(" & ") || "Think Gita facilitator")}`,
    `utm_course=${isBeginners(c) ? "Beg" : "Circle"}`,
    `utm_lang=${langCode(c.language || "English")}`,
  ];
  const st = startDate(c);
  if (st) p.push(`utm_date=${utmDate(st)}`);
  p.push(`circle_id=${c.id}`, `circle_name=${encodeURIComponent(c.name ?? "")}`);
  // The WhatsApp link goes last and as it is, like the links already in use.
  if (c.whatsapp_group_link) p.push(`utm_wagrp=${c.whatsapp_group_link.trim()}`);
  return `${SIGNUP_FORM}?${p.join("&")}`;
}
