import { describe, expect, it } from "vitest";
import {
  applyHardFilters, checkAge, checkLocation, checkRedFlags, checkRejectPhrases, checkRemote,
  checkSalary, checkSeniority, checkTitle,
} from "../src/filters/hardFilters.js";
import { NOW, cfg, daysAgo, job } from "./helpers.js";

const t = cfg.targeting;

describe("hard filters — each one passes a good job and fails a bad one", () => {
  const good = job();

  it("a good job passes everything", () => {
    expect(applyHardFilters(good, t, NOW)).toEqual({ pass: true, reasons: [] });
  });

  it("title", () => {
    expect(checkTitle(good, t)).toBeNull();
    expect(checkTitle(job({ title: "QA Manager" }), t)).toMatch(/^title:/);
  });

  it("location scope", () => {
    expect(checkLocation(good)).toBeNull();
    expect(checkLocation(job({ locationText: "USA" }))).toMatch(/^location:/);
  });

  it("location reject phrases in the description", () => {
    expect(checkRejectPhrases(good, t)).toBeNull();
    expect(checkRejectPhrases(job({ descriptionHtml: "<p>You must be authorized to work in the US.</p>" }), t)).toMatch(/authorized to work in/);
  });

  it("salary floor (monthly and hourly); not stated is fine", () => {
    expect(checkSalary(good, t)).toBeNull();
    expect(checkSalary(job({ salaryText: "$3,000/month" }), t)).toBeNull();
    expect(checkSalary(job({ salaryText: "$1,500/month" }), t)).toMatch(/^salary:/);
    expect(checkSalary(job({ salaryText: "$13/hour" }), t)).toBeNull();
    expect(checkSalary(job({ salaryText: "$10/hour" }), t)).toMatch(/USD\/hour/);
    expect(checkSalary(job({ salaryText: "$20k/year" }), t)).toMatch(/^salary:/);
  });

  it("seniority: senior title with too many years", () => {
    expect(checkSeniority(job({ title: "Senior QA Engineer", descriptionHtml: "5+ years" }), t)).toBeNull();
    expect(checkSeniority(job({ title: "Senior QA Engineer", descriptionHtml: "7+ years required" }), t)).toMatch(/^seniority:/);
    // Non-senior titles are judged by the AI scorer, not dropped here.
    expect(checkSeniority(job({ title: "QA Engineer", descriptionHtml: "8+ years" }), t)).toBeNull();
  });

  it("red flags", () => {
    expect(checkRedFlags(good, t)).toBeNull();
    expect(checkRedFlags(job({ descriptionHtml: "Pay a training fee of $50. Contact us on Telegram." }), t)).toMatch(/^red flag:/);
  });

  it("not remote (location says hybrid/on-site, or title says on-site)", () => {
    expect(checkRemote(good, t)).toBeNull();
    expect(checkRemote(job({ locationText: "Hybrid - Cairo" }), t)).toMatch(/^not remote/);
    expect(checkRemote(job({ title: "QA Engineer (On-site)" }), t)).toMatch(/^not remote/);
    // "Hybrid QA" means manual + automation, not hybrid work.
    expect(checkRemote(job({ title: "Hybrid QA Engineer" }), t)).toBeNull();
  });

  it("age", () => {
    expect(checkAge(good, t, NOW)).toBeNull();
    expect(checkAge(job({ postedAt: daysAgo(45) }), t, NOW)).toMatch(/^too old/);
    expect(checkAge(job({ postedAt: null }), t, NOW)).toBeNull();
  });

  it("collects every reason, without duplicates", () => {
    const bad = job({ title: "QA Manager", locationText: "USA", postedAt: daysAgo(60) });
    const r = applyHardFilters(bad, t, NOW);
    expect(r.pass).toBe(false);
    expect(r.reasons).toHaveLength(3);
  });
});
