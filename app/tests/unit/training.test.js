// training edge function: answers, matching training forms to trainees (id in the link, then email), applications,
// the Tally API backfill shape and the final Certified / Not certified email.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { attachFake } from "./helpers/fakeSupabase.js";
import { withDenoEnv } from "./helpers/env.js";
import { sent } from "../stubs/nodemailer.js";

const SECRET = "test-signing-secret";
let t, handler, restoreEnv, origServe;
beforeAll(async () => {
  restoreEnv = withDenoEnv({ TALLY_SIGNING_SECRET: SECRET, GMAIL_USER: "team@example.org", GMAIL_APP_PASSWORD: "x", TALLY_API_KEY: "test-key" });
  origServe = globalThis.Deno.serve;
  globalThis.Deno.serve = (h) => { handler = h; return { shutdown() {} }; };
  t = await import("../../../supabase/functions/training/index.ts");
});
afterAll(() => { restoreEnv(); globalThis.Deno.serve = origServe; });

const FORMS = [
  { key: "application", label: "Application", sort: 0, form_id: null, name_match: "applica" },
  { key: "agreement", label: "Agreement form", sort: 3, form_id: "mZzO7e", name_match: "agreement" },
  { key: "scene", label: "Setting the Scene reflections", sort: 4, form_id: null, name_match: "setting the scene" },
];
const TID = "11111111-2222-4333-8444-555555555555";
const f = (label, value, type = "INPUT_TEXT", extra = {}) => ({ key: label, label, type, value, ...extra });
const sign = (body) => createHmac("sha256", SECRET).update(body).digest("base64");
async function hook(payload) {
  const body = JSON.stringify(payload);
  const res = await handler(new Request("https://x/training", { method: "POST", body, headers: { "tally-signature": sign(body) } }));
  return { status: res.status, body: await res.json() };
}
const webhook = (formId, formName, responseId, fields) => ({ eventType: "FORM_RESPONSE", data: { formId, formName, responseId, createdAt: "2026-10-20T10:00:00Z", fields } });

describe("answers", () => {
  it("choices use option text, files keep their links, derived checkbox fields are left out", () => {
    const a = t.toAnswers([
      f("Day", ["o1"], "DROPDOWN", { options: [{ id: "o1", text: "Monday" }] }),
      f("Video", [{ url: "https://storage.tally.so/v.mp4", name: "v.mp4", mimeType: "video/mp4", size: 9 }], "FILE_UPLOAD"),
      f("I agree", ["a"], "CHECKBOXES", { options: [{ id: "a", text: "Yes" }] }),
      f("I agree (Yes)", true, "CHECKBOXES"),
    ]);
    expect(a.map((x) => x.value)).toEqual(["Monday", "v.mp4", "Yes"]);
    expect(a[1].files[0]).toMatchObject({ url: "https://storage.tally.so/v.mp4", name: "v.mp4" });
  });
  it("person: email question first, names, phone; a full name is split", () => {
    expect(t.person(t.toAnswers([f("Email", "A@Example.org ", "INPUT_EMAIL"), f("First name", "Ana"), f("Last name", "Lee"), f("Phone", "+44 1", "INPUT_PHONE_NUMBER")])))
      .toEqual({ email: "a@example.org", first_name: "Ana", last_name: "Lee", initiated_name: "", phone: "+44 1" });
    expect(t.person(t.toAnswers([f("Your name", "Ana Maria Lee"), f("Your email address", "ana@example.org")]))).toMatchObject({ first_name: "Ana", last_name: "Maria Lee", email: "ana@example.org" });
  });
  it("trainee id from the hidden field, only when it looks like an id", () => {
    expect(t.trainingId(t.toAnswers([f("tid", TID.toUpperCase(), "HIDDEN_FIELDS")]))).toBe(TID);
    expect(t.trainingId(t.toAnswers([f("tid", "abc", "HIDDEN_FIELDS")]))).toBeNull();
    expect(t.trainingId([])).toBeNull();
  });
  it("forms: by id, else by name while the id is unknown", () => {
    expect(t.formFor(FORMS, "mZzO7e", "anything").key).toBe("agreement");
    expect(t.formFor(FORMS, "zzz", "Think Gita: Setting the Scene Reflections").key).toBe("scene");
    expect(t.formFor(FORMS, "zzz", "Request to Facilitate a Circle")).toBeNull();
  });
  it("API submissions: question titles, hidden fields as an object, files", () => {
    const qs = [{ id: "q1", type: "INPUT_EMAIL", title: "Email" }, { id: "q2", type: "HIDDEN_FIELDS", title: "Hidden" }, { id: "q3", type: "FILE_UPLOAD", title: "Your video" }];
    const a = t.apiAnswers(qs, { responses: [
      { questionId: "q1", answer: "x@example.org" }, { questionId: "q2", answer: { tid: TID } },
      { questionId: "q3", answer: [{ url: "https://u", name: "v.mov" }] },
    ] });
    expect(a).toEqual([
      { label: "Email", type: "INPUT_EMAIL", value: "x@example.org" },
      { label: "tid", type: "HIDDEN_FIELDS", value: TID },
      { label: "Your video", type: "FILE_UPLOAD", value: "v.mov", files: [{ url: "https://u", name: "v.mov", mimeType: undefined, size: undefined }] },
    ]);
    expect(t.trainingId(a)).toBe(TID);
  });
});

