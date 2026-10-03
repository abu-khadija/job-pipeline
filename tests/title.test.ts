import { describe, expect, it } from "vitest";
import { passesTitlePrefilter, seniorityOf, titlePriority, yearsRequired } from "../src/normalize/title.js";
import { cfg } from "./helpers.js";

const t = cfg.targeting;

describe("titlePriority", () => {
  it.each([
    ["AI QA Engineer", "p1"],
    ["Senior AI-First QA Engineer", "p1"],
    ["QA Engineer (AI)", "p1"],
    ["Agentic QA Engineer", "p1"],
    ["QA Automation Engineer", "p2"],
    ["Test Automation Engineer - Playwright", "p2"],
    ["Software Development Engineer in Test", "p2"],
    ["SDET II", "p2"],
    ["Quality Assurance Engineer", "p2"],
    ["LLM QA Engineer", "p2"],
    ["QA Analyst", "p3"],
    ["Mobile QA Engineer", "p2"], // "qa engineer" (P2) beats "mobile qa engineer" (P3): best priority wins
    ["Software Tester", "p3"],
    ["QA Lead", "skip"],
    ["Lead QA Engineer", "skip"],
    ["QA Manager", "skip"],
    ["Head of QA", "skip"],
    ["Principal SDET", "skip"],
    ["Staff SDET", "skip"],
    ["Tech Lead - QA - Performance Testing", "skip"],
    ["Machine Learning Engineer", "skip"],
    ["Data Labeler (Arabic)", "skip"],
    ["Frontend Developer", "unknown"],
  ])("%s → %s", (title, p) => expect(titlePriority(title, t)).toBe(p));
});

describe("passesTitlePrefilter", () => {
  it.each(["QA Engineer", "Quality Engineer", "Software Tester", "Testing Analyst", "SDET", "Playwright Engineer"])(
    "keeps %s",
    (title) => expect(passesTitlePrefilter(title, t)).toBe(true),
  );
  it.each(["Frontend Developer", "Account Executive", "Contest Manager", "Chief Actuary"])(
    "drops %s",
    (title) => expect(passesTitlePrefilter(title, t)).toBe(false),
  );
});

describe("seniorityOf", () => {
  it.each([
    ["Senior QA Engineer", "senior"],
    ["Sr. QA Engineer", "senior"],
    ["Lead QA", "lead"],
    ["Staff Engineer", "lead"],
    ["Junior Tester", "junior"],
    ["Mid-level QA", "mid"],
    ["QA Engineer", "unknown"],
  ])("%s → %s", (title, s) => expect(seniorityOf(title)).toBe(s));
});

describe("yearsRequired", () => {
  it.each([
    ["3+ years of experience", 3],
    ["at least 5 years in QA", 5],
    ["3-5 years of experience", 3],
    ["7+ yrs with Selenium, 2 years with Playwright", 7],
    ["No experience needed", null],
    ["Founded 100 years ago", null],
  ])("%s → %s", (text, n) => expect(yearsRequired(text)).toBe(n));
});
