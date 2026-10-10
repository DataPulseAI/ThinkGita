// framer-sync end to end: syncInner, sync, publishNow, setItem and publishOnly against an in-memory
// database and a fake Framer collection. No network.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { connect } from "../stubs/framer-api.js";
import * as fs from "../../../supabase/functions/framer-sync/index.ts";
import { attachFake } from "./helpers/fakeSupabase.js";
import { createFakeFramer } from "./helpers/fakeFramer.js";
import { readyCircle } from "./helpers/circles.js";

vi.mock("../stubs/framer-api.js", () => ({ connect: vi.fn() }));

const { F } = fs;
const NOW = "2026-10-10T12:00:00Z";
const settingsRow = (over = {}) => ({ id: 1, framer_auto_publish: true, framer_publish_pending: false, framer_publish_attempts: 0, framer_fail_count: 0, ...over });

let db, fr;
function setup({ circles = [], items = [], settings = {}, orderType } = {}) {
  db = attachFake(fs.db, { circles, settings: [settingsRow(settings)], audit_log: [] });
  fr = createFakeFramer({ items, orderType });
  connect.mockReset();
  connect.mockResolvedValue(fr.framer);
}
const circleRow = (id = "circle-1") => db.row("circles", id);
const settings = () => db.tables.settings[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

// The item the sync would have created for readyCircle(), as Framer now holds it.
function syncedItem(c, over = {}) {
  return { id: "item-1", slug: "asha-wed1930", draft: false, fieldData: structuredClone(fs.fieldsFor(c)), ...over };
}

describe("syncInner: creating items", () => {
  it("creates a ready, switched-on circle with every field and publishes", async () => {
    setup({ circles: [readyCircle()] });
    const r = await fs.syncInner("admin@example.org");
    expect(r).toMatchObject({ created: 1, updated: 0, errors: [], published: true });
    expect(fr.state.addCalls).toHaveLength(1);
    const [input] = fr.state.addCalls[0];
    expect(input.slug).toBe("asha-wed1930");
    expect(input.draft).toBe(false);
    expect(Object.keys(input.fieldData)).toHaveLength(9);
    expect(fr.state.publishCalls).toBe(1);
    expect(fr.state.deployCalls).toEqual(["dep-1"]);
    expect(fr.state.disconnected).toBe(1);

    const row = circleRow();
    expect(row.framer_item_id).toBe("new-1");
    expect(row.framer_created).toBe(true);
    expect(row.framer_has).toEqual({ photo: true, order: true, name: true, whatsapp: true, link: true });
    expect(row.framer_photo_src).toBe("https://img.example.org/asha.jpg");
    expect(row.framer_error).toBeNull();
    expect(row.framer_dirty).toBe(false);
    expect(row.framer_synced_at).toBe(new Date(NOW).toISOString());
    expect(settings().framer_publish_pending).toBe(false);
    expect(settings().framer_published_at).toBe(new Date(NOW).toISOString());
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "admin@example.org", action: "framer_sync" });
  });

  it("slugs avoid existing ones", async () => {
    setup({ circles: [readyCircle()], items: [{ id: "other", slug: "asha-wed1930", draft: true, fieldData: {} }] });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].slug).toBe("asha-wed1930-2");
  });

  it("a switched-on circle that is not ready is created as a draft with the readiness note, and nothing is published", async () => {
    setup({ circles: [readyCircle({ facilitator: { name: "Asha Example", photo_url: null } })] });
    const r = await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].draft).toBe(true);
    expect(r.published).toBe(false);
    expect(fr.state.publishCalls).toBe(0);
    const row = circleRow();
    expect(row.framer_error).toBe("Not shown on the website until set: photo");
    expect(row.framer_has.photo).toBe(false);
    expect(row.framer_dirty).toBe(false); // held back, not retried
    expect(settings().framer_publish_pending).toBe(false);
  });

  it("a live circle switched off still gets a hidden item, without publishing", async () => {
    setup({ circles: [readyCircle({ website_visible: false })] });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].draft).toBe(true);
    expect(fr.state.publishCalls).toBe(0);
    expect(circleRow().framer_error).toBeNull();
  });

  it("an item deleted in Framer is recreated", async () => {
    const c = readyCircle({ framer_item_id: "gone", framer_created: true });
    setup({ circles: [c] });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].slug).toBeDefined();
    expect(circleRow().framer_item_id).toBe("new-1");
  });

  it("an item deleted in Framer for a circle that no longer wants one is forgotten", async () => {
    setup({ circles: [readyCircle({ status: "ended", framer_item_id: "gone", framer_created: true })] });
    const r = await fs.syncInner("a");
    expect(r.skipped).toBe(1);
    expect(circleRow().framer_item_id).toBeNull();
  });

  it("a failed create keeps the circle dirty with the error", async () => {
    setup({ circles: [readyCircle()] });
    fr.state.addErrors.push("Framer said no");
    const r = await fs.syncInner("a");
    expect(r.errors[0]).toContain("Framer said no");
    const row = circleRow();
    expect(row.framer_dirty).toBe(true);
    expect(row.framer_error).toContain("Framer said no");
    expect(row.framer_item_id).toBeNull();
    expect(row.framer_synced_at).toBeUndefined();
  });
});