describe("webhook", () => {
  let fake;
  beforeEach(() => {
    fake = attachFake(t.db, { training_forms: structuredClone(FORMS), trainees: [], training_submissions: [], audit_log: [] });
  });

  it("rejects a bad signature", async () => {
    const res = await handler(new Request("https://x", { method: "POST", body: "{}", headers: { "tally-signature": "nope" } }));
    expect(res.status).toBe(401);
  });
  it("an application creates a trainee (and learns the form id); the same response again updates it", async () => {
    const fields = [f("Email", "ana@example.org", "INPUT_EMAIL"), f("First name", "Ana"), f("Last name", "Lee")];
    const r = await hook(webhook("facappq4", "Facilitator Application", "resp-1", fields));
    expect(r.body).toMatchObject({ result: "trainee", form: "application", created: true });
    expect(fake.tables.trainees).toHaveLength(1);
    expect(fake.tables.trainees[0]).toMatchObject({ email: "ana@example.org", first_name: "Ana", application_response_id: "resp-1" });
    expect(fake.tables.training_forms.find((x) => x.key === "application").form_id).toBe("facappq4");
    expect(fake.tables.training_submissions[0]).toMatchObject({ form_key: "application", trainee_id: fake.tables.trainees[0].id });
    await hook(webhook("facappq4", "Facilitator Application", "resp-1", [...fields.slice(0, 2), f("Last name", "Lee-Smith")]));
    expect(fake.tables.trainees).toHaveLength(1);
    expect(fake.tables.trainees[0].last_name).toBe("Lee-Smith");
    expect(fake.tables.training_submissions).toHaveLength(1);
  });
  it("training forms match by the id in the link first, then by email, else wait for matching", async () => {
    fake.tables.trainees.push({ id: TID, email: "ana@example.org", status: "applied", created_at: "2026-10-01" },
      { id: "t-2", email: "bo@example.org", status: "in_training", created_at: "2026-10-01" });
    const byId = await hook(webhook("mZzO7e", "Agreement", "a-1", [f("tid", TID, "HIDDEN_FIELDS"), f("Email", "other@example.org", "INPUT_EMAIL")]));
    expect(byId.body).toMatchObject({ result: "matched", trainee_id: TID, matched_by: "tid", form: "agreement" });
    const byEmail = await hook(webhook("mZzO7e", "Agreement", "a-2", [f("Email", "BO@example.org", "INPUT_EMAIL")]));
    expect(byEmail.body).toMatchObject({ result: "matched", trainee_id: "t-2", matched_by: "email" });
    const none = await hook(webhook("mZzO7e", "Agreement", "a-3", [f("Email", "who@example.org", "INPUT_EMAIL")]));
    expect(none.body).toMatchObject({ result: "unmatched", trainee_id: null });
    expect(fake.tables.training_submissions.map((s) => s.trainee_id)).toEqual([TID, "t-2", null]);
  });
  it("a re-sent response keeps a match an admin made", async () => {
    fake.tables.training_submissions.push({ id: "s-1", response_id: "a-9", trainee_id: "t-x", matched_by: "admin", form_key: "agreement" });
    const r = await hook(webhook("mZzO7e", "Agreement", "a-9", [f("Email", "who@example.org", "INPUT_EMAIL")]));
    expect(r.body).toMatchObject({ result: "matched", trainee_id: "t-x", matched_by: "admin", created: false });
    expect(fake.row("training_submissions", "s-1").trainee_id).toBe("t-x");
  });
  it("other forms are ignored", async () => {
    const r = await hook(webhook("w5lkx6", "Request to Facilitate a Circle", "c-1", []));
    expect(r.body).toEqual({ result: "ignored" });
    expect(fake.tables.training_submissions).toHaveLength(0);
  });
});

