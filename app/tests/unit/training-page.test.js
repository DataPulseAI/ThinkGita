// Training page helpers: personal form links, step progress, list status, links text and filtering.
import { describe, it, expect } from "vitest";
import { formLink, progress, traineeStatus, linksText, filterTrainees, traineeNames, STEPS } from "../../src/TrainingPage.jsx";
import { buildTrainingVars, render, DEFAULT_TEMPLATES } from "../../src/emailTemplate.js";

const forms = [
  { key: "agreement", label: "Agreement form", url: "https://tally.example.org/r/agree" },
  { key: "scene", label: "Setting the Scene reflections", url: "https://forms.example.org/scene?lang=en" },
  { key: "empowerment", label: "Empowerment reflections", url: "https://tally.example.org/r/emp" },
  { key: "wisdom", label: "Wisdom reflections", url: null },
  { key: "video", label: "Video assessment", url: "https://tally.example.org/r/video" },
];
const t = (o = {}) => ({ id: "t1", status: "applied", email: "a@example.org", ...o });
const sub = (form_key, submitted_at = "2026-10-01T10:00:00Z", trainee_id = "t1") => ({ trainee_id, form_key, submitted_at });

describe("formLink", () => {
  it("adds the trainee id, with & when the link already has a query, keeping any #part", () => {
    expect(formLink("https://tally.so/r/abc", "t-1")).toBe("https://tally.so/r/abc?tid=t-1");
    expect(formLink("https://x.org/f?lang=en", "t-1")).toBe("https://x.org/f?lang=en&tid=t-1");
    expect(formLink("https://x.org/f#top", "t-1")).toBe("https://x.org/f?tid=t-1#top");
    expect(formLink("", "t-1")).toBe("");
  });
});

describe("progress and status", () => {
  it("seven steps in order; sessions from the trainee, forms from their submissions (latest wins)", () => {
    const p = progress(t({ intro_attended_at: "2026-09-01T10:00:00Z" }), [sub("agreement", "2026-09-02"), sub("agreement", "2026-09-05"), sub("scene", "2026-09-03", "other")], forms);
    expect(p.map((x) => x.key)).toEqual(STEPS.map((s) => s.key));
    expect(p.map((x) => x.done)).toEqual([true, true, false, false, false, false, false]);
    expect(p[1]).toMatchObject({ at: "2026-09-05", count: 2, label: "Agreement form" });
  });
  it("status: applied, in training, ready when all seven are done, decided ones keep theirs", () => {
    const all = ["agreement", "scene", "empowerment", "wisdom", "video"].map((k) => sub(k));
    const done = t({ intro_attended_at: "x", closing_attended_at: "y" });
    expect(traineeStatus(t(), progress(t(), [], forms))).toBe("applied");
    expect(traineeStatus(t(), progress(t(), [sub("agreement")], forms))).toBe("in_training");
    expect(traineeStatus(t({ status: "in_training" }), progress(t(), [], forms))).toBe("in_training");
    expect(traineeStatus(done, progress(done, all, forms))).toBe("ready");
    expect(traineeStatus({ ...done, status: "certified" }, progress(done, all, forms))).toBe("certified");
    expect(traineeStatus(t({ status: "rejected" }), progress(t(), [], forms))).toBe("rejected");
  });
});

describe("links and names", () => {
  it("one line per form that has a link", () => {
    expect(linksText(t(), forms)).toBe([
      "Agreement form: https://tally.example.org/r/agree?tid=t1",
      "Setting the Scene reflections: https://forms.example.org/scene?lang=en&tid=t1",
      "Empowerment reflections: https://tally.example.org/r/emp?tid=t1",
      "Video assessment: https://tally.example.org/r/video?tid=t1",
    ].join("\n"));
  });
  it("names: initiated name first, else full name, else email", () => {
    expect(traineeNames({ initiated_name: "Haridas", first_name: "Hari", last_name: "Sample" })).toEqual({ title: "Haridas", sub: "Hari Sample" });
    expect(traineeNames({ first_name: "Hari" })).toEqual({ title: "Hari", sub: "" });
    expect(traineeNames({ email: "x@example.org" }).title).toBe("x@example.org");
  });
  it("filter by status and search words", () => {
    const rows = [{ status: "ready", t: { first_name: "Hari", email: "h@example.org" } }, { status: "applied", t: { first_name: "Isha", email: "i@example.org" } }];
    expect(filterTrainees(rows, { status: "ready" })).toHaveLength(1);
    expect(filterTrainees(rows, { q: "isha" })[0].t.first_name).toBe("Isha");
    expect(filterTrainees(rows, { q: "nobody" })).toHaveLength(0);
  });
});

