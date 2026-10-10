// Sync circles to the ThinkGita website (Framer CMS "Course" collection).
// POST { action: "sync" }            admins: push every circle marked framer_dirty, then publish (if settings.framer_auto_publish).
// POST { action: "sync", all: true } admins: re-push every circle.
// POST { action: "snapshot" }        admins: read-only. Every Course item with its current values, and for linked circles
//                                   the values the sync would write, so edits made in Framer can be spotted.
// POST { action: "publish" }         admins: publish the site now (retries a failed publish).
// The cron tick (public.framer_sync_tick, every 2 minutes) calls { action: "sync" } with the x-cron-secret header when
// circles are dirty or a publish is pending, so failed publishes and changes made outside the dashboard still go live.
// Publishing is tracked in settings.framer_publish_pending: it is set when a published (or to-be-published) item changes
// and cleared only when Framer accepts the publish. Changes to draft-only items do not trigger a publish.
// A circle's website item is a draft unless circles.website_visible is on, the circle is live or awaiting approval,
// and websiteMissing() is empty (photo, display name, WhatsApp link, start date, day, time, zone, language, order).
// A circle switched on but not ready stays a draft and the reason goes in circles.framer_error.
// New items get every field; items that already existed (taken over) get draft, Time, Lesson and LessonNumber, and their
// hand-made title, name, link and photo are kept unless the dashboard sets an explicit website name or circle photo.
// Fields the database has no value for are never sent, so nothing in Framer is cleared. Unchanged items are skipped.
import { createClient } from "npm:@supabase/supabase-js@2";
import { connect } from "npm:framer-api@5.1.0";

const PROJECT = "https://framer.com/projects/TG-Website--qRrgdVWKlkJWyRr5RnfU-WcFk0";
const COLLECTION = "xsdOXNmfm";
const F = { // Course field ids
  lessonNumber: "t3ANvge1d", title: "jwZTR596c", mainImg: "L1zzJ589Z", description: "foU7VPXnb", time: "feLBW0Bf0",
  lesson: "vaK008A_n", author: "jAVGSOlAT", authorImg: "zZJETidY_", link: "MPRrN1E7r",
};
const BANNER = {
  spanish: "https://framerusercontent.com/images/zv0hUERP9jGrZ6druwMfeHhyrI.png",
  other: "https://framerusercontent.com/images/KvvRQ9Hlu2seJApFMY9GBoKshI.png",
};
const DESCRIPTION = "Start your growth journey with like-minded community & an expert facilitator";
const SIGNUP = "https://forms.thinkgita.org/circlesignup";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ===== Website text =====
// Matches the hand-made, approved listings (e.g. "Gita Circles (Slovak)", "10:30am CEST | Sundays", "Starts 18 Oct").
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Labels that never change with the season (ET, PT, UK and AET cover both halves of the year on purpose).
const TZ: Record<string, string> = {
  "Europe/London": "UK", "Europe/Dublin": "Ireland", "Europe/Moscow": "MSK", "Europe/Kaliningrad": "EET",
  "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MST", "America/Los_Angeles": "PT",
  "America/Halifax": "AT", "America/St_Johns": "NT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HST",
  "America/Mexico_City": "CDMX", "America/Bogota": "COT", "America/Guayaquil": "ECT", "America/Lima": "PET", "America/Caracas": "VET",
  "America/Argentina/Buenos_Aires": "ART", "America/Sao_Paulo": "BRT", "Asia/Kolkata": "IST", "Asia/Dubai": "GST",
  "Asia/Karachi": "PKT", "Asia/Kathmandu": "NPT", "Asia/Bangkok": "ICT", "Asia/Hong_Kong": "HKT", "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST", "Asia/Singapore": "SGT", "Australia/Sydney": "AET", "Australia/Perth": "AWST", "Pacific/Fiji": "FJT",
  "Africa/Johannesburg": "SAST", "Africa/Nairobi": "EAT",
};
// Zones whose usual abbreviation changes in summer: [standard UTC offset in minutes, winter label, summer label].
const CET: [number, string, string] = [60, "CET", "CEST"];
const EET: [number, string, string] = [120, "EET", "EEST"];
const TZ_DST: Record<string, [number, string, string]> = {
  "Europe/Paris": CET, "Europe/Berlin": CET, "Europe/Madrid": CET, "Europe/Rome": CET, "Europe/Prague": CET, "Europe/Warsaw": CET,
  "Europe/Bratislava": CET, "Europe/Brussels": CET, "Europe/Copenhagen": CET, "Europe/Amsterdam": CET, "Europe/Vienna": CET,
  "Europe/Stockholm": CET, "Europe/Oslo": CET, "Europe/Zagreb": CET, "Europe/Budapest": CET, "Europe/Ljubljana": CET,
  "Europe/Athens": EET, "Europe/Bucharest": EET, "Europe/Helsinki": EET, "Europe/Sofia": EET,
  "Europe/Lisbon": [0, "WET", "WEST"], "Pacific/Auckland": [720, "NZST", "NZDT"], "Australia/Adelaide": [570, "ACST", "ACDT"],
};
// utm_lang codes the signup form already receives; other languages use their first three letters.
const LANG_CODE: Record<string, string> = {
  English: "Eng", Spanish: "Esp", Hindi: "Hin", Portuguese: "Por", Greek: "Gre", Italian: "Ita", French: "Fra", Slovak: "Slk", Czech: "Cze", Polish: "Pol",
};
const LANGS = [...Object.keys(LANG_CODE), "Norwegian", "Bengali", "Croatian", "Dutch", "Tamil", "German", "Russian"];
const langCode = (lang: string) => LANG_CODE[lang] ?? (lang.slice(0, 3).charAt(0).toUpperCase() + lang.slice(1, 3).toLowerCase());

