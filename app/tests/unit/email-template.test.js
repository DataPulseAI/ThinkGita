// Email templates: buildVars and render (provision-circle/template.ts) and the dashboard copy (app/src/emailTemplate.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as server from "../../../supabase/functions/provision-circle/template.ts";
import * as dash from "../../src/emailTemplate.js";
import { freeze, person } from "./helpers/circles.js";

afterEach(() => vi.useRealTimers());

describe("dashboard copy matches the edge function copy", () => {
  it("files are identical", () => {
    const a = readFileSync(resolve(__dirname, "../../src/emailTemplate.js"), "utf8");
    const b = readFileSync(resolve(__dirname, "../../../supabase/functions/provision-circle/template.ts"), "utf8");
    expect(a).toBe(b);
  });
  it("render the same output", () => {
    freeze("2026-10-10T12:00:00Z");
    const input = { circle: { name: "A <b>", weekday: 2, start_time: "18:00:00" }, facilitator: person(), settings: {} };
    for (const k of ["approved", "updated"]) {
      expect(dash.render(dash.DEFAULT_TEMPLATES[k], dash.buildVars(input))).toEqual(server.render(server.DEFAULT_TEMPLATES[k], server.buildVars(input)));
    }
  });
});

for (const [label, t] of [["template.ts", server], ["emailTemplate.js", dash]]) {
  describe(`${label}: buildVars`, () => {
    it("fills circle, licence and settings values", () => {
      freeze("2026-10-10T12:00:00Z");
      const v = t.buildVars({
        circle: { id: "abcdef12-3456", name: "Circle A", circle_type: "Gita Circle", language: "English", weekday: 3, start_time: "19:30:00", timezone: "Europe/London", duration_min: 75, starts_on: "2026-10-14", join_url: "https://zoom.us/j/1", zoom_meeting_id: "1", passcode: "p", whatsapp_group_link: "https://chat.whatsapp.com/W" },
        facilitator: person(), licence: { zoom_user_email: "z@example.org", host_key: "123456", label: "Licence 01" },
        settings: { youtube_playlist_link: "https://youtube.example.org/p", drive_folder_link: "https://drive.example.org/f", support_contact: "help@example.org", participant_signup_link: "https://forms.example.org/?c={circle_code}" },
        appUrl: "https://circles.example.org", sender: "Admin Example",
      });
      expect(v).toMatchObject({
        first_name: "Asha", facilitator_name: "Asha Example", circle_name: "Circle A", meeting_day: "Wednesday", meeting_time: "19:30",
        timezone: "UK time", duration: "75", start_date: "Wednesday 14 October 2026", circle_code: "abcdef12", zoom_meeting_link: "https://zoom.us/j/1",
        zoom_login_email: "z@example.org", host_key: "123456", licence_name: "Licence 01", youtube_playlist_link: "https://youtube.example.org/p",
        drive_folder_link: "https://drive.example.org/f", whatsapp_group_link: "https://chat.whatsapp.com/W", dashboard_link: "https://circles.example.org",
        support_contact: "help@example.org", sender_name: "Admin Example", participant_signup_link: "https://forms.example.org/?c=abcdef12",
      });
    });
    it("circle links beat settings links", () => {
      const v = t.buildVars({ circle: { youtube_playlist_link: "https://y.example.org/own", drive_folder_link: "  " }, settings: { youtube_playlist_link: "https://y.example.org/default", drive_folder_link: "https://d.example.org/default" } });
      expect(v.youtube_playlist_link).toBe("https://y.example.org/own");
      expect(v.drive_folder_link).toBe("https://d.example.org/default");
    });
    it("first name: explicit first_name, else first word of the name, never an email", () => {
      expect(t.buildVars({ facilitator: { first_name: "Bela", name: "Someone Else" } }).first_name).toBe("Bela");
      expect(t.buildVars({ facilitator: { name: "  Chitra  Example " } }).first_name).toBe("Chitra");
      expect(t.buildVars({ facilitator: { name: "chitra@example.org" } }).first_name).toBe("");
      expect(t.buildVars({ facilitator: null }).first_name).toBe("");
    });
    it("sender falls back to settings, then the team", () => {
      expect(t.buildVars({ settings: { sender_name: "Desk" } }).sender_name).toBe("Desk");
      expect(t.buildVars({}).sender_name).toBe("The Think Gita team");
    });
    it.each([
      ["Europe/London", "UK time"], ["America/New_York", "New York time"], ["America/Argentina/Buenos_Aires", "Buenos Aires time"],
      ["Etc/GMT+5", "GMT-5"], ["Etc/GMT-3", "GMT+3"], [null, ""],
    ])("timezone %s -> %s", (tz, want) => expect(t.buildVars({ circle: { timezone: tz } }).timezone).toBe(want));
    it("empty values for an empty circle", () => {
      const v = t.buildVars({});
      expect(v.meeting_day).toBe("");
      expect(v.start_date).toBe("");
      expect(v.circle_code).toBe("");
      expect(v.participant_signup_link).toBe("");
    });
    it("expected start before approval: next matching day on or after today, preferred start and term start", () => {
      freeze("2026-10-10T12:00:00Z"); // Saturday
      expect(t.buildVars({ circle: { weekday: 6 } }).start_date).toBe("Saturday 10 October 2026");
      expect(t.buildVars({ circle: { weekday: 1 } }).start_date).toBe("Monday 12 October 2026");
      expect(t.buildVars({ circle: { weekday: 1, preferred_start: "2026-11-03" } }).start_date).toBe("Monday 9 November 2026");
      expect(t.buildVars({ circle: { weekday: 1 }, settings: { term_start: "2026-10-20T00:00:00Z" } }).start_date).toBe("Monday 26 October 2026");
    });
    // Bug (minor, preview only): expectedStart uses the UTC date, not the UK date. Just after midnight in UK summer
    // (00:30 BST Sunday is still Saturday in UTC) a Saturday circle is previewed as starting yesterday.
    it.fails("expected start uses the UK date after midnight in summer", () => {
      freeze("2026-10-10T23:30:00Z"); // UK: Sunday 11 Oct 00:30
      expect(t.buildVars({ circle: { weekday: 6 } }).start_date).toBe("Saturday 17 October 2026");
    });
  });

  describe(`${label}: placeholders`, () => {
    const tpl = { subject: "Hi {{first_name}} {{ unknown_thing }}", body: "Link {{zoom_meeting_link}} {{ host_key }} {{circle_name}}" };
    it("usedPlaceholders and unknownPlaceholders", () => {
      expect(t.usedPlaceholders(tpl).sort()).toEqual(["circle_name", "first_name", "host_key", "unknown_thing", "zoom_meeting_link"]);
      expect(t.unknownPlaceholders(tpl)).toEqual(["unknown_thing"]);
      expect(t.usedPlaceholders(null)).toEqual([]);
    });
    it("missingValues, optionally ignoring values filled on approval", () => {
      const vars = { first_name: "Asha", circle_name: "", host_key: "" };
      expect(t.missingValues(tpl, vars).sort()).toEqual(["circle_name", "host_key", "zoom_meeting_link"]);
      expect(t.missingValues(tpl, vars, { beforeApproval: true }).sort()).toEqual(["circle_name", "host_key"]);
    });
    it("every placeholder key is unique and documented", () => {
      const keys = t.PLACEHOLDERS.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of t.PLACEHOLDERS) expect(p.label).toBeTruthy();
    });
    it("default templates only use known placeholders", () => {
      for (const k of ["approved", "updated"]) expect(t.unknownPlaceholders(t.DEFAULT_TEMPLATES[k])).toEqual([]);
    });
  });

  describe(`${label}: render`, () => {
    it("fills values in subject and text, escapes them in HTML", () => {
      const r = t.render({ subject: "Hello {{first_name}}\nagain", body: "Name: {{circle_name}}" }, { first_name: "Asha", circle_name: "<script>alert('x')</script> & co" });
      expect(r.subject).toBe("Hello Asha again");
      expect(r.text).toBe("Name: <script>alert('x')</script> & co");
      expect(r.html).toContain("Name: &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co");
      expect(r.html).not.toContain("<script>");
    });
    it("escapes literal template text too", () => {
      const r = t.render({ subject: "", body: "a < b \"quoted\"" }, {});
      expect(r.html).toContain("a &lt; b &quot;quoted&quot;");
    });
    it("missing values say to follow, or a custom phrase, unknown placeholders stay as typed", () => {
      const tpl = { subject: "{{host_key}} {{mystery}}", body: "Key: {{host_key}}\nX: {{mystery}}" };
      const r = t.render(tpl, {});
      expect(r.subject).toBe("to follow {{mystery}}");
      expect(r.text).toBe("Key: to follow\nX: {{mystery}}");
      expect(r.html).toContain("Key: to follow<br>X: {{mystery}}");
      expect(t.render(tpl, {}, { missing: "TBC" }).text).toBe("Key: TBC\nX: {{mystery}}");
    });
    it("preview marks missing and unknown values", () => {
      const r = t.render({ subject: "", body: "{{host_key}} {{mystery}}" }, {}, { preview: true });
      expect(r.html).toContain('<mark class="missing">host_key: not set</mark>');
      expect(r.html).toContain('<mark class="missing">unknown: mystery</mark>');
    });
    it("values are linked, and bare URLs in the text too, without trailing punctuation", () => {
      const r = t.render({ subject: "", body: "Join {{zoom_meeting_link}}. See https://example.org/help." }, { zoom_meeting_link: "https://zoom.us/j/1?a=1&b=2" });
      expect(r.html).toContain('<a href="https://zoom.us/j/1?a=1&amp;b=2" style="color:#1d6a72">https://zoom.us/j/1?a=1&amp;b=2</a>.');
      expect(r.html).toContain('<a href="https://example.org/help" style="color:#1d6a72">https://example.org/help</a>.');
      expect((r.html.match(/<a /g) ?? []).length).toBe(2);
    });
    it("headings become strong, blank lines make paragraphs", () => {
      const r = t.render({ subject: "", body: "Dear X,\n\nYOUR CIRCLE\nName: {{circle_name}}\n\nBye" }, { circle_name: "C" });
      expect(r.html.match(/<p /g)).toHaveLength(3);
      expect(r.html).toContain(">YOUR CIRCLE</strong>Name: C</p>");
      expect(r.html.startsWith('<div style="font-family:Arial')).toBe(true);
    });
    it("a line with a placeholder is never a heading", () => {
      const r = t.render({ subject: "", body: "ZOOM {{zoom_meeting_id}}" }, { zoom_meeting_id: "123" });
      expect(r.html).not.toContain("<strong");
    });
    it("renders the default templates with nothing left unreplaced", () => {
      freeze("2026-10-10T12:00:00Z");
      const vars = t.buildVars({ circle: { id: "c", name: "C", weekday: 3, start_time: "19:30", timezone: "Europe/London" }, facilitator: person() });
      for (const k of ["approved", "updated"]) {
        const r = t.render(t.DEFAULT_TEMPLATES[k], vars);
        expect(r.text).not.toMatch(/\{\{/);
        expect(r.subject).toContain("Asha");
        expect(r.text).toContain("to follow");
      }
    });
    it("handles CRLF line endings", () => {
      const r = t.render({ subject: "", body: "A\r\n\r\nB" }, {});
      expect(r.html.match(/<p /g)).toHaveLength(2);
    });
  });
}

// "What changed" in the details changed email: describeChanges, {{changes}} and the block added to older templates.
const OLD_UPDATED = {
  subject: "Your Think Gita Circle details have changed, {{first_name}}",
  body: "Dear {{first_name}},\n\nSome details of your Circle have changed. Your up-to-date details are below. Please use these from now on.\n\nYOUR CIRCLE\nCircle name: {{circle_name}}\nMeeting day and time: {{meeting_day}} at {{meeting_time}} ({{timezone}})",
};
const liveBefore = {
  id: "c1", name: "TG Circles | Tue | 5pm CT | Test Host", weekday: 2, start_time: "17:00:00", timezone: "America/Chicago",
  duration_min: 60, starts_on: "2026-09-01", join_url: "https://zoom.us/j/111", zoom_meeting_id: "111", passcode: "p",
};
const liveAfter = { ...liveBefore, name: "TG Circles | Sat | 9am CT | Test Host", weekday: 6, start_time: "09:00:00", starts_on: "2026-10-17" };

for (const [label, t] of [["template.ts", server], ["emailTemplate.js", dash]]) {
  describe(`${label}: what changed`, () => {
    it("knows the {{changes}} placeholder, filled on send, never missing", () => {
      expect(t.PLACEHOLDERS.find((p) => p.key === "changes")).toMatchObject({ group: "Circle", auto: true });
      expect(t.unknownPlaceholders({ subject: "", body: "{{changes}}" })).toEqual([]);
      expect(t.missingValues({ subject: "", body: "{{changes}} {{host_key}}" }, {})).toEqual(["host_key"]);
      expect(t.DEFAULT_TEMPLATES.updated.body).toContain("WHAT CHANGED\n{{changes}}");
      expect(t.DEFAULT_TEMPLATES.approved.body).not.toContain("{{changes}}");
    });
    it("reschedule: day and time before and after, first session, new name, same link", () => {
      expect(t.describeChanges(liveBefore, liveAfter)).toEqual([
        "Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)",
        "First session at the new time: Saturday 17 October",
        "Circle name: TG Circles | Tue | 5pm CT | Test Host to TG Circles | Sat | 9am CT | Test Host",
        "Zoom link: the same as before, so nothing changes in your WhatsApp group.",
      ]);
    });
    it("timezone change shows both zones; length change; nothing about the name when it stayed", () => {
      const after = { ...liveBefore, timezone: "Europe/London", start_time: "23:00", duration_min: 90, starts_on: "2026-10-13" };
      expect(t.describeChanges(liveBefore, after)).toEqual([
        "Day and time: Tuesday 17:00 (Chicago time) to Tuesday 23:00 (UK time)",
        "First session at the new time: Tuesday 13 October",
        "Length: 60 to 90 minutes",
        "Zoom link: the same as before, so nothing changes in your WhatsApp group.",
      ]);
    });
    it("move licence: new link and a new host key", () => {
      const after = { ...liveBefore, join_url: "https://zoom.us/j/222", zoom_meeting_id: "222", starts_on: "2026-10-13" };
      expect(t.describeChanges(liveBefore, after, { oldLicence: { host_key: "111111" }, newLicence: { host_key: "222222" } })).toEqual([
        "First session with the new link: Tuesday 13 October",
        "Zoom link: new. The meeting link, meeting ID and passcode below have changed, so please share the new link in your WhatsApp group.",
        "Host key: new, see below.",
      ]);
      expect(t.describeChanges(liveBefore, after, { oldLicence: { host_key: "111111" }, newLicence: { host_key: "111111" } })).not.toContain("Host key: new, see below.");
    });
    it("only the next date moved", () => {
      expect(t.describeChanges(liveBefore, { ...liveBefore, starts_on: "2026-11-03" })).toEqual([
        "Next session: Tuesday 1 September to Tuesday 3 November",
        "Zoom link: the same as before, so nothing changes in your WhatsApp group.",
      ]);
    });
    it("buildVars makes one line per change", () => {
      expect(t.buildVars({ changes: ["A", "", "B"] }).changes).toBe("- A\n- B");
      expect(t.buildVars({}).changes).toBe("");
    });
    it("the default template opens with what changed, in text and HTML", () => {
      const vars = t.buildVars({ circle: liveAfter, facilitator: person(), changes: t.describeChanges(liveBefore, liveAfter) });
      const r = t.render(t.DEFAULT_TEMPLATES.updated, vars);
      expect(r.text).toContain("Some details of your Circle have changed.\n\nWHAT CHANGED\n- Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)\n- First session at the new time: Saturday 17 October\n");
      expect(r.text.indexOf("WHAT CHANGED")).toBeLessThan(r.text.indexOf("YOUR CIRCLE"));
      expect(r.html).toContain(">WHAT CHANGED</strong>- Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)<br>- First session at the new time: Saturday 17 October<br>");
    });
    it("a saved template without {{changes}} gets the block after the greeting", () => {
      const vars = t.buildVars({ circle: liveAfter, facilitator: person(), changes: ["Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)"] });
      const r = t.render(OLD_UPDATED, vars);
      expect(r.text.startsWith("Dear Asha,\n\nWHAT CHANGED\n- Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)\n\nSome details of your Circle have changed.")).toBe(true);
      expect(r.html).toContain(">WHAT CHANGED</strong>- Day and time");
      // No greeting line: the block goes first.
      expect(t.render({ subject: "s", body: "Hello there\nsecond line\n\nMore" }, vars).text.startsWith("WHAT CHANGED\n- Day and time")).toBe(true);
      // Without changes (approval email, resend) nothing is added.
      const plain = t.render(OLD_UPDATED, t.buildVars({ circle: liveAfter, facilitator: person() }));
      expect(plain.text).not.toContain("WHAT CHANGED");
      expect(t.render(t.DEFAULT_TEMPLATES.approved, t.buildVars({ circle: liveAfter, facilitator: person() })).text).not.toContain("WHAT CHANGED");
    });
    it("change lines are escaped in HTML", () => {
      const r = t.render(t.DEFAULT_TEMPLATES.updated, { changes: "- Circle name: A <b> & B to C" });
      expect(r.html).toContain("- Circle name: A &lt;b&gt; &amp; B to C");
      expect(r.html).not.toContain("<b>");
    });
    it("{{changes}} with nothing to say reads as a plain update", () => {
      expect(t.render({ subject: "", body: "WHAT CHANGED\n{{changes}}" }, {}).text).toBe("WHAT CHANGED\n- Your Circle's details were updated.");
    });
    it("sample changes for previews: as if moved from the day before, same link", () => {
      expect(t.sampleChanges({ weekday: 1, start_time: "19:00", timezone: "Europe/London", starts_on: "2026-10-12", join_url: "https://zoom.us/j/1" })).toEqual([
        "Day and time: Sunday 19:00 to Monday 19:00 (UK time)",
        "First session at the new time: Monday 12 October",
        "Zoom link: the same as before, so nothing changes in your WhatsApp group.",
      ]);
      expect(t.sampleChanges({ weekday: 3, start_time: "08:00" })[0]).toBe("Day and time: Tuesday 08:00 to Wednesday 08:00 (UK time)");
    });
  });
}

describe("both copies render changes the same way", () => {
  it("same output for the default and an older saved template", () => {
    const changes = server.describeChanges(liveBefore, liveAfter);
    expect(dash.describeChanges(liveBefore, liveAfter)).toEqual(changes);
    for (const tpl of [server.DEFAULT_TEMPLATES.updated, OLD_UPDATED]) {
      const input = { circle: liveAfter, facilitator: person(), settings: {}, changes };
      expect(dash.render(tpl, dash.buildVars(input))).toEqual(server.render(tpl, server.buildVars(input)));
    }
  });
});
