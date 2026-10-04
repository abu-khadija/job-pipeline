// Phases 3–5: send rules, Gmail message building, form answers, and the send / apply /
// follow-up / reply runs with fake mailboxes, fillers and models.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answerFor, PROFILE, salaryAnswer, type AnswerContext, type FieldInfo } from "../src/forms/answers.js";
import type { FillReport, FormFiller } from "../src/forms/browser.js";
import { runApply } from "../src/forms/index.js";
import { buildMime, messageText, type MailMessage, type Mailbox, type OutgoingMail } from "../src/gmail.js";
import { setEnv } from "../src/gmailAuth.js";
import { followUpText, runFollowups, runReplies, type ReplyBrain } from "../src/replies.js";
import type { AiReply, DraftRow, JobRow, SentRow } from "../src/schema.js";
import { runSend } from "../src/send/index.js";
import { companyAllowed, dueForFollowUp, inWorkingHours, isLive, sentToday } from "../src/send/rules.js";
import { LocalStore } from "../src/store/local.js";
import { NOW, ROOT, cfg } from "./helpers.js";

const L = cfg.limits;
const LIVE_ENV = { DRY_RUN: "false" } as NodeJS.ProcessEnv;
const AT_NOON = new Date("2026-10-02T12:00:00Z"); // inside sending hours

function sent(over: Partial<SentRow> = {}): SentRow {
  return {
    sent_at: "2026-10-02T09:00:00Z", job_id: "j1", company: "Acme", title: "QA Engineer", channel: "email", to: "jobs@acme.com",
    subject: "QA Engineer application", gmail_thread_id: "t1", gmail_message_id: "<m1@mail>", followed_up_at: "",
    reply_status: "", reply_at: "", reply_summary: "", notes: "", ...over,
  };
}

describe("send rules", () => {
  it("is live only when the Sheet says live AND DRY_RUN=false", () => {
    expect(isLive({ killSwitch: "RUN", mode: "live" }, LIVE_ENV)).toBe(true);
    expect(isLive({ killSwitch: "RUN", mode: "live" }, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isLive({ killSwitch: "RUN", mode: "live" }, { DRY_RUN: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isLive({ killSwitch: "RUN", mode: "dry" }, LIVE_ENV)).toBe(false);
    expect(isLive({ killSwitch: "STOP", mode: "live" }, LIVE_ENV)).toBe(false);
  });
  it("counts today's sends and working hours in UTC", () => {
    expect(sentToday([sent(), sent({ sent_at: "2026-10-01T09:00:00Z" })], AT_NOON)).toBe(1);
    expect(inWorkingHours(AT_NOON, L)).toBe(true);
    expect(inWorkingHours(new Date("2026-10-02T03:00:00Z"), L)).toBe(false);
  });
  it("one application per company per 60 days; Deel up to 3", () => {
    expect(companyAllowed("Acme Ltd.", [sent()], AT_NOON, L).ok).toBe(false);
    expect(companyAllowed("Acme", [sent({ sent_at: "2026-06-01T00:00:00Z" })], AT_NOON, L).ok).toBe(true);
    const deel = [sent({ company: "Deel" }), sent({ company: "Deel" })];
    expect(companyAllowed("Deel", deel, AT_NOON, L).ok).toBe(true);
    expect(companyAllowed("Deel", [...deel, sent({ company: "Deel" })], AT_NOON, L).ok).toBe(false);
  });
  it("follow-up due after N days with no real reply; auto-receipts don't count", () => {
    const old = "2026-09-20T09:00:00Z";
    expect(dueForFollowUp([sent({ sent_at: old })], AT_NOON, L)).toHaveLength(1);
    expect(dueForFollowUp([sent({ sent_at: old, gmail_thread_id: "" })], AT_NOON, L)).toHaveLength(1); // SMTP: no thread id
    expect(dueForFollowUp([sent({ sent_at: old, reply_status: "other" })], AT_NOON, L)).toHaveLength(1);
    expect(dueForFollowUp([sent({ sent_at: old, reply_status: "reject" })], AT_NOON, L)).toHaveLength(0);
    expect(dueForFollowUp([sent({ sent_at: old, followed_up_at: "2026-09-27T00:00:00Z" })], AT_NOON, L)).toHaveLength(0);
    expect(dueForFollowUp([sent()], AT_NOON, L)).toHaveLength(0);
    expect(dueForFollowUp([sent({ sent_at: old, channel: "form", gmail_thread_id: "" })], AT_NOON, L)).toHaveLength(0);
  });
});

describe("Gmail message building", () => {
  it("builds headers, strips header injection, encodes non-ASCII, threads replies", () => {
    const raw = buildMime(
      { to: "jobs@acme.com\r\nBcc: evil@x.com", subject: "Bewerbung – QA", body: "Hello", inReplyTo: "<m1@mail>" },
      "islamabukhadiga@gmail.com",
    );
    expect(raw).toContain("To: jobs@acme.com Bcc: evil@x.com");
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <m1@mail>");
    expect(raw).toContain(Buffer.from("Hello").toString("base64"));
  });
  it("attaches files as base64 parts", () => {
    const raw = buildMime(
      { to: "a@b.co", subject: "S", body: "B", attachments: [{ filename: "cv.pdf", path: "x", mimeType: "application/pdf" }] },
      "me@x.com",
      () => Buffer.from("PDFDATA"),
    );
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain('filename="cv.pdf"');
    expect(raw).toContain(Buffer.from("PDFDATA").toString("base64"));
  });
  it("reads plain text, falling back to HTML without tags", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    expect(messageText({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("Hi there") } }] })).toBe("Hi there");
    expect(messageText({ mimeType: "text/html", body: { data: b64("<p>Hi <b>you</b></p>") } })).toBe("Hi you");
  });
  it("writes .env values in place", () => {
    expect(setEnv("A=1\nGMAIL_REFRESH_TOKEN=old\n", "GMAIL_REFRESH_TOKEN", "new")).toBe("A=1\nGMAIL_REFRESH_TOKEN=new\n");
    expect(setEnv("A=1", "B", "2")).toBe("A=1\nB=2\n");
  });
});

