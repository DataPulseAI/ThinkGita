// Needs matching groups: sign-ups from the same WhatsApp group (or the same link details) are decided together.
import { describe, it, expect } from "vitest";
import { matchGroups, waCode, filterSignups, toCsv } from "../../src/AttendeesPage.jsx";

const s = (id, utm, extra = {}) => ({ id, utm, match_candidates: [], submitted_at: "2026-10-01T10:00:00Z", ...extra });

describe("matchGroups", () => {
  it("groups by WhatsApp invite code, then by facilitator, language, course and date", () => {
    const groups = matchGroups([
      s("a", { utm_facilitator: "Niscinta", utm_wagrp: "https://chat.whatsapp.com/GIc" }, { match_candidates: ["c1", "c2"] }),
      s("b", { utm_facilitator: "Niscinta", utm_wagrp: "https://chat.whatsapp.com/gic?mc_cid=9" }, { match_candidates: ["c2", "c3"] }),
      s("c", { utm_facilitator: "Gopali", utm_lang: "Eng", utm_course: "BGB" }),
      s("d", { utm_facilitator: "gopali", utm_lang: "eng", utm_course: "bgb" }),
      s("e", {}),
    ]);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["wa:gic", ["a", "b"]], ["link:gopali|eng|bgb", ["c", "d"]], ["one:e", ["e"]],
    ]);
    expect(groups[0].candidates).toEqual(["c1", "c2", "c3"]);
  });
  it("reads WhatsApp invite codes", () => {
    expect(waCode("https://chat.whatsapp.com/invite/AbC?x=1")).toBe("abc");
    expect(waCode("not a link")).toBeNull();
  });
  it("filters and exports", () => {
    const rows = [{ id: "1", first_name: "Mira", city: "Leeds", circle_id: "c1" }, { id: "2", first_name: "Noah", city: "Bristol", circle_id: null }];
    expect(filterSignups(rows, { q: "bris" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterSignups(rows, { circle: "none" }).map((r) => r.id)).toEqual(["2"]);
    expect(toCsv([{ first_name: 'Say "hi", ok' }]).split("\r\n")[1]).toMatch(/^"Say ""hi"", ok"/);
  });
});