function clock(t: string) {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
function validTz(tz: string | null | undefined) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
// UTC offset of a zone at an instant, in minutes.
function offsetMinutes(tz: string, at: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
const localToday = (tz: string) => new Date().toLocaleDateString("en-CA", { timeZone: validTz(tz) ? tz : "Europe/London" });
// Advertised start date: the confirmed start, or for circles awaiting approval the facilitator's preferred start.
const startDate = (c: any): string | null => c.starts_on ?? (UPCOMING.includes(c.status) ? c.preferred_start : null) ?? null;
const RUNNING = ["live", "paused"];
// Date (YYYY-MM-DD, in the circle's own zone) of the next session: the start date while it is ahead, else the next weekday match.
function nextSessionDate(c: any) {
  const today = localToday(c.timezone);
  const start = startDate(c);
  if (start && start >= today) return start;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((Number(c.weekday) - (d.getUTCDay() || 7) + 7) % 7));
  return d.toISOString().slice(0, 10);
}
// Label for the zone as it applies on the next session (CEST in summer, CET in winter); labels like UK, CDMX, ECT unchanged.
function tzLabel(c: any) {
  const tz = c.timezone;
  const dst = TZ_DST[tz];
  if (dst && validTz(tz) && c.weekday && c.start_time) {
    const [y, mo, d] = nextSessionDate(c).split("-").map(Number);
    const [h, mi] = String(c.start_time).split(":").map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    const at = new Date(wall - offsetMinutes(tz, new Date(wall)) * 60_000);
    return offsetMinutes(tz, at) > dst[0] ? dst[2] : dst[1];
  }
  return dst?.[1] ?? TZ[tz] ?? String(tz ?? "").split("/").pop()!.replace(/_/g, " ");
}
function shortDate(iso: string) { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
function utmDate(iso: string) { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`; }
const slugify = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const listJoin = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}` : xs.join(" & "));

// Host names as people know them: the name in the Zoom title for imported circles ("TG Circles | Mon | 7.30pm UK | Anjali"),
// otherwise each facilitator's initiated name, otherwise their name. Empty when nobody has a usable name.
function hostNames(c: any): string[] {
  const segs = String(c.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!c.name_auto && /^TG\b/i.test(segs[0] ?? "") && segs.length >= 3) {
    const rest = segs.slice(2).filter((s) => !/\d/.test(s) && !LANGS.includes(s));
    if (rest.length) return [rest.join(" & ").replace(/\s+/g, " ")];
  }
  const people = [c.facilitator, ...(c.cofacilitators ?? []).map((x: any) => x.facilitator)].filter(Boolean);
  return people.map((p: any) => (p.initiated_name || p.name || "").trim()).filter((n: string) => n && !n.includes("@"));
}
// Fuller name, used in utm_facilitator (e.g. "Ananda-rupa Krsna das") and the slug.
const hostName = (c: any) => hostNames(c).join(" & ") || "Think Gita facilitator";
// Short name on the card (AuthorName, e.g. "Ananda-rupa"): the dashboard's website name, else the host names.
const displayName = (c: any) => (c.website_name ?? "").trim() || listJoin(hostNames(c));
// Photo on the card (AuthorImg): the circle's own photo, else the lead facilitator's.
const photoFor = (c: any): string | null => (c.website_photo_url ?? "").trim() || (c.facilitator?.photo_url ?? "").trim() || null;
const isBeginners = (c: any) => /beginner/i.test(c.circle_type ?? "");
function title(c: any) {
  const lang = c.language || "English";
  const type = c.circle_type || "Gita Circle";
  if (isBeginners(c)) return `Gita Beginners (${lang})`;
  if (/bhakti/i.test(type)) return `Bhakti Circles (${lang})`;
  if (/sadhana/i.test(type)) return `Think Sadhana (${lang})`;
  if (/reading/i.test(type)) return `Gita Reading Circle (${lang})`;
  if (/japa/i.test(type)) return `Morning Japa (${lang})`;
  return lang === "Spanish" ? "Gita Circulos (Espanol)" : `Gita Circles (${lang})`;
}
const timeText = (c: any) => `${clock(c.start_time)} ${tzLabel(c)} | ${DAYS[c.weekday]}s`;
// "Weekly sessions on Zoom (75 mins)" is fixed text on the card, so a running circle says it can be joined now.
const ONGOING = "Join anytime";
const hasStarted = (c: any) => { const st = startDate(c); return st ? st <= localToday(c.timezone) : RUNNING.includes(c.status); };
const lessonText = (c: any) => (hasStarted(c) ? ONGOING : `Starts ${shortDate(startDate(c)!)}`);
// Same format as the working hand-made links: encoded facilitator name, capitalised codes, raw WhatsApp URL last.
function link(c: any) {
  const p = [
    `utm_facilitator=${encodeURIComponent(hostName(c))}`, `utm_course=${isBeginners(c) ? "Beg" : "Circle"}`,
    `utm_lang=${langCode(c.language || "English")}`,
  ];
  const st = startDate(c);
  if (st) p.push(`utm_date=${utmDate(st)}`);
  if (c.whatsapp_group_link) p.push(`utm_wagrp=${c.whatsapp_group_link.trim()}`);
  return `${SIGNUP}?${p.join("&")}`;
}

// ===== Ready for the website =====
// A circle is only published (draft:false) when this list is empty. Mirrored in app/src/WebsiteFields.jsx: keep in step.
const READINESS_PREFIX = "Not shown on the website until set: ";
// `has` says what the circle's Framer item already holds (circles.framer_has, written by the sync), so a hand-made item
// with its own photo, order or WhatsApp link counts as ready without copying those into the dashboard.
type Has = { photo?: boolean; order?: boolean; name?: boolean; whatsapp?: boolean; link?: boolean };
function hasFrom(it: any): Has {
  if (!it) return {};
  const lk = String(fv(it, F.link) ?? "");
  return {
    photo: Boolean(fv(it, F.authorImg)), order: Boolean(String(fv(it, F.lessonNumber) ?? "").trim()), name: Boolean(String(fv(it, F.author) ?? "").trim()),
    whatsapp: /utm_wagrp=https?:/i.test(lk), link: Boolean(lk),
  };
}
function websiteMissing(c: any, has: Has = c.framer_has ?? {}): string[] {
  const m: string[] = [];
  // Hand-made items taken over from Framer keep their own link, so their start date is theirs to manage.
  const handMade = !c.framer_created && has.link;
  if (!photoFor(c) && !has.photo) m.push("photo");
  if (!displayName(c) && !has.name) m.push("display name");
  if (!/^https?:\/\/\S+$/i.test((c.whatsapp_group_link ?? "").trim()) && !has.whatsapp) m.push("WhatsApp group link");
  const st = startDate(c);
  if (!RUNNING.includes(c.status) && !handMade) {
    if (!st) m.push("start date");
    else if (st < localToday(c.timezone)) m.push("start date (it is in the past)");
  }
  if (!(c.weekday >= 1 && c.weekday <= 7)) m.push("weekday");
  if (!c.start_time) m.push("start time");
  if (!validTz(c.timezone)) m.push("timezone");
  if (!c.language) m.push("language");
  if (!(c.website_order > 0) && !has.order) m.push("website order");
  return m;
}

// ===== CMS fields =====
const s = (value: string) => ({ type: "string", value });
const fv = (it: any, id: string) => { const v = it?.fieldData?.[id]?.value; return v && typeof v === "object" ? (v.url ?? null) : (v ?? null); };
// What the sync writes for a circle. `existing` is its current Framer item (null for a new one).
// New items and items the sync created get every field. Items taken over from hand-made ones keep their title, name,
// link and photo unless the dashboard holds an explicit value (website name, circle photo, order). Nothing is ever
// cleared: a field the database has no value for is left out, so Framer keeps what it has.
function fieldsFor(c: any, existing: any = null) {
  const own = !existing || c.framer_created;
  const f: Record<string, any> = { [F.time]: s(timeText(c)) };
  // Hand-made items of circles not yet live keep their own Lesson text (e.g. "Starts 8 Oct").
  if ((startDate(c) || RUNNING.includes(c.status)) && (own || RUNNING.includes(c.status))) f[F.lesson] = s(lessonText(c));
  if (c.website_order > 0) f[F.lessonNumber] = s(String(c.website_order));
  const photo = photoFor(c);
  const hasImg = Boolean(fv(existing, F.authorImg));
  if (photo && (!hasImg || (photo !== c.framer_photo_src && (own || (c.website_photo_url ?? "").trim())))) {
    f[F.authorImg] = { type: "image", value: photo };
  }
  if (own) {
    Object.assign(f, {
      [F.title]: s(title(c)), [F.description]: s(DESCRIPTION), [F.link]: { type: "link", value: link(c) },
      [F.mainImg]: { type: "image", value: c.language === "Spanish" ? BANNER.spanish : BANNER.other },
    });
    if (displayName(c)) f[F.author] = s(displayName(c));
  } else {
    if ((c.website_name ?? "").trim()) f[F.author] = s(displayName(c));
    if (!fv(existing, F.link)) f[F.link] = { type: "link", value: link(c) };
  }
  for (const [k, v] of Object.entries(f)) if (v.value === "" || v.value == null) delete f[k];
  return f;
}
// Only the fields whose value differs from the Framer item (images are tracked through framer_photo_src instead).
function changedFields(f: Record<string, any>, existing: any) {
  if (!existing) return f;
  return Object.fromEntries(Object.entries(f).filter(([id, v]) => v.type === "image" ? id === F.authorImg || !fv(existing, id) : fv(existing, id) !== v.value));
}
const isTest = (c: any) => c.is_demo || /\btest\b/i.test(c.name ?? "") || c.licence?.is_mock;
// Live circles always have an item (hidden unless switched on). Circles awaiting approval only get one when an
// admin switches them on, so upcoming circles can be advertised before their Zoom meeting exists.
const UPCOMING = ["pending", "approved"];
const wantsItem = (c: any) => !isTest(c) && (RUNNING.includes(c.status) || (c.website_visible && UPCOMING.includes(c.status)));
const wantsShown = (c: any) => Boolean(c.website_visible) && !isTest(c) && ["live", ...UPCOMING].includes(c.status);
const draftFor = (c: any, has?: Has) => !(wantsShown(c) && websiteMissing(c, has).length === 0);
// Reason an item is held back even though the admin switched it on (kept in framer_error for the dashboard).
const readinessNote = (c: any, has?: Has) => (wantsShown(c) && websiteMissing(c, has).length ? READINESS_PREFIX + websiteMissing(c, has).join(", ") : null);

// ===== Sync =====
async function loadCircles(all: boolean) {
  let q = db.from("circles").select("*, facilitator:facilitators!circles_facilitator_id_fkey(*), cofacilitators:circle_cofacilitators(facilitator:facilitators(*)), licence:licences(is_mock)");
  if (!all) q = q.eq("framer_dirty", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// A failure before any circle is handled (bad key, Framer down, collection renamed) is recorded in settings so the
// dashboard shows it and the cron tick backs off instead of retrying every 2 minutes.
async function sync(actor: string, opts: { all?: boolean; preview?: boolean } = {}) {
  try {
    const r = await syncInner(actor, opts);
    if (!opts.preview) await db.from("settings").update({ framer_last_error: null, framer_fail_count: 0 }).eq("id", 1).gt("framer_fail_count", 0);
    return r;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!opts.preview) {
      const { data: st } = await db.from("settings").select("framer_fail_count").eq("id", 1).single();
      await db.from("settings").update({ framer_last_error: msg, framer_fail_count: (st?.framer_fail_count ?? 0) + 1, framer_failed_at: new Date().toISOString() }).eq("id", 1);
      await db.from("audit_log").insert({ actor, action: "framer_sync", circle_id: null, detail: { failed: msg } });
    }
    throw e;
  }
}

async function syncInner(actor: string, { all = false, preview = false } = {}) {
  const circles = await loadCircles(all);
  if (preview) {
    return circles.filter(wantsItem).map((c) => ({
      circle: c.name, item: c.framer_item_id, draft: draftFor(c), missing: websiteMissing(c), title: title(c), time: timeText(c),
      lesson: startDate(c) || RUNNING.includes(c.status) ? lessonText(c) : null, author: displayName(c), photo: photoFor(c),
      order: c.website_order ?? null, link: link(c),
    }));
  }
  const { data: settings } = await db.from("settings").select("framer_auto_publish, framer_publish_pending").eq("id", 1).single();
  const autoPublish = settings?.framer_auto_publish !== false;
  if (!circles.length && !(settings?.framer_publish_pending && autoPublish)) return { changed: 0, published: false, note: "nothing to sync" };

  const framer = await connect(PROJECT, Deno.env.get("FRAMER_API_KEY")!);
  const result = { created: 0, updated: 0, hidden: 0, skipped: 0, errors: [] as string[], published: false as boolean | string };
  let needsPublish = false; // a change touches something visitors can see
  try {
    const col = (await framer.getCollections()).find((x: any) => x.id === COLLECTION);
    if (!col) throw new Error("Course collection not found in Framer");
    const items = await col.getItems();
    const byId = new Map(items.map((it: any) => [it.id, it]));
    const slugs = new Set(items.map((it: any) => it.slug));

    const creates: { c: any; slug: string; input: any }[] = [];
    const updates: { c: any; input: any }[] = [];
    const done: { c: any; patch: Record<string, unknown> }[] = [];

    for (const c of circles) {
      const existing = c.framer_item_id ? byId.get(c.framer_item_id) : null;
      if (c.framer_item_id && !existing) {
        // Item was deleted in Framer: forget it, and recreate if the circle still needs one.
        c.framer_item_id = null; c.framer_created = false;
      }
      if (!wantsItem(c)) {
        if (existing && !(existing as any).draft) { updates.push({ c, input: { id: existing.id, draft: true } }); result.hidden++; needsPublish = true; }
        else result.skipped++;
        done.push({ c, patch: {} });
        continue;
      }
      if (existing) {
        const ex = existing as any;
        const has = hasFrom(ex);
        c.__has = has;
        const draft = draftFor(c, has);
        const fieldData = changedFields(fieldsFor(c, ex), ex);
        if (fieldData[F.authorImg]) has.photo = true;
        if (fieldData[F.lessonNumber]) has.order = true;
        const photo = { framer_has: has, ...(fieldData[F.authorImg] ? { framer_photo_src: photoFor(c) } : {}) };
        if (Object.keys(fieldData).length || ex.draft !== draft) {
          // Only a change visitors can see (a shown item, or one being shown or hidden) needs a publish.
          if (!ex.draft || !draft) needsPublish = true;
          updates.push({ c, input: { id: ex.id, draft, ...(Object.keys(fieldData).length ? { fieldData } : {}) } });
        } else result.skipped++;
        done.push({ c, patch: photo });
      } else {
        const base = slugify(`${hostName(c).split(/[ &]/)[0]}-${DAYS[c.weekday].slice(0, 3)}${String(c.start_time).slice(0, 5).replace(":", "")}`) || "circle";
        let slug = base;
        for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
        slugs.add(slug);
        c.__has = {};
        if (!draftFor(c, {})) needsPublish = true;
        creates.push({ c, slug, input: { slug, draft: draftFor(c, {}), fieldData: fieldsFor(c) } });
      }
    }

    for (let i = 0; i < updates.length; i += 25) {
      const batch = updates.slice(i, i + 25);
      try { await col.addItems(batch.map((u) => u.input)); result.updated += batch.filter((u) => u.input.fieldData).length; }
      catch (e) { for (const u of batch) { u.c.__error = String(e).slice(0, 300); } result.errors.push(String(e).slice(0, 300)); }
    }
    if (creates.length) {
      for (let i = 0; i < creates.length; i += 25) {
        const batch = creates.slice(i, i + 25);
        try { await col.addItems(batch.map((x) => x.input)); }
        catch (e) { for (const x of batch) x.c.__error = String(e).slice(0, 300); result.errors.push(String(e).slice(0, 300)); }
      }
      const fresh = await col.getItems();
      const bySlug = new Map(fresh.map((it: any) => [it.slug, it.id]));
      for (const x of creates) {
        const id = bySlug.get(x.slug);
        if (id) {
          result.created++;
          const fd = x.input.fieldData;
          const has: Has = { photo: Boolean(fd[F.authorImg]), order: Boolean(fd[F.lessonNumber]), name: Boolean(fd[F.author]), whatsapp: /utm_wagrp=/.test(fd[F.link]?.value ?? ""), link: Boolean(fd[F.link]) };
          done.push({ c: x.c, patch: { framer_item_id: id, framer_created: true, framer_has: has, ...(fd[F.authorImg] ? { framer_photo_src: photoFor(x.c) } : {}) } });
        }
        else { x.c.__error ??= "Framer did not return the new item"; done.push({ c: x.c, patch: {} }); }
      }
    }

    const now = new Date().toISOString();
    for (const { c, patch } of done) {
      const err = c.__error ?? null;
      // A failed push stays dirty (retried); a circle held back as a draft for missing fields is not retried,
      // its reason is shown in the dashboard and editing the missing field marks it dirty again.
      // framer_synced_at changes on success, so the dirty trigger does not count this write as a new edit.
      await db.from("circles").update({
        ...(err ? {} : patch), ...(c.framer_item_id === null && !patch.framer_item_id ? { framer_item_id: null } : {}),
        framer_error: err ?? readinessNote(c, c.__has), framer_synced_at: err ? c.framer_synced_at : now, ...(err ? { framer_dirty: true } : {}),
      }).eq("id", c.id);
      // Clear the flag only if nobody changed the circle while this sync ran (each edit bumps framer_rev).
      if (!err) await db.from("circles").update({ framer_dirty: false }).eq("id", c.id).eq("framer_rev", c.framer_rev ?? 0);
    }

    if (needsPublish) await db.from("settings").update({ framer_publish_pending: true }).eq("id", 1);
    if (autoPublish && (needsPublish || settings?.framer_publish_pending)) result.published = await publishNow(framer);
  } finally {
    await framer.disconnect();
  }
  await db.from("audit_log").insert({ actor, action: "framer_sync", circle_id: null, detail: result });
  return result;
}

// Read-only comparison of the CMS with what the sync would write.
async function snapshot() {
  const circles = await loadCircles(true);
  const byItem = new Map(circles.filter((c) => c.framer_item_id).map((c) => [c.framer_item_id, c]));
  const framer = await connect(PROJECT, Deno.env.get("FRAMER_API_KEY")!);
  try {
    const col = (await framer.getCollections()).find((x: any) => x.id === COLLECTION);
    if (!col) throw new Error("Course collection not found in Framer");
    const items = await col.getItems();
    const fields = await col.getFields();
    const val = (it: any, id: string) => { const v = it.fieldData?.[id]?.value; return v && typeof v === "object" ? (v.url ?? v.id ?? null) : (v ?? null); };
    const allFields = (it: any) => Object.fromEntries(fields.map((f: any) => [f.name, val(it, f.id)]));
    return items.map((it: any) => {
      const c = byItem.get(it.id);
      const current = {
        title: val(it, F.title), time: val(it, F.time), lesson: val(it, F.lesson), author: val(it, F.author), link: val(it, F.link),
        description: val(it, F.description), mainImg: val(it, F.mainImg), authorImg: val(it, F.authorImg), lessonNumber: val(it, F.lessonNumber),
      };
      const all = allFields(it);
      if (!c) return { id: it.id, slug: it.slug, draft: it.draft, circle: null, current, all };
      const w: any = fieldsFor(c, it);
      const expected: Record<string, unknown> = { draft: wantsItem(c) ? draftFor(c, hasFrom(it)) : true };
      for (const [k, id] of Object.entries(F)) if (w[id]) expected[k] = w[id].value;
      return {
        id: it.id, slug: it.slug, draft: it.draft,
        circle: { id: c.id, name: c.name, status: c.status, website_visible: c.website_visible, created: c.framer_created, missing: websiteMissing(c, hasFrom(it)) },
        current, expected, all,
      };
    });
  } finally {
    await framer.disconnect();
  }
}

// Publish and deploy to production. Framer refuses while a previous publish is still processing
// ("Publishing is currently unavailable"), so wait and try once more before leaving it to the cron tick.
async function publishNow(framer: any): Promise<true | string> {
  let err = "";
  for (const wait of [0, 20_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const { deployment } = await framer.publish();
      await framer.deploy(deployment.id);
      await db.from("settings").update({
        framer_publish_pending: false, framer_publish_error: null, framer_publish_attempts: 0,
        framer_published_at: new Date().toISOString(), framer_publish_tried_at: new Date().toISOString(),
      }).eq("id", 1);
      return true;
    } catch (e) { err = String(e).replace(/^\w*Error:\s*/, "").slice(0, 200); }
  }
  const { data: st } = await db.from("settings").select("framer_publish_attempts").eq("id", 1).single();
  await db.from("settings").update({
    framer_publish_pending: true, framer_publish_error: err, framer_publish_tried_at: new Date().toISOString(),
    framer_publish_attempts: (st?.framer_publish_attempts ?? 0) + 1,
  }).eq("id", 1);
  return `not published yet (${err}); it will retry automatically`;
}

async function publishOnly(actor: string) {
  const framer = await connect(PROJECT, Deno.env.get("FRAMER_API_KEY")!);
  let published: true | string;
  try { published = await publishNow(framer); } finally { await framer.disconnect(); }
  await db.from("audit_log").insert({ actor, action: "framer_publish", circle_id: null, detail: { published } });
  return { published };
}

// One sync at a time (the dashboard can trigger several in a row). The lock expires after 3 minutes.
async function withLock<T>(fn: () => Promise<T>) {
  const { data } = await db.from("settings").update({ framer_sync_lock: new Date().toISOString() })
    .eq("id", 1).or(`framer_sync_lock.is.null,framer_sync_lock.lt.${new Date(Date.now() - 180_000).toISOString()}`).select("id");
  if (!data?.length) return { busy: true };
  try { return await fn(); } finally { await db.from("settings").update({ framer_sync_lock: null }).eq("id", 1); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const { data: ok } = await db.rpc("framer_cron_ok", { s: cronSecret });
    if (ok !== true) return json({ error: "Forbidden" }, 403);
    const body = await req.json().catch(() => ({}));
    try { return json(body.action === "snapshot" ? await snapshot() : await withLock(() => sync("cron"))); }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }
  const auth = req.headers.get("Authorization") ?? "";
  const { data: userData } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  const email = userData?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Not signed in" }, 401);
  const { data: admin } = await db.from("admin_emails").select("email").eq("email", email).maybeSingle();
  if (!admin) return json({ error: "Admins only" }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "sync") return json(await withLock(() => sync(email, { all: Boolean(body.all) })));
    if (body.action === "snapshot") return json(await snapshot());
    if (body.action === "publish") return json(await withLock(() => publishOnly(email)));
    if (body.action === "preview") return json(await sync(email, { all: true, preview: true }));
    return json({ error: `Unknown action ${body.action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
