// Sync circles to the ThinkGita website (Framer CMS "Course" collection).
// POST { action: "sync" }            admins: push every circle marked framer_dirty, then publish (if settings.framer_auto_publish).
// POST { action: "sync", all: true } admins: re-push every circle.
// POST { action: "publish" }         admins: publish the site now (retries a failed publish).
// The cron tick (public.framer_sync_tick, every 2 minutes) calls { action: "sync" } with the x-cron-secret header when
// circles are dirty or a publish is pending, so failed publishes and changes made outside the dashboard still go live.
// Publishing is tracked in settings.framer_publish_pending: it is set when a published (or to-be-published) item changes
// and cleared only when Framer accepts the publish. Changes to draft-only items do not trigger a publish.
// A circle's website item is a draft unless circles.website_visible is on and the circle is live or awaiting approval.
// New items get every field; items that already existed (taken over) only get draft, Time and Lesson updated,
// so hand-made titles, names and photos in Framer are kept. Images and LessonNumber are never touched.
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

// ---------- Website text ----------
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ: Record<string, string> = {
  "Europe/London": "UK", "Europe/Paris": "CET", "Europe/Berlin": "CET", "Europe/Madrid": "CET", "Europe/Rome": "CET",
  "Europe/Prague": "CET", "Europe/Warsaw": "CET", "Europe/Bratislava": "CET", "Europe/Athens": "EET",
  "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MST", "America/Los_Angeles": "PT",
  "America/Mexico_City": "CDMX", "America/Bogota": "COT", "America/Guayaquil": "ECT", "America/Lima": "PET",
  "America/Argentina/Buenos_Aires": "ART", "America/Sao_Paulo": "BRT", "Asia/Kolkata": "IST", "Asia/Dubai": "GST",
  "Asia/Seoul": "KST", "Asia/Singapore": "SGT", "Australia/Sydney": "AET", "Africa/Johannesburg": "SAST", "Africa/Nairobi": "EAT",
};
const LANG_CODE: Record<string, string> = {
  English: "Eng", Spanish: "Esp", Hindi: "Hin", Portuguese: "Por", Greek: "Gre", Italian: "Ita", French: "Fra", Slovak: "Slk", Czech: "Cze", Polish: "Pol",
};
const LANGS = Object.keys(LANG_CODE);

