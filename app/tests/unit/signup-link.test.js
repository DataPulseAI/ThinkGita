// The dashboard's sign-up link (app/src/signupLink.js) must match the website sync's link() in framer-sync.
import { describe, it, expect } from "vitest";
import * as fs from "../../../supabase/functions/framer-sync/index.ts";
import { signupLink, hostNames } from "../../src/signupLink.js";
import { readyCircle, person } from "./helpers/circles.js";

const cases = [
  readyCircle(),
  readyCircle({ facilitator: person({ initiated_name: "Ananda-rupa Krsna das" }), whatsapp_group_link: " https://chat.whatsapp.com/ABC?x=1 " }),
  readyCircle({ cofacilitators: [{ facilitator: person({ name: "Bela Example" }) }] }),
  readyCircle({ circle_type: "Beginners", language: "Spanish", starts_on: null, whatsapp_group_link: null }),
  readyCircle({ status: "pending", starts_on: null, preferred_start: "2026-11-04", language: "Tamil" }),
  readyCircle({ name: "TG Circles | Mon | 7.30pm UK | Anjali", name_auto: false }),
  readyCircle({ facilitator: person({ name: "someone@example.org" }) }),
];

describe("signupLink", () => {
  it.each(cases.map((c, i) => [i, c]))("matches the website link (case %i)", (_i, c) => {
    expect(signupLink(c)).toBe(fs.link(c));
  });
  it("carries the circle id and name, with the WhatsApp link last", () => {
    const url = signupLink(readyCircle());
    const q = new URL(url).searchParams;
    expect(q.get("circle_id")).toBe("circle-1");
    expect(q.get("circle_name")).toBe("Gita Circles | Asha Example | Wednesday 19:30 (UK)");
    expect(url.split("&").pop()).toBe("utm_wagrp=https://chat.whatsapp.com/ABC123");
  });
  it("takes host names from my_circle_link_parts", () => {
    const c = { ...readyCircle(), facilitator: undefined, hosts: ["Asha Example", "Bela Example", "x@example.org", null] };
    expect(hostNames(c)).toEqual(["Asha Example", "Bela Example"]);
    expect(signupLink(c)).toContain("utm_facilitator=Asha%20Example%20%26%20Bela%20Example&");
  });
});