describe("syncInner: updating items", () => {
  it("skips an unchanged item and does not publish", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg" });
    setup({ circles: [c], items: [syncedItem(c)] });
    const r = await fs.syncInner("a");
    expect(r).toMatchObject({ updated: 0, skipped: 1, published: false });
    expect(fr.state.addCalls).toHaveLength(0);
    expect(fr.state.publishCalls).toBe(0);
    expect(circleRow().framer_dirty).toBe(false);
  });

  it("sends only the changed fields", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg" });
    setup({ circles: [{ ...c, start_time: "20:00:00" }], items: [syncedItem(c)] });
    const r = await fs.syncInner("a");
    expect(r.updated).toBe(1);
    const [input] = fr.state.addCalls[0];
    expect(input).toEqual({ id: "item-1", draft: false, fieldData: { [F.time]: { type: "string", value: "8pm UK | Wednesdays" } } });
    expect(Object.keys(input.fieldData)).not.toContain(F.title);
    expect(fr.state.publishCalls).toBe(1);
  });

  it("a change to a hidden item that stays hidden does not publish", async () => {
    const c = readyCircle({ website_visible: false, framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg" });
    setup({ circles: [{ ...c, start_time: "20:00:00" }], items: [syncedItem(c, { draft: true })] });
    const r = await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].draft).toBe(true);
    expect(r.published).toBe(false);
    expect(fr.state.publishCalls).toBe(0);
    expect(settings().framer_publish_pending).toBe(false);
  });

  it("switching on (draft to shown) publishes even with no field changes", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg" });
    setup({ circles: [c], items: [syncedItem(c, { draft: true })] });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0]).toEqual([{ id: "item-1", draft: false }]);
    expect(fr.state.publishCalls).toBe(1);
  });

  it("a circle that no longer wants an item is hidden and published", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true });
    setup({ circles: [{ ...c, status: "ended" }], items: [syncedItem(c)] });
    const r = await fs.syncInner("a");
    expect(r.hidden).toBe(1);
    expect(fr.state.addCalls[0]).toEqual([{ id: "item-1", draft: true }]);
    expect(fr.state.publishCalls).toBe(1);
  });

  it("taken-over items record what they hold in framer_has and keep their hand-made fields", async () => {
    const c = readyCircle({ framer_item_id: "hand-1", framer_created: false, facilitator: null, website_order: null, whatsapp_group_link: null });
    const hand = { id: "hand-1", slug: "isvara-18oct", draft: false, fieldData: {
      [F.author]: { type: "string", value: "Isvara" }, [F.lessonNumber]: { type: "string", value: "3" },
      [F.authorImg]: { type: "image", value: { url: "https://framerusercontent.com/i.png" } },
      [F.link]: { type: "link", value: "https://forms.thinkgita.org/circlesignup?utm_wagrp=https://chat.whatsapp.com/Q" },
    } };
    setup({ circles: [c], items: [hand] });
    await fs.syncInner("a");
    const sent = fr.state.addCalls[0][0];
    expect(sent.draft).toBe(false); // ready thanks to what the item holds
    expect(Object.keys(sent.fieldData).sort()).toEqual([F.time, F.lesson].sort());
    expect(circleRow().framer_has).toEqual({ photo: true, order: true, name: true, whatsapp: true, link: true });
    expect(circleRow().framer_photo_src).toBeNull();
  });

  it("a resent photo is remembered in framer_photo_src", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/old.jpg" });
    setup({ circles: [c], items: [syncedItem(c)] });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].fieldData[F.authorImg].value).toBe("https://img.example.org/asha.jpg");
    expect(circleRow().framer_photo_src).toBe("https://img.example.org/asha.jpg");
  });

  it("clears dirty only when framer_rev did not change during the sync", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg" });
    setup({ circles: [{ ...c, start_time: "20:00:00" }], items: [syncedItem(c)] });
    fr.state.onAdd = () => { circleRow().framer_rev = 2; }; // an admin edits the circle mid-sync
    await fs.syncInner("a");
    const row = circleRow();
    expect(row.framer_dirty).toBe(true);
    expect(row.framer_error).toBeNull();
    const clear = db.writes("circles").find((w) => w.payload.framer_dirty === false);
    expect(clear.filters).toEqual([["eq", "id", "circle-1"], ["eq", "framer_rev", 1]]);
  });

  it("an update failure keeps the circle dirty, records the error and keeps framer_synced_at", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg", framer_synced_at: "2026-10-01T00:00:00.000Z" });
    setup({ circles: [{ ...c, start_time: "20:00:00" }], items: [syncedItem(c)] });
    fr.state.addErrors.push("Rate limited");
    const r = await fs.syncInner("a");
    expect(r.updated).toBe(0);
    expect(r.errors).toHaveLength(1);
    const row = circleRow();
    expect(row.framer_dirty).toBe(true);
    expect(row.framer_error).toContain("Rate limited");
    expect(row.framer_synced_at).toBe("2026-10-01T00:00:00.000Z");
    expect(db.writes("circles").some((w) => w.payload.framer_dirty === false)).toBe(false);
  });

  it("test circles are skipped", async () => {
    setup({ circles: [readyCircle({ is_demo: true })] });
    const r = await fs.syncInner("a");
    expect(r.skipped).toBe(1);
    expect(fr.state.addCalls).toHaveLength(0);
  });
});

