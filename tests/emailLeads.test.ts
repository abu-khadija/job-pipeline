import { describe, expect, it } from "vitest";
import { fetchEmailLeads, resolveLeads, type LeadExtractor } from "../src/sources/emailLeads.js";
import type { Mailbox, MailMessage, OutgoingMail } from "../src/gmail.js";
import { cfg } from "./helpers.js";

class FakeMailbox implements Mailbox {
  constructor(private msgs: MailMessage[]) {}
  async me() { return "islamabukhadiga@gmail.com"; }
  async send(_m: OutgoingMail) { return { id: "", threadId: "", messageId: "" }; }
  async thread() { return []; }
  async search() { return this.msgs; }
}
const msg = (over: Partial<MailMessage>): MailMessage => ({ id: "1", threadId: "", from: "LinkedIn <jobalerts-noreply@linkedin.com>", subject: "new jobs", date: "2026-10-04T08:00:00Z", messageId: "", text: "jobs", ...over });

class FakeExtractor implements LeadExtractor {
  constructor(private byText: (t: string) => { title: string; company: string }[]) {}
  async extract(t: string) { return this.byText(t); }
}

describe("fetchEmailLeads", () => {
  it("extracts and de-duplicates QA leads, tagging the source", async () => {
    const mb = new FakeMailbox([
      msg({ from: "LinkedIn <jobalerts-noreply@linkedin.com>", text: "a" }),
      msg({ id: "2", from: "ZipRecruiter <alerts@ziprecruiter.com>", text: "b" }),
    ]);
    const ex = new FakeExtractor((t) => t.includes("Subject: new jobs\n\na")
      ? [{ title: "QA Automation Engineer", company: "Acme" }, { title: "QA Automation Engineer", company: "Acme" }]
      : [{ title: "SDET", company: "Globex" }, { title: "", company: "NoTitle" }]);
    const leads = await fetchEmailLeads(cfg, mb, ex);
    expect(leads).toEqual([
      { title: "QA Automation Engineer", company: "Acme", source: "email:linkedin.com" },
      { title: "SDET", company: "Globex", source: "email:ziprecruiter.com" },
    ]);
  });
});

describe("resolveLeads", () => {
  it("keeps only leads found on a company site, with the real apply link", async () => {
    const get = async (url: string) => {
      if (url === "https://acme.recruitee.com/api/offers/") {
        return JSON.stringify({ offers: [{ title: "QA Automation Engineer", careers_url: "https://acme.recruitee.com/o/qa", remote: true, locations: [{ country: "Egypt" }], description: "<p>Playwright</p>" }] });
      }
      throw new Error("HTTP 404");
    };
    const jobs = await resolveLeads(cfg, get, [
      { title: "QA Automation Engineer", company: "Acme", source: "email:linkedin.com" },
      { title: "QA Engineer", company: "Ghostco", source: "email:linkedin.com" },
    ], "2026-10-04T00:00:00Z");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: "email:linkedin.com", company: "Acme", applyUrl: "https://acme.recruitee.com/o/qa", places: ["Egypt"] });
  });
});