describe("training emails", () => {
  it("certified email fills name, feedback and the request link", () => {
    const vars = buildTrainingVars({ trainee: { first_name: "Hari", last_name: "Sample" }, settings: { circle_request_link: "https://tally.so/r/req", support_contact: "c@example.org" }, sender: "Alex", feedback: "Lovely pacing." });
    const r = render(DEFAULT_TEMPLATES.training_certified, vars, { missing: "" });
    expect(r.subject).toBe("You're a certified Think Gita facilitator, Hari");
    expect(r.text).toContain("Lovely pacing.");
    expect(r.text).toContain("https://tally.so/r/req");
    expect(r.text).not.toMatch(/\{\{/);
    expect(r.text + DEFAULT_TEMPLATES.training_not_certified.body).not.toMatch(/—|--/);
  });
});

describe("needsMatching", () => {
  it("shows unmatched forms from this round, keeps earlier rounds aside, never lists applications", async () => {
    const { needsMatching } = await import("../../src/TrainingPage.jsx");
    const trainees = [{ application_submitted_at: "2026-09-26T06:00:00Z" }, { application_submitted_at: "2026-10-01T00:00:00Z" }, {}];
    const subs = [
      { id: "a", trainee_id: null, form_key: "agreement", submitted_at: "2026-10-02T00:00:00Z" },
      { id: "b", trainee_id: null, form_key: "agreement", submitted_at: "2025-11-02T00:00:00Z" },
      { id: "c", trainee_id: "t1", form_key: "wisdom", submitted_at: "2026-10-02T00:00:00Z" },
      { id: "d", trainee_id: null, form_key: "application", submitted_at: "2026-10-02T00:00:00Z" },
    ];
    const r = needsMatching(subs, trainees);
    expect(r.since).toBe("2026-09-26T06:00:00Z");
    expect(r.recent.map((s) => s.id)).toEqual(["a"]);
    expect(r.older.map((s) => s.id)).toEqual(["b"]);
    expect(needsMatching(subs, []).recent.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("next form and next steps", () => {
  const forms = [
    { key: "application", label: "Application", url: "https://x/app", required: false },
    { key: "agreement", label: "Agreement form", url: "https://x/agree", required: true },
    { key: "scene", label: "Setting the Scene reflections", url: "https://x/scene?lang=en", required: true },
    { key: "empowerment", label: "Empowerment reflections", url: "https://x/emp", required: true },
    { key: "wisdom", label: "Wisdom reflections", url: "https://x/wis", required: false },
    { key: "video", label: "Video assessment", url: "https://x/vid", required: true },
  ];
  const NOW = Date.parse("2026-10-21T12:00:00Z");
  const t = (id, status = "in_training") => ({ id, status, first_name: id, email: `${id}@example.org` });
  const sub = (trainee_id, form_key) => ({ trainee_id, form_key, submitted_at: "2026-10-01" });
  const send = (trainee_id, form_key, daysBack, status = "sent") => ({ trainee_id, form_key, status, created_at: new Date(NOW - daysBack * 86400e3).toISOString() });

  it("nextForm: the first required form in step order not submitted yet", async () => {
    const { nextForm } = await import("../../src/TrainingPage.jsx");
    expect(nextForm(t("a"), [], forms).key).toBe("agreement");
    expect(nextForm(t("a"), [sub("a", "agreement"), sub("b", "scene")], forms).key).toBe("scene");
    // Out of order submissions still leave the earliest gap first; optional forms are skipped.
    expect(nextForm(t("a"), [sub("a", "agreement"), sub("a", "scene"), sub("a", "empowerment")], forms).key).toBe("video");
    expect(nextForm(t("a"), ["agreement", "scene", "empowerment", "video"].map((k) => sub("a", k)), forms)).toBeNull();
  });

  it("nextSteps: to send, to chase, and only people still in training", async () => {
    const { nextSteps } = await import("../../src/TrainingPage.jsx");
    const trainees = [t("a"), t("b", "applied"), t("c"), t("d", "certified"), t("e", "rejected"), t("f")];
    const subs = [sub("c", "agreement"), sub("f", "agreement")];
    const sends = [send("a", "agreement", 2, "failed"), send("c", "scene", 6), send("f", "scene", 2), send("c", "agreement", 30)];
    const r = nextSteps(trainees, subs, forms, sends, NOW, 5);
    expect(r.toSend.map((x) => [x.trainee.id, x.form.key])).toEqual([["a", "agreement"], ["b", "agreement"]]);
    expect(r.chase.map((x) => [x.trainee.id, x.form.key])).toEqual([["c", "scene"]]);
    expect(r.chase[0].sentAt).toBe(sends[1].created_at);
  });

  it("formEmail: personalised subject, text and html with the trainee's own link", async () => {
    const { formEmail } = await import("../../src/TrainingPage.jsx");
    const e = formEmail({ trainee: { id: "t-1", first_name: "Hari" }, form: forms[2], settings: { support_contact: "help@example.org" }, sender: "Alex" });
    expect(e).toMatchObject({ trainee_id: "t-1", form_key: "scene", subject: "Your next Think Gita training form: Setting the Scene reflections" });
    expect(e.text).toContain("Dear Hari,");
    expect(e.text).toContain("https://x/scene?lang=en&tid=t-1");
    expect(e.text).toContain("help@example.org");
    expect(e.text).toMatch(/Warm regards,\nAlex/);
    expect(e.html).toContain('<a href="https://x/scene?lang=en&amp;tid=t-1"');
    expect(e.text).not.toMatch(/\{\{/);
  });

  it("sendFormEmails: batches of 20, and stops when the server says stop", async () => {
    const { sendFormEmails, sentSummary } = await import("../../src/TrainingPage.jsx");
    const calls = [];
    const fake = async (action, { emails }) => { calls.push([action, emails.length]); return { results: emails.map((x) => ({ trainee_id: x.trainee_id, status: "sent" })) }; };
    const out = await sendFormEmails(Array.from({ length: 45 }, (_, i) => ({ trainee_id: `t${i}` })), fake);
    expect(calls).toEqual([["send_form", 20], ["send_form", 20], ["send_form", 5]]);
    expect(out).toHaveLength(45);

    let n = 0;
    const stopping = async (action, { emails }) => (++n === 1
      ? { results: emails.map((x, i) => ({ trainee_id: x.trainee_id, status: i < 15 ? "sent" : "not_sent" })), stopped: "Gmail asked us to stop for now (421)" }
      : { results: [] });
    const held = await sendFormEmails(Array.from({ length: 45 }, (_, i) => ({ trainee_id: `t${i}` })), stopping);
    expect(n).toBe(1);
    expect(held.filter((r) => r.status === "not_sent")).toHaveLength(30);
    expect(sentSummary(held)).toEqual({ text: "Sent 15. Gmail asked us to slow down, so 30 weren't sent. They're still in Next steps: try again later.", warn: true });
  });
});

describe("suggestMatch and groupByEmail", () => {
  const trainees = [
    { id: "k", first_name: "Kamala", last_name: "Kisori", email: "kokila.s@gmail.com", other_emails: [] },
    { id: "r", first_name: "Radha", last_name: "Dasi", initiated_name: "Rādhikā Devī Dāsī", email: "radha@example.org" },
    { id: "s", first_name: "Sam", last_name: "Lee", email: "sam@example.org", other_emails: ["sam.lee@work.example"] },
  ];
  it("same name, either order, ignoring case and accents", async () => {
    const { suggestMatch } = await import("../../src/TrainingPage.jsx");
    expect(suggestMatch({ name: "Kamala Kisori", email: "kamalakisori108@gmail.com" }, trainees)).toMatchObject({ trainee: { id: "k" }, reason: "same name" });
    expect(suggestMatch({ name: "KISORI kamala", email: "x@example.org" }, trainees)?.trainee.id).toBe("k");
    expect(suggestMatch({ name: "Radhika Devi Dasi / Radha D", email: "rdd@example.org" }, trainees)).toMatchObject({ trainee: { id: "r" }, reason: "same name" });
  });
  it("similar names and emails that look like their name", async () => {
    const { suggestMatch } = await import("../../src/TrainingPage.jsx");
    expect(suggestMatch({ name: "Rādhikā Devī", email: "q@example.org" }, trainees)).toMatchObject({ trainee: { id: "r" }, reason: "similar name" });
    expect(suggestMatch({ name: "", email: "kamalakisori108@gmail.com" }, trainees)).toMatchObject({ trainee: { id: "k" }, reason: "email looks like their name" });
  });
  it("nobody, ties, and emails already theirs are not suggested", async () => {
    const { suggestMatch } = await import("../../src/TrainingPage.jsx");
    expect(suggestMatch({ name: "Kiran Unknown", email: "kiran@example.org" }, trainees)).toBeNull();
    expect(suggestMatch({ name: "Sam Lee", email: "sam.lee@work.example" }, trainees)).toBeNull();
    const twins = [...trainees, { id: "k2", first_name: "Kamala", last_name: "Kisori", email: "other@example.org" }];
    expect(suggestMatch({ name: "Kamala Kisori", email: "z@example.org" }, twins)).toBeNull();
  });
  it("groups unmatched forms by email, newest first", async () => {
    const { groupByEmail } = await import("../../src/TrainingPage.jsx");
    const g = groupByEmail([
      { id: "1", email: "A@x.org", name: "", submitted_at: "2026-10-01" },
      { id: "2", email: "a@x.org", name: "Ana", submitted_at: "2026-10-03" },
      { id: "3", email: null, name: "Bo", submitted_at: "2026-10-02" },
    ]);
    expect(g.map((x) => [x.key, x.name, x.subs.map((s) => s.id)])).toEqual([["a@x.org", "Ana", ["2", "1"]], ["id:3", "Bo", ["3"]]]);
  });
});