describe("syncInner: settings and publishing", () => {
  it("nothing dirty and nothing pending: does not connect", async () => {
    setup();
    const r = await fs.syncInner("a");
    expect(r).toEqual({ changed: 0, published: false, note: "nothing to sync" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("a pending publish with no dirty circles still publishes", async () => {
    setup({ settings: { framer_publish_pending: true, framer_publish_attempts: 2 } });
    const r = await fs.syncInner("a");
    expect(r.published).toBe(true);
    expect(settings()).toMatchObject({ framer_publish_pending: false, framer_publish_attempts: 0, framer_publish_error: null });
  });

  it("auto publish off: marks pending but does not publish", async () => {
    setup({ circles: [readyCircle()], settings: { framer_auto_publish: false } });
    const r = await fs.syncInner("a");
    expect(r.published).toBe(false);
    expect(fr.state.publishCalls).toBe(0);
    expect(settings().framer_publish_pending).toBe(true);
  });

  it("publish failure retries once after 20 seconds, then records pending with attempts plus one", async () => {
    setup({ circles: [readyCircle()], settings: { framer_publish_attempts: 3 } });
    fr.state.publishErrors.push("Publishing is currently unavailable", "Publishing is currently unavailable");
    const p = fs.syncInner("a");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fr.state.publishCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const r = await p;
    expect(fr.state.publishCalls).toBe(2);
    expect(r.published).toBe("not published yet (Publishing is currently unavailable); it will retry automatically");
    expect(settings()).toMatchObject({ framer_publish_pending: true, framer_publish_attempts: 4, framer_publish_error: "Publishing is currently unavailable" });
    expect(settings().framer_publish_tried_at).toBeDefined();
  });

  it("publish that succeeds on the retry clears pending", async () => {
    setup({ circles: [readyCircle()], settings: { framer_publish_attempts: 1 } });
    fr.state.publishErrors.push("Busy");
    const p = fs.syncInner("a");
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(r.published).toBe(true);
    expect(settings()).toMatchObject({ framer_publish_pending: false, framer_publish_attempts: 0 });
  });

  it("missing collection throws and still disconnects", async () => {
    setup({ circles: [readyCircle()] });
    fr.framer.getCollections = async () => [];
    await expect(fs.syncInner("a")).rejects.toThrow("Course collection not found in Framer");
    expect(fr.state.disconnected).toBe(1);
  });
});

describe("sync: whole-sync failure", () => {
  it("records the error in settings and the audit log, then rethrows", async () => {
    setup({ circles: [readyCircle()], settings: { framer_fail_count: 2 } });
    connect.mockRejectedValue(new Error("Invalid API key"));
    await expect(fs.sync("cron")).rejects.toThrow("Invalid API key");
    expect(settings()).toMatchObject({ framer_last_error: "Invalid API key", framer_fail_count: 3 });
    expect(settings().framer_failed_at).toBe(new Date(NOW).toISOString());
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "cron", action: "framer_sync", detail: { failed: "Invalid API key" } });
  });

  it("a successful sync resets the failure count", async () => {
    setup({ circles: [readyCircle()], settings: { framer_fail_count: 2, framer_last_error: "old" } });
    await fs.sync("cron");
    expect(settings()).toMatchObject({ framer_last_error: null, framer_fail_count: 0 });
  });

  it("preview is read-only and lists circles that could be shown", async () => {
    setup({ circles: [readyCircle(), readyCircle({ id: "c2", status: "ended" }), readyCircle({ id: "c3", is_demo: true }), readyCircle({ id: "c4", status: "pending", starts_on: null })] });
    const r = await fs.sync("a", { all: true, preview: true });
    expect(r.map((x) => x.id)).toEqual(["circle-1", "c4"]);
    expect(r[0]).toMatchObject({ draft: false, missing: [], title: "Gita Circles (English)", time: "7:30pm UK | Wednesdays", lesson: "Join anytime" });
    expect(r[1]).toMatchObject({ draft: true, missing: ["start date"], lesson: null });
    expect(connect).not.toHaveBeenCalled();
    expect(db.calls.every((c) => c.op === "select")).toBe(true);
  });
});

describe("setItem", () => {
  const hand = (over = {}) => ({ id: "hand-1", slug: "isvara-18oct", draft: true, fieldData: {}, ...over });

  it("refuses items linked to a circle", async () => {
    setup({ circles: [readyCircle({ framer_item_id: "hand-1" })], items: [hand()] });
    await expect(fs.setItem("a", { id: "hand-1", draft: false })).rejects.toThrow(/belongs to/);
  });
  it("needs an id and a valid order", async () => {
    setup({ items: [hand()] });
    await expect(fs.setItem("a", {})).rejects.toThrow("Which website item?");
    await expect(fs.setItem("a", { id: "hand-1", order: "0" })).rejects.toThrow("Order must be a whole number from 1");
    await expect(fs.setItem("a", { id: "hand-1", order: -2 })).rejects.toThrow("Order must be a whole number from 1");
  });
  it("an item that is gone from Framer", async () => {
    setup({ items: [] });
    await expect(fs.setItem("a", { id: "hand-1", draft: false })).rejects.toThrow("That item is no longer in Framer");
  });
  it("showing a hidden item publishes", async () => {
    setup({ items: [hand()] });
    const r = await fs.setItem("a", { id: "hand-1", draft: false, order: "4.7" });
    expect(fr.state.addCalls[0]).toEqual([{ id: "hand-1", draft: false, fieldData: { [F.lessonNumber]: { type: "string", value: "4" } } }]);
    expect(r).toEqual({ ok: true, published: true });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "framer_item", detail: { id: "hand-1", draft: false, order: "4.7", published: true } });
  });
  it("reordering a hidden item that stays hidden does not publish", async () => {
    setup({ items: [hand()] });
    const r = await fs.setItem("a", { id: "hand-1", order: 2 });
    expect(r.published).toBe(false);
    expect(fr.state.publishCalls).toBe(0);
    expect(settings().framer_publish_pending).toBe(false);
  });
  it("clearing the order sends an empty LessonNumber", async () => {
    setup({ items: [hand({ draft: false })] });
    await fs.setItem("a", { id: "hand-1", order: null });
    expect(fr.state.addCalls[0][0].fieldData[F.lessonNumber].value).toBe("");
    expect(fr.state.publishCalls).toBe(1);
  });
  it("auto publish off: marks pending only", async () => {
    setup({ items: [hand({ draft: false })], settings: { framer_auto_publish: false } });
    const r = await fs.setItem("a", { id: "hand-1", draft: true });
    expect(r.published).toBe(false);
    expect(settings().framer_publish_pending).toBe(true);
  });
});

