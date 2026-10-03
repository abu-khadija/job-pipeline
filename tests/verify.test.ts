// Egypt eligibility on the company's own site, using today's real cases.
import { describe, expect, it } from "vitest";
import { findCompanyPosting, sameTitle, slugCandidates, type CompanyPosting } from "../src/verify/companySite.js";
import { judgePosting } from "../src/verify/index.js";
import { cfg } from "./helpers.js";

const t = cfg.targeting;
const posting = (over: Partial<CompanyPosting>): CompanyPosting => ({ provider: "recruitee", url: "https://x.recruitee.com/o/qa", title: "QA Automation Engineer", places: [], remote: true, text: "", ...over });

describe("judgePosting", () => {
  it("TransPerfect: 15 countries without Egypt (Morocco among them) → no", () => {
    const p = posting({ places: ["Argentina", "Brazil", "Colombia", "Costa Rica", "Mexico", "Serbia", "Poland", "Czechia", "Romania", "Morocco", "South Africa", "Hungary", "Peru", "Chile", "Bulgaria"] });
    expect(judgePosting(p, t).egypt).toBe("no");
  });
  it("zvoove: German permanent employment (DE/AT - Festangestellte) → no", () => {
    expect(judgePosting(posting({ provider: "personio", text: "zvoove Germany GmbH Remote DE | DE/AT - Festangestellte" }), t).egypt).toBe("no");
  });
  it("The Codest: one country next to a remote job is the office, not a limit → unknown", () => {
    expect(judgePosting(posting({ places: ["Poland"] }), t).egypt).toBe("unknown");
  });
  it("one region is a real limit: Europe → not yes", () => {
    expect(judgePosting(posting({ provider: "greenhouse", places: ["Europe ()"], text: "We work globally." }), t).egypt).not.toBe("yes");
  });
  it("Egypt or worldwide on the company site → yes", () => {
    expect(judgePosting(posting({ places: ["Egypt", "Poland"] }), t).egypt).toBe("yes");
    expect(judgePosting(posting({ text: "Fully remote, work from anywhere in the world." }), t).egypt).toBe("yes");
  });
  it("a Gulf-only list stays for the AI to judge", () => {
    expect(judgePosting(posting({ places: ["United Arab Emirates", "Saudi Arabia"] }), t).egypt).toBe("unknown");
  });
});

describe("finding the posting", () => {
  it("slug guesses cover legal names and 'The'", () => {
    expect(slugCandidates("Codest Ltd. Company No. 12590542, VAT number: GB363431020")).toContain("thecodest");
    expect(slugCandidates("Newel Health")).toEqual(expect.arrayContaining(["newelhealth", "newel-health"]));
  });
  it("matches titles across boards", () => {
    expect(sameTitle("QA Automation Engineer (m/f/d) - AI-First Quality Engineering", "QA Automation Engineer (m/f/d) - AI-First Quality Engineering")).toBe(true);
    expect(sameTitle("Senior QA Automation Engineer", "QA Automation Engineer")).toBe(true);
    expect(sameTitle("QA Automation Engineer", "Backend Engineer")).toBe(false);
  });
  it("reads a Recruitee board and returns the company's own link", async () => {
    const get = async (url: string) => {
      if (url === "https://thecodest.recruitee.com/api/offers/") {
        return JSON.stringify({ offers: [{ title: "Senior QA Automation Engineer", careers_url: "https://thecodest.recruitee.com/o/senior-qa-automation-engineer", remote: true, locations: [{ country: "Poland" }], description: "<p>Playwright</p>" }] });
      }
      throw new Error("HTTP 404");
    };
    const p = await findCompanyPosting(get, "Codest Ltd.", "Senior QA Automation Engineer");
    expect(p).toMatchObject({ provider: "recruitee", url: "https://thecodest.recruitee.com/o/senior-qa-automation-engineer", places: ["Poland"] });
  });
  it("returns null when no board has the job", async () => {
    expect(await findCompanyPosting(async () => { throw new Error("HTTP 404"); }, "Nobody Inc", "QA Engineer")).toBeNull();
  });
});

describe("npm run verify", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { LocalStore } = await import("../src/store/local.js");
  const { runVerify } = await import("../src/verify/run.js");

  it("drops jobs not open to Egypt, skips their drafts, and swaps in company links", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-"));
    const row = (job_id: string, company: string, status = "drafted") => ({ job_id, company, title: "QA Automation Engineer", status, breakdown: "", apply_url: "https://himalayas.app/x", ats: "other", filter_reasons: "" });
    writeFileSync(path.join(dir, "Jobs.json"), JSON.stringify([row("t", "TransPerfect"), row("c", "Codest"), row("m", "Maybe Co", "maybe")]));
    writeFileSync(path.join(dir, "Drafts.json"), JSON.stringify([{ job_id: "t", status: "draft", route: "link" }, { job_id: "c", status: "draft", route: "link", apply_to: "https://himalayas.app/c" }]));
    const store = new LocalStore(dir);
    const r = await runVerify({
      store,
      verify: async (company) => company === "TransPerfect"
        ? { egypt: "no", reason: "company site (recruitee: Brazil, Poland)", posting: null }
        : { egypt: "unknown", reason: "company site doesn't say", posting: { provider: "recruitee", url: "https://thecodest.recruitee.com/o/qa", title: "QA", places: ["Poland"], remote: true, text: "" } },
    });
    expect(r).toEqual({ checked: 2, dropped: 1, linked: 1 });
    expect((await store.readTable("Jobs")).map((j) => j.job_id)).toEqual(["c", "m"]);
    expect((await store.readTable("Filtered"))[0]!.filter_reasons).toMatch(/^not open to Egypt/);
    const drafts = await store.readTable("Drafts");
    expect(drafts.find((d) => d.job_id === "t")!.status).toBe("skipped");
    expect(drafts.find((d) => d.job_id === "c")).toMatchObject({ apply_to: "https://thecodest.recruitee.com/o/qa", route: "form" });
  });
});
