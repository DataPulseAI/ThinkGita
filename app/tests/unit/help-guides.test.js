// The Help guides (src/help): every guide is well formed, links resolve, screenshots exist, and each account sees the right ones.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUIDES, SECTIONS, guidesFor, minutesFor, plainText } from "../../src/help/index.js";

const AUDIENCES = ["all", "admin", "super", "facilitator", "assessor"];
const ids = new Set(GUIDES.map((g) => g.id));
const allText = JSON.stringify(GUIDES);

describe("help guides", () => {
  it("have unique ids, valid sections and audiences", () => {
    expect(ids.size).toBe(GUIDES.length);
    for (const g of GUIDES) {
      expect(SECTIONS, g.id).toContain(g.section);
      expect(g.audience.length, g.id).toBeGreaterThan(0);
      for (const a of g.audience) expect(AUDIENCES, g.id).toContain(a);
      expect(g.title && g.summary && g.icon, g.id).toBeTruthy();
      expect(g.steps.length, g.id).toBeGreaterThan(0);
      for (const s of g.steps) expect(s.title && s.body, `${g.id}: ${s.title}`).toBeTruthy();
    }
  });
  it("only relate to guides that exist", () => {
    for (const g of GUIDES) for (const r of g.related ?? []) expect(ids.has(r), `${g.id} -> ${r}`).toBe(true);
  });
  it("only use screenshots that exist, with alt text", () => {
    for (const g of GUIDES) for (const s of g.steps) {
      if (!s.shot) continue;
      expect(fs.existsSync(path.resolve("public/help", `${s.shot}.webp`)), `${g.id}: ${s.shot}`).toBe(true);
      expect(s.alt, `${g.id}: ${s.shot}`).toBeTruthy();
    }
  });
  it("never use dashes as punctuation or double hyphens", () => {
    expect(allText).not.toMatch(/[–—]/);
    expect(allText).not.toMatch(/--/);
  });
  it("search text and reading time work", () => {
    for (const g of GUIDES) {
      expect(plainText(g).length).toBeGreaterThan(20);
      expect(minutesFor(g)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("who sees what", () => {
  const titles = (keys) => guidesFor(keys).map((g) => g.id);
  it("super admins see everything an admin sees, plus the super admin guides", () => {
    const admin = titles(["admin"]), sup = titles(["admin", "super"]);
    for (const id of admin) expect(sup).toContain(id);
    expect(admin).not.toContain("add-admin");
    expect(sup).toContain("add-admin");
  });
  it("facilitators see only their own guides and the shared ones", () => {
    const f = titles(["facilitator"]);
    expect(f).toContain("fac-start-meeting");
    expect(f).not.toContain("new-circle");
    expect(f).not.toContain("add-admin");
  });
  it("assessors see the assessing guides, not admin ones", () => {
    const a = titles(["assessor"]);
    expect(a).toContain("ass-review");
    expect(a).toContain("ass-score");
    expect(a).not.toContain("training-trainees");
  });
});
