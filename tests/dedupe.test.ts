import { describe, expect, it } from "vitest";
import { dedupe } from "../src/dedupe.js";
import { jobId, normalizeCompany } from "../src/normalize/index.js";
import { job } from "./helpers.js";

describe("jobId", () => {
  it("ignores company suffixes, punctuation and seniority words", () => {
    expect(jobId("Acme Inc.", "Senior QA Engineer")).toBe(jobId("ACME", "Sr. QA Engineer"));
    expect(jobId("Acme", "QA Engineer")).not.toBe(jobId("Acme", "QA Analyst"));
    expect(normalizeCompany("Acme GmbH")).toBe("acme");
  });
});

describe("dedupe", () => {
  it("merges the same job from two sources and keeps the copy with a salary", () => {
    const a = job({ source: "remoteok", applyUrl: "https://jobs.lever.co/acme/1" });
    const b = job({ source: "himalayas", applyUrl: "https://jobs.lever.co/acme/1", salaryText: "$4,000/month" });
    const r = dedupe([a, b], []);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0]!.salaryMaxUsdMonth).toBe(4000);
    expect([...r.seenAgain.get(a.id)!]).toEqual(expect.arrayContaining(["remoteok", "himalayas"]));
  });

  it("matches on apply URL even when titles differ", () => {
    const a = job({ title: "QA Engineer", applyUrl: "https://jobs.ashbyhq.com/acme/9" });
    const b = job({ title: "Quality Engineer", applyUrl: "https://jobs.ashbyhq.com/acme/9" });
    expect(dedupe([a, b], []).fresh).toHaveLength(1);
  });

  it("skips jobs already known and reports them as seen again", () => {
    const a = job({ source: "wwr" });
    const r = dedupe([a], [{ id: a.id, applyUrl: "", sources: ["remoteok"] }]);
    expect(r.fresh).toHaveLength(0);
    expect(r.seenAgain.get(a.id)?.has("wwr")).toBe(true);
  });

  it("keeps different jobs", () => {
    const r = dedupe([job({ company: "A", applyUrl: "https://jobs.lever.co/a/1" }), job({ company: "B", applyUrl: "https://jobs.lever.co/b/1" })], []);
    expect(r.fresh).toHaveLength(2);
  });
});