describe("publishOnly", () => {
  it("publishes, disconnects and audits", async () => {
    setup({ settings: { framer_publish_pending: true } });
    const r = await fs.publishOnly("a");
    expect(r).toEqual({ published: true });
    expect(fr.state.disconnected).toBe(1);
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "framer_publish" });
  });
});

describe("order field type (LessonNumber as Text or Number in Framer)", () => {
  // The type is read from Framer on each run; reset to Text after each test so other tests are unaffected.
  afterEach(() => fs.readOrderType({ getFields: async () => [] }));

  it("a Number field gets the order as a number", async () => {
    const c = readyCircle({ website_order: 3 });
    setup({ circles: [c], orderType: "number" });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].fieldData[F.lessonNumber]).toEqual({ type: "number", value: 3 });
  });

  it("a Text field gets the order as text", async () => {
    const c = readyCircle({ website_order: 3 });
    setup({ circles: [c], orderType: "string" });
    await fs.syncInner("a");
    expect(fr.state.addCalls[0][0].fieldData[F.lessonNumber]).toEqual({ type: "string", value: "3" });
  });

  it("an item already holding the same order is not resent after the field becomes a Number", async () => {
    const c = readyCircle({ framer_item_id: "item-1", framer_created: true, framer_photo_src: "https://img.example.org/asha.jpg", website_order: 3 });
    const item = syncedItem(c);
    item.fieldData[F.lessonNumber] = { type: "number", value: 3 };
    setup({ circles: [c], items: [item], orderType: "number" });
    const r = await fs.syncInner("a");
    expect(r).toMatchObject({ updated: 0, skipped: 1 });
    expect(fr.state.addCalls).toHaveLength(0);
  });

  it("setItem sends a number to a Number field and refuses to clear it", async () => {
    setup({ items: [{ id: "hand-1", slug: "isvara-18oct", draft: false, fieldData: {} }], orderType: "number" });
    await fs.setItem("a", { id: "hand-1", order: "4.7" });
    expect(fr.state.addCalls[0][0].fieldData[F.lessonNumber]).toEqual({ type: "number", value: 4 });
    await expect(fs.setItem("a", { id: "hand-1", order: null })).rejects.toThrow("A listing on the website needs an order number");
  });
});