describe("form answers", () => {
  const ctx: AnswerContext = { company: "Acme", coverLetter: "Dear Hiring Team…", salaryUsdMonth: "3000-4500", defaultSalaryUsdMonth: 3500, source: "himalayas" };
  const f = (question: string, over: Partial<FieldInfo> = {}): FieldInfo => ({ kind: "text", question, options: [], required: false, ...over });
  const a = (question: string, over: Partial<FieldInfo> = {}) => answerFor(f(question, over), ctx);

  it("fills identity and contact facts", () => {
    expect(a("First Name*")).toEqual({ action: "fill", value: "Islam" });
    expect(a("Last Name*")).toEqual({ action: "fill", value: "Abu-Khadija" });
    expect(a("Full name ✱")).toEqual({ action: "fill", value: "Islam Ibrahim Abu-Khadija" });
    expect(a("Legal Name")).toEqual({ action: "fill", value: "Islam Ibrahim Abu-Khadija" });
    expect(a("Email ✱")).toEqual({ action: "fill", value: PROFILE.email });
    expect(a("Phone ✱")).toEqual({ action: "fill", value: PROFILE.phone });
    expect(a("LinkedIn Profile")).toEqual({ action: "fill", value: PROFILE.linkedin });
    expect(a("What's the name you'd prefer us to use throughout the interview process?")).toEqual({ action: "fill", value: "Islam" });
    expect(a("Current company ✱")).toEqual({ action: "fill", value: "Flairstech" });
    expect(a("What is your current country of residence?*", { kind: "combobox", required: true })).toEqual({ action: "fill", value: "Egypt" });
    expect(a("Current location ✱")).toEqual({ action: "fill", value: "Alexandria, Egypt" });
  });
  it("uploads the CV and cover letter", () => {
    expect(a("Attach", { kind: "file" })).toEqual({ action: "file", file: "cv" });
    expect(a("Resume/CV ✱ ATTACH RESUME/CV", { kind: "file" })).toEqual({ action: "file", file: "cv" });
    expect(a("Cover Letter", { kind: "file" })).toEqual({ action: "file", file: "cover" });
  });
  it("leaves visa, legal and consent questions to Islam", () => {
    expect(a("Will you now or in the future require sponsorship for a visa?*", { required: true }).action).toBe("ask");
    expect(a("Are you legally authorized to work in the United States?", { kind: "radio", options: ["Yes", "No"], required: true }).action).toBe("ask");
    expect(a("Are you subject to any employment agreements and/or post-employment restrictions?*", { required: true }).action).toBe("ask");
    expect(a("I agree to the privacy policy", { kind: "checkbox", required: true }).action).toBe("ask");
    expect(a("Spotify has my consent to contact me about future job opportunities.", { kind: "checkbox" }).action).toBe("skip");
    expect(a("Do you have a minimum of 7 years of experience building software?", { kind: "checkbox", required: true }).action).toBe("ask");
    expect(a("Please elaborate on your experience building software in AWS (with Terraform)", { kind: "textarea", required: true }).action).toBe("ask");
  });
  it("declines demographic questions when it can, never guesses", () => {
    expect(a("Gender", { kind: "radio", options: ["Woman", "Man", "Prefer not to disclose"] })).toEqual({ action: "fill", value: "Prefer not to disclose" });
    expect(a("Veteran Status", { kind: "select", options: ["I am a veteran", "I am not a veteran"] }).action).toBe("skip");
  });
  it("uses the salary rule and marks judgement calls for checking", () => {
    expect(salaryAnswer("3000-4500", 3500)).toBe("4,500 USD per month");
    expect(salaryAnswer("", 3500)).toBe("3,500 USD per month");
    expect(a("What are your salary expectations?")).toEqual({ action: "check", value: "4,500 USD per month" });
    expect(a("Have you previously worked at or consulted for GitLab?*", { kind: "radio", options: ["Yes", "No"], required: true })).toEqual({ action: "check", value: "No" });
    expect(a("Notice period")).toEqual({ action: "check", value: "30 days" });
  });
  it("skips optional unknowns and asks for required ones", () => {
    expect(a("Anything else you'd like to share?").action).toBe("skip");
    expect(a("Describe a bug you are proud of", { kind: "textarea", required: true }).action).toBe("ask");
  });
  it("profile answers come from master-profile.md", () => {
    const profile = readFileSync(path.join(ROOT, "docs", "master-profile.md"), "utf8");
    for (const v of [PROFILE.full, PROFILE.email, PROFILE.phone, "linkedin.com/in/abukhadija-iti", "github.com/abu-khadija", PROFILE.city, PROFILE.company, PROFILE.title]) {
      expect(profile).toContain(v);
    }
  });
});