function clock(t: string) {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
const tzLabel = (tz: string) => TZ[tz] ?? tz.split("/").pop()!.replace(/_/g, " ");
const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
function shortDate(iso: string) { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
function utmDate(iso: string) { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`; }
const slugify = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Host name as people know it: the name in the Zoom title for imported circles ("TG Circles | Mon | 7.30pm UK | Anjali"),
// otherwise the facilitator's initiated name, otherwise their name (co-facilitators joined with "&").
function hostName(c: any) {
  const segs = String(c.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!c.name_auto && /^TG\b/i.test(segs[0] ?? "") && segs.length >= 3) {
    const rest = segs.slice(2).filter((s) => !/\d/.test(s) && !LANGS.includes(s));
    if (rest.length) return rest.join(" & ").replace(/\s+/g, " ");
  }
  const people = [c.facilitator, ...(c.cofacilitators ?? []).map((x: any) => x.facilitator)].filter(Boolean);
  const names = people.map((p: any) => (p.initiated_name || p.name || "").trim()).filter((n: string) => n && !n.includes("@"));
  return names.join(" & ") || "Think Gita facilitator";
}
function title(c: any) {
  const lang = c.language || "English";
  const type = c.circle_type || "Gita Circle";
  if (/bhakti/i.test(type)) return `Bhakti Circles (${lang})`;
  if (/sadhana/i.test(type)) return `Think Sadhana (${lang})`;
  if (/reading/i.test(type)) return `Gita Reading Circle (${lang})`;
  if (/japa/i.test(type)) return `Morning Japa (${lang})`;
  return lang === "Spanish" ? "Gita Circulos (Espanol)" : `Gita Circles (${lang})`;
}
const timeText = (c: any) => `${clock(c.start_time)} ${tzLabel(c.timezone)} | ${DAYS[c.weekday]}s`;
const lessonText = (c: any) => (c.starts_on && c.starts_on > ukToday() ? `Starts ${shortDate(c.starts_on)}` : "Weekly");
function link(c: any) {
  const p = [
    `utm_facilitator=${encodeURIComponent(hostName(c))}`, "utm_course=Circle", `utm_lang=${LANG_CODE[c.language || "English"] ?? "Eng"}`,
  ];
  if (c.starts_on) p.push(`utm_date=${utmDate(c.starts_on)}`);
  if (c.whatsapp_group_link) p.push(`utm_wagrp=${c.whatsapp_group_link}`);
  return `${SIGNUP}?${p.join("&")}`;
}
const s = (value: string) => ({ type: "string", value });
function fullFields(c: any) {
  return {
    [F.title]: s(title(c)), [F.description]: s(DESCRIPTION), [F.time]: s(timeText(c)), [F.lesson]: s(lessonText(c)),
    [F.author]: s(hostName(c)), [F.link]: { type: "link", value: link(c) },
    [F.mainImg]: { type: "image", value: c.language === "Spanish" ? BANNER.spanish : BANNER.other },
  };
}
function updateFields(c: any) {
  const f: Record<string, unknown> = { [F.time]: s(timeText(c)) };
  if (c.starts_on && c.starts_on > ukToday()) f[F.lesson] = s(lessonText(c));
  if (c.framer_created) Object.assign(f, { [F.title]: s(title(c)), [F.author]: s(hostName(c)), [F.link]: { type: "link", value: link(c) } });
  return f;
}
const isTest = (c: any) => c.is_demo || /\btest\b/i.test(c.name ?? "") || c.licence?.is_mock;
// Live circles always have an item (hidden unless switched on). Circles awaiting approval only get one when an
// admin switches them on, so upcoming circles can be advertised before their Zoom meeting exists.
const UPCOMING = ["pending", "approved"];
const wantsItem = (c: any) => !isTest(c) && (["live", "paused"].includes(c.status) || (c.website_visible && UPCOMING.includes(c.status)));
const draftFor = (c: any) => !(c.website_visible && !isTest(c) && ["live", ...UPCOMING].includes(c.status));

// ---------- Sync ----------
async function loadCircles(all: boolean) {
  let q = db.from("circles").select("*, facilitator:facilitators!circles_facilitator_id_fkey(*), cofacilitators:circle_cofacilitators(facilitator:facilitators(*)), licence:licences(is_mock)");
  if (!all) q = q.eq("framer_dirty", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function sync(actor: string, { all = false, preview = false } = {}) {
  const circles = await loadCircles(all);
  if (preview) {
    return circles.filter(wantsItem).map((c) => ({
      circle: c.name, item: c.framer_item_id, draft: draftFor(c), title: title(c), time: timeText(c), lesson: lessonText(c), author: hostName(c), link: link(c),
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
        if (!(existing as any).draft || !draftFor(c)) needsPublish = true;
        updates.push({ c, input: { id: existing.id, draft: draftFor(c), fieldData: updateFields(c) } });
        done.push({ c, patch: {} });
      } else {
        const base = slugify(`${hostName(c).split(/[ &]/)[0]}-${DAYS[c.weekday].slice(0, 3)}${String(c.start_time).slice(0, 5).replace(":", "")}`) || "circle";
        let slug = base;
        for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
        slugs.add(slug);
        if (!draftFor(c)) needsPublish = true;
        creates.push({ c, slug, input: { slug, draft: draftFor(c), fieldData: fullFields(c) } });
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
        if (id) { result.created++; done.push({ c: x.c, patch: { framer_item_id: id, framer_created: true } }); }
        else { x.c.__error ??= "Framer did not return the new item"; done.push({ c: x.c, patch: {} }); }
      }
    }

    const now = new Date().toISOString();
    for (const { c, patch } of done) {
      const err = c.__error ?? null;
      await db.from("circles").update({
        ...patch, ...(c.framer_item_id === null && !patch.framer_item_id ? { framer_item_id: null } : {}),
        framer_dirty: Boolean(err), framer_error: err, framer_synced_at: err ? c.framer_synced_at : now,
      }).eq("id", c.id);
    }

    if (needsPublish) await db.from("settings").update({ framer_publish_pending: true }).eq("id", 1);
    if (autoPublish && (needsPublish || settings?.framer_publish_pending)) result.published = await publishNow(framer);
  } finally {
    await framer.disconnect();
  }
  await db.from("audit_log").insert({ actor, action: "framer_sync", circle_id: null, detail: result });
  return result;
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
    try { return json(await withLock(() => sync("cron"))); }
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
    if (body.action === "publish") return json(await withLock(() => publishOnly(email)));
    if (body.action === "preview") return json(await sync(email, { all: true, preview: true }));
    return json({ error: `Unknown action ${body.action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