describe("decide", () => {
  let fake;
  const call = async (body) => {
    const res = await handler(new Request("https://x", { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer x" } }));
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => {
    sent.length = 0;
    fake = attachFake(t.db, {
      admin_emails: [{ email: "admin@example.org" }],
      trainees: [{ id: TID, email: "ana@example.org", status: "in_training" }], email_log: [], audit_log: [],
    });
  });
  it("records the outcome and sends the email as written", async () => {
    const r = await call({ action: "decide", trainee_id: TID, decision: "certified", send: true, subject: "Well done", text: "Dear Ana,\n\nLink: https://tally.so/r/w5lkx6", html: '<p>Dear Ana,</p><p>Link: <a href="https://tally.so/r/w5lkx6">https://tally.so/r/w5lkx6</a></p>' });
    expect(r.body.email).toBe("sent");
    expect(fake.row("trainees", TID)).toMatchObject({ status: "certified", decided_by: "admin@example.org", final_email_status: "sent" });
    expect(sent[0]).toMatchObject({ to: "ana@example.org", subject: "Well done" });
    expect(sent[0].html).toContain('<a href="https://tally.so/r/w5lkx6"');
    expect(fake.tables.email_log[0]).toMatchObject({ kind: "training_certified", trainee_id: TID, status: "sent" });
  });
  it("can record without an email", async () => {
    const r = await call({ action: "decide", trainee_id: TID, decision: "not_certified", send: false });
    expect(r.body.email).toBe("not sent");
    expect(fake.row("trainees", TID)).toMatchObject({ status: "not_certified", final_email_status: "not sent" });
    expect(sent).toHaveLength(0);
  });
  it("refuses an email with a placeholder left in, or an unknown decision", async () => {
    expect((await call({ action: "decide", trainee_id: TID, decision: "certified", send: true, subject: "Hi", text: "Dear {{first_name}}" })).status).toBe(400);
    expect((await call({ action: "decide", trainee_id: TID, decision: "maybe" })).status).toBe(400);
    expect(fake.row("trainees", TID).status).toBe("in_training");
  });
  it("admins only", async () => {
    fake.tables.admin_emails = [];
    expect((await call({ action: "decide", trainee_id: TID, decision: "certified" })).status).toBe(403);
  });
});

describe("file (fresh video link)", () => {
  it("fetches the submission again from Tally and stores the fresh answers", async () => {
    const fake = attachFake(t.db, {
      admin_emails: [{ email: "admin@example.org" }],
      training_forms: [{ key: "video", form_id: "ODzYRA" }],
      training_submissions: [{ id: "s-v", response_id: "resp-v", form_key: "video", trainee_id: TID, fields: [] }],
    });
    const orig = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ questions: [{ id: "q1", type: "FILE_UPLOAD", title: "Your video" }],
        submission: { id: "resp-v", responses: [{ questionId: "q1", answer: [{ url: "https://fresh/v.mov", name: "v.mov" }] }] } }), { status: 200 });
    };
    try {
      const res = await handler(new Request("https://x", { method: "POST", body: JSON.stringify({ action: "file", response_id: "resp-v" }), headers: { Authorization: "Bearer x" } }));
      const body = await res.json();
      expect(body.answers[0].files[0].url).toBe("https://fresh/v.mov");
      expect(seen[0]).toBe("https://api.tally.so/forms/ODzYRA/submissions/resp-v");
      expect(fake.row("training_submissions", "s-v").fields[0].files[0].url).toBe("https://fresh/v.mov");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("send_form, cooldown and other emails", () => {
  const call = async (body) => {
    const res = await handler(new Request("https://x", { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer x" } }));
    return { status: res.status, body: await res.json() };
  };
  it("sends each form email and records it; bad ones fail on their own", async () => {
    sent.length = 0;
    const fake = attachFake(t.db, {
      admin_emails: [{ email: "admin@example.org" }], training_forms: FORMS, trainees: [{ id: TID, email: "ana@example.org" }],
      training_sends: [], email_log: [], audit_log: [],
    });
    const r = await call({ action: "send_form", emails: [
      { trainee_id: TID, form_key: "agreement", subject: "Your next form", text: "Dear Ana,\n\nhttps://tally.so/r/mZzO7e?tid=" + TID, html: "<p>Dear Ana</p>" },
      { trainee_id: TID, form_key: "scene", subject: "Hi", text: "Dear {{first_name}}" },
      { trainee_id: "nobody", form_key: "agreement", subject: "Hi", text: "Hello" },
    ] });
    expect(r.body.results.map((x) => x.status)).toEqual(["sent", "failed", "failed"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.org", subject: "Your next form" });
    expect(fake.tables.training_sends).toEqual([expect.objectContaining({ trainee_id: TID, form_key: "agreement", status: "sent", sent_by: "admin@example.org" })]);
    expect(fake.tables.email_log[0]).toMatchObject({ kind: "training_form", trainee_id: TID });
  });
  it("a full sync is refused within 15 minutes of the last one", async () => {
    attachFake(t.db, { admin_emails: [{ email: "admin@example.org" }], settings: [{ id: 1, training_synced_at: new Date(Date.now() - 3 * 60000).toISOString() }] });
    const r = await call({ action: "sync" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^cooldown: synced 3 minutes ago, try again after \d\d:\d\d$/);
  });
  it("forms from an email an admin linked earlier match that trainee", async () => {
    const fake = attachFake(t.db, { training_forms: structuredClone(FORMS), trainees: [{ id: "t-k", email: "kokila.s@gmail.com", other_emails: ["kamalakisori108@gmail.com"], status: "in_training" }], training_submissions: [], audit_log: [] });
    const r = await hook(webhook("mZzO7e", "Agreement", "k-1", [f("Email", "kamalakisori108@gmail.com", "INPUT_EMAIL")]));
    expect(r.body).toMatchObject({ result: "matched", trainee_id: "t-k", matched_by: "email" });
    expect(fake.tables.training_submissions[0].trainee_id).toBe("t-k");
  });
});

describe("send_form pacing and limits", () => {
  const call = async (body) => {
    const res = await handler(new Request("https://x", { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer x" } }));
    return res.json();
  };
  const mail = (id) => ({ trainee_id: id, form_key: "agreement", subject: "Your next form", text: "Dear you" });
  it("knows which Gmail errors mean stop", () => {
    expect(t.stopSending({ responseCode: 421, message: "Try later" })).toBe(true);
    expect(t.stopSending({ code: "EAUTH" })).toBe(true);
    expect(t.stopSending({ responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded" })).toBe(true);
    expect(t.stopSending({ responseCode: 550, response: "550 5.1.1 No such user" })).toBe(false);
  });
  it("stops at the daily cap and leaves the rest unsent", async () => {
    sent.length = 0;
    const recent = new Date(Date.now() - 3600e3).toISOString();
    const fake = attachFake(t.db, {
      admin_emails: [{ email: "admin@example.org" }], training_forms: FORMS,
      trainees: [{ id: "a", email: "a@example.org" }, { id: "b", email: "b@example.org" }],
      email_log: Array.from({ length: t.DAILY_CAP - 1 }, (_, i) => ({ id: `l${i}`, kind: "training_form", status: "sent", sent_at: recent })),
      training_sends: [], audit_log: [],
    });
    const r = await call({ action: "send_form", emails: [mail("a"), mail("b")] });
    expect(r.results.map((x) => x.status)).toEqual(["sent", "not_sent"]);
    expect(r.stopped).toMatch(/daily limit/);
    expect(sent).toHaveLength(1);
    expect(fake.tables.training_sends).toHaveLength(1);
  });
});