// --- runs ------------------------------------------------------------------------------------

class FakeMailbox implements Mailbox {
  sentMail: OutgoingMail[] = [];
  constructor(public threads: Record<string, MailMessage[]> = {}, public found: MailMessage[] = []) {}
  async send(mail: OutgoingMail) {
    this.sentMail.push(mail);
    return { id: `id${this.sentMail.length}`, threadId: mail.threadId ?? `t${this.sentMail.length}`, messageId: `<m${this.sentMail.length}@mail>` };
  }
  async thread(id: string) { return this.threads[id] ?? []; }
  async search() { return this.found; }
  async me() { return "islamabukhadiga@gmail.com"; }
}

function draft(over: Partial<DraftRow> = {}): DraftRow {
  return {
    job_id: "j1", created_at: "2026-10-01T00:00:00Z", status: "draft", hold_reason: "", company: "Acme", title: "QA Engineer",
    score: 80, cv_variant: "ai_automation", route: "email", apply_to: "jobs@acme.com", email_subject: "QA Engineer application",
    email_body: "Hi Acme team…", cover_letter: "Dear…", cv_summary: "", post_detail: "", files: "", gates: "", unsupported_claims: "",
    cost_usd_est: 0.1, notes: "", ...over,
  };
}

function storeWith(drafts: DraftRow[], opts: { control?: object; sent?: SentRow[]; withPdf?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "phases-"));
  const store = new LocalStore(dir);
  const ds = drafts.map((d, i) => {
    if (opts.withPdf === false) return d;
    const folder = path.join(dir, "drafts", `d${i}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "Islam-Abu-Khadija-CV.pdf"), "pdf");
    writeFileSync(path.join(folder, "job-post.txt"), "QA Engineer at Acme. Playwright.");
    return { ...d, files: folder };
  });
  writeFileSync(path.join(dir, "Drafts.json"), JSON.stringify(ds));
  writeFileSync(path.join(dir, "Sent.json"), JSON.stringify(opts.sent ?? []));
  const jobs = drafts.map((d) => ({ job_id: d.job_id, status: "drafted", company: d.company, title: d.title, ats: "lever", salary_usd_month: "", sources: "himalayas" }) as unknown as JobRow);
  writeFileSync(path.join(dir, "Jobs.json"), JSON.stringify(jobs));
  writeFileSync(path.join(dir, "control.json"), JSON.stringify(opts.control ?? { killSwitch: "RUN", mode: "live" }));
  return { dir, store };
}

describe("runSend (Phase 3)", () => {
  it("dry run: reports, sends nothing, changes nothing", async () => {
    const { store } = storeWith([draft()], { control: { killSwitch: "RUN", mode: "dry" } });
    const mb = new FakeMailbox();
    const r = await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(r.live).toBe(false);
    expect(r.wouldSend).toHaveLength(1);
    expect(mb.sentMail).toHaveLength(0);
    expect((await store.readTable("Drafts"))[0]!.status).toBe("draft");
  });

  it("live: sends with the CV attached and records it everywhere", async () => {
    const { store } = storeWith([draft()]);
    const mb = new FakeMailbox();
    const r = await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(r.sent).toHaveLength(1);
    expect(mb.sentMail[0]!.to).toBe("jobs@acme.com");
    expect(mb.sentMail[0]!.attachments?.[0]?.filename).toBe("Islam-Abu-Khadija-CV.pdf");
    expect((await store.readTable("Drafts"))[0]!.status).toBe("sent");
    expect((await store.readTable("Jobs"))[0]!.status).toBe("applied");
    expect((await store.readTable("Sent"))[0]!.gmail_thread_id).toBe("t1");
  });

  it("never more than maxSendsPerRun per run, best score first", async () => {
    const ds = [1, 2, 3, 4, 5].map((i) => draft({ job_id: `j${i}`, company: `C${i}`, score: 60 + i }));
    const { store } = storeWith(ds);
    const mb = new FakeMailbox();
    await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(L.sending.maxSendsPerRun);
    expect((await store.readTable("Sent"))[0]!.company).toBe("C5");
  });

  it("respects the daily cap", async () => {
    const already = Array.from({ length: L.sending.maxApplicationsPerDay }, (_, i) => sent({ company: `X${i}`, sent_at: "2026-10-02T08:00:00Z" }));
    const { store } = storeWith([draft()], { sent: already });
    const mb = new FakeMailbox();
    await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(0);
  });

  it("skips a company applied to recently; holds a draft whose PDF is missing", async () => {
    const { store } = storeWith([draft()], { sent: [sent({ job_id: "old" })] });
    const mb = new FakeMailbox();
    await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(0);
    expect((await store.readTable("Drafts"))[0]!.status).toBe("skipped");

    const s2 = storeWith([draft()], { withPdf: false });
    await runSend({ cfg, store: s2.store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect((await s2.store.readTable("Drafts"))[0]!.status).toBe("held");
  });

  it("kill switch STOP and night hours: nothing sent", async () => {
    const mb = new FakeMailbox();
    const a = storeWith([draft()], { control: { killSwitch: "STOP", mode: "live" } });
    expect((await runSend({ cfg, store: a.store, mailbox: mb, now: AT_NOON, env: LIVE_ENV })).stopped).toBe(true);
    const b = storeWith([draft()]);
    await runSend({ cfg, store: b.store, mailbox: mb, now: new Date("2026-10-02T02:00:00Z"), env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(0);
  });

  it("never emails a form or link application", async () => {
    const { store } = storeWith([draft({ route: "link", apply_to: "https://himalayas.app/x" })]);
    const mb = new FakeMailbox();
    const r = await runSend({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(0);
    expect(r.waitingForms).toBe(1);
  });
});

class FakeFiller implements FormFiller {
  urls: string[] = [];
  closed = false;
  async fill(url: string): Promise<FillReport> {
    this.urls.push(url);
    return { url, filled: ["First Name: Islam"], check: [], ask: ["Visa — work authorization / visa"], error: "" };
  }
  async close() { this.closed = true; }
}

describe("runApply (Phase 4)", () => {
  const forms = () => [
    draft({ job_id: "a", company: "A", route: "form", apply_to: "https://jobs.lever.co/a/1", score: 90 }),
    draft({ job_id: "b", company: "B", route: "link", apply_to: "https://himalayas.app/b", score: 80 }),
    draft({ job_id: "c", company: "C", route: "link", apply_to: "https://himalayas.app/c", score: 70 }),
    draft({ job_id: "d", company: "D", route: "email" }),
  ];

  it("records only what Islam says he submitted; keeps, skips and quits", async () => {
    const { store } = storeWith(forms());
    const filler = new FakeFiller();
    // b and c are Himalayas links: each first asks for the company link.
    const answers = ["s", "https://jobs.ashbyhq.com/b/1", "n", "https://boards.greenhouse.io/c/jobs/2", "q"];
    const r = await runApply({ cfg, store, filler, ask: async () => answers.shift()!, openExternal: () => {}, now: AT_NOON });
    expect(r.submitted).toBe(1);
    expect(filler.urls).toEqual(["https://jobs.lever.co/a/1", "https://jobs.ashbyhq.com/b/1", "https://boards.greenhouse.io/c/jobs/2"]);
    expect(filler.closed).toBe(true);
    const ds = await store.readTable("Drafts");
    expect(ds.find((d) => d.job_id === "a")!.status).toBe("sent");
    expect(ds.find((d) => d.job_id === "b")!.status).toBe("skipped");
    expect(ds.find((d) => d.job_id === "c")!.status).toBe("draft");
    expect(ds.find((d) => d.job_id === "d")!.status).toBe("draft");
    expect((await store.readTable("Sent"))[0]).toMatchObject({ job_id: "a", channel: "form" });
    expect((await store.readTable("Jobs")).find((j) => j.job_id === "a")!.status).toBe("applied");
  });

  it("Himalayas: opens it in Islam's browser, uses the pasted company link and remembers it", async () => {
    const { store } = storeWith([draft({ job_id: "b", company: "B", route: "link", apply_to: "https://himalayas.app/b" })]);
    const opened: string[] = [];
    const filler = new FakeFiller();
    const answers = ["https://jobs.lever.co/b/9", "k"];
    await runApply({ cfg, store, filler, ask: async () => answers.shift()!, openExternal: (u) => opened.push(u), now: AT_NOON });
    expect(opened).toEqual(["https://himalayas.app/b"]);
    expect(filler.urls).toEqual(["https://jobs.lever.co/b/9"]);
    expect((await store.readTable("Drafts"))[0]).toMatchObject({ apply_to: "https://jobs.lever.co/b/9", route: "form", status: "draft" });
  });

  it("Himalayas: an empty or Himalayas answer skips without opening the robot browser", async () => {
    const { store } = storeWith([draft({ route: "link", apply_to: "https://himalayas.app/b" })]);
    const filler = new FakeFiller();
    const answers = ["https://himalayas.app/b/apply"];
    await runApply({ cfg, store, filler, ask: async () => answers.shift() ?? "", openExternal: () => {}, now: AT_NOON });
    expect(filler.urls).toHaveLength(0);
  });

  it("keep for later changes nothing", async () => {
    const { store } = storeWith(forms());
    await runApply({ cfg, store, filler: new FakeFiller(), ask: async (q) => (q.startsWith("Paste") ? "" : "k"), openExternal: () => {}, now: AT_NOON });
    expect((await store.readTable("Sent"))).toHaveLength(0);
  });
});

describe("follow-ups (Phase 5)", () => {
  const old = sent({ sent_at: "2026-09-24T09:00:00Z" });
  it("text uses clean names and the signature", () => {
    const t = followUpText(sent({ company: "Codest Ltd. Company No. 1", title: "QA Engineer (m/f/d)" }), cfg.writing.followUpTemplate, "Best regards,\nIslam");
    expect(t).toContain("Hi Codest team,");
    expect(t).toContain("the QA Engineer role");
    expect(t).toMatch(/Best regards,\nIslam$/);
  });
  it("live: replies in the same thread once", async () => {
    const { store } = storeWith([], { sent: [old] });
    const mb = new FakeMailbox();
    expect((await runFollowups({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV })).sent).toBe(1);
    expect(mb.sentMail[0]).toMatchObject({ threadId: "t1", inReplyTo: "<m1@mail>", subject: "Re: QA Engineer application" });
    expect((await runFollowups({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV })).sent).toBe(0);
  });
  it("dry: sends nothing", async () => {
    const { store } = storeWith([], { sent: [old], control: { killSwitch: "RUN", mode: "dry" } });
    const mb = new FakeMailbox();
    expect((await runFollowups({ cfg, store, mailbox: mb, now: AT_NOON, env: LIVE_ENV })).wouldSend).toBe(1);
    expect(mb.sentMail).toHaveLength(0);
  });
});

class FakeBrain implements ReplyBrain {
  classified: string[] = [];
  constructor(private kind: AiReply["kind"]) {}
  async classify(reply: string) {
    this.classified.push(reply);
    return { kind: this.kind, summary: `They sent: ${this.kind}`, dates: this.kind === "invite" ? ["Oct 8, 3pm CET"] : [] };
  }
  async prepPack() { return "# Prep\n\nLikely questions…"; }
}

describe("replies (Phase 5)", () => {
  const msg = (over: Partial<MailMessage>): MailMessage => ({ id: "x", threadId: "t1", from: "Jane <jane@acme.com>", subject: "Re: QA", date: "2026-10-02T11:00:00Z", messageId: "<r@acme>", text: "Let's talk", ...over });
  const mine = msg({ from: "Islam <islamabukhadiga@gmail.com>", date: "2026-10-02T09:00:00Z" });

  it("invite: marks the job, writes a prep pack and alerts Islam's own inbox", async () => {
    const { dir, store } = storeWith([draft()], { sent: [sent({ gmail_thread_id: "" })] });
    const mb = new FakeMailbox({}, [msg({})]);
    const r = await runReplies({ cfg, store, mailbox: mb, brain: new FakeBrain("invite"), now: AT_NOON, prepDir: path.join(dir, "prep") });
    expect(r).toMatchObject({ found: 1, invites: 1 });
    const row = (await store.readTable("Sent"))[0]!;
    expect(row.reply_status).toBe("invite");
    expect(row.reply_summary).toContain("Oct 8, 3pm CET");
    expect((await store.readTable("Jobs"))[0]!.status).toBe("replied_invite");
    expect(mb.sentMail).toHaveLength(1);
    expect(mb.sentMail[0]!.to).toBe("islamabukhadiga@gmail.com");
    expect(mb.sentMail[0]!.body).toContain("Likely questions");
  });

  it("ignores Islam's own messages and does not re-read a seen reply", async () => {
    const { store } = storeWith([draft()], { sent: [sent({ gmail_thread_id: "" })] });
    const brain = new FakeBrain("reject");
    const quiet = new FakeMailbox({}, [mine]); // search returns only Islam's own message
    expect((await runReplies({ cfg, store, mailbox: quiet, brain, now: AT_NOON })).found).toBe(0);
    const mb = new FakeMailbox({}, [msg({})]);
    await runReplies({ cfg, store, mailbox: mb, brain, now: AT_NOON });
    expect((await store.readTable("Jobs"))[0]!.status).toBe("replied_reject");
    expect(mb.sentMail).toHaveLength(0); // no alert for a rejection
    expect((await runReplies({ cfg, store, mailbox: mb, brain, now: AT_NOON })).checked).toBe(0);
  });

  it("form applications: finds replies by company name", async () => {
    const { store } = storeWith([draft({ route: "form" })], { sent: [sent({ channel: "form", gmail_thread_id: "", to: "https://jobs.lever.co/acme/1" })] });
    const mb = new FakeMailbox({}, [msg({ threadId: "other" })]);
    const r = await runReplies({ cfg, store, mailbox: mb, brain: new FakeBrain("question"), now: AT_NOON });
    expect(r.found).toBe(1);
    expect(mb.sentMail[0]!.subject).toContain("Question: Acme");
  });

  it("kill switch STOP: reads nothing", async () => {
    const { store } = storeWith([draft()], { sent: [sent()], control: { killSwitch: "STOP", mode: "live" } });
    const brain = new FakeBrain("invite");
    await runReplies({ cfg, store, mailbox: new FakeMailbox({ t1: [msg({})] }), brain, now: AT_NOON });
    expect(brain.classified).toHaveLength(0);
  });
});

describe("form answers — labels seen on live forms", () => {
  const ctx: AnswerContext = { company: "Spotify", coverLetter: "x", salaryUsdMonth: "", defaultSalaryUsdMonth: 3500, source: "" };
  it("Greenhouse file inputs labelled 'Attach' are told apart by id", () => {
    expect(answerFor({ kind: "file", question: "Attach resume", options: [], required: false }, ctx)).toEqual({ action: "file", file: "cv" });
    expect(answerFor({ kind: "file", question: "Attach cover letter", options: [], required: false }, ctx)).toEqual({ action: "file", file: "cover" });
  });
  it("Lever 'previously employed by' gets No to check", () => {
    const a = answerFor({ kind: "radio", question: "Have you ever been previously employed by Spotify?", options: ["Yes", "No"], required: true }, ctx);
    expect(a).toEqual({ action: "check", value: "No" });
  });
});

describe("Gmail sign-in expiry", () => {
  it("counts the days left of the 7-day Testing token", async () => {
    const { gmailDaysLeft } = await import("../src/gmail.js");
    expect(gmailDaysLeft("2026-10-01T12:00:00Z", AT_NOON)).toBe(6);
    expect(gmailDaysLeft("2026-09-25T13:00:00Z", AT_NOON)).toBe(0);
    expect(gmailDaysLeft("2026-09-24T13:00:00Z", AT_NOON)).toBe(-1);
    expect(gmailDaysLeft(undefined, AT_NOON)).toBeNull();
  });
});

describe("weekends", () => {
  it("no sending on Saturday or Sunday, even in working hours", () => {
    expect(inWorkingHours(new Date("2026-10-03T12:00:00Z"), L)).toBe(false); // Saturday
    expect(inWorkingHours(new Date("2026-10-04T12:00:00Z"), L)).toBe(false); // Sunday
    expect(inWorkingHours(new Date("2026-10-05T12:00:00Z"), L)).toBe(true);  // Monday
  });
  it("a live send on Saturday sends nothing", async () => {
    const { store } = storeWith([draft()]);
    const mb = new FakeMailbox();
    await runSend({ cfg, store, mailbox: mb, now: new Date("2026-10-03T12:00:00Z"), env: LIVE_ENV });
    expect(mb.sentMail).toHaveLength(0);
  });
});
