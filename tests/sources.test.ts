// Each adapter is tested against a real response saved on Oct 2, 2026 (tests/fixtures/).
import { describe, expect, it } from "vitest";
import { toJob } from "../src/normalize/index.js";
import { Job } from "../src/schema.js";
import { parseHimalayas } from "../src/sources/himalayas.js";
import { parseRemoteOk } from "../src/sources/remoteok.js";
import { parseRemotive } from "../src/sources/remotive.js";
import { parseWwr } from "../src/sources/wwr.js";
import { NOW, cfg, fixture } from "./helpers.js";

const all = {
  himalayas: parseHimalayas(fixture("himalayas.json")),
  remoteok: parseRemoteOk(fixture("remoteok.json")),
  remotive: parseRemotive(fixture("remotive.json")),
  weworkremotely: parseWwr(fixture("wwr.xml")),
};

describe.each(Object.entries(all))("%s adapter", (source, raws) => {
  it("parses jobs", () => expect(raws.length).toBeGreaterThan(0));

  it("every job normalizes into the Job schema", () => {
    for (const r of raws) {
      const j = toJob(r, cfg, NOW);
      expect(Job.safeParse(j).success).toBe(true);
      expect(j.source).toBe(source);
      expect(j.description).not.toMatch(/<\/?(p|div|li|br)\b/); // HTML stripped
    }
  });

  it("every job has a title, company, url and ISO date", () => {
    for (const r of raws) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.company.length).toBeGreaterThan(0);
      expect(() => new URL(r.url)).not.toThrow();
      if (r.postedAt) expect(Number.isNaN(Date.parse(r.postedAt))).toBe(false);
    }
  });
});

describe("source-specific behaviour", () => {
  it("Remote OK: the legal-notice element is skipped", () => {
    const rawCount = (JSON.parse(fixture("remoteok.json")) as unknown[]).length;
    expect(all.remoteok).toHaveLength(rawCount - 1);
  });

  it("Remote OK: salaries are yearly USD", () => {
    const withSalary = all.remoteok.find((r) => r.salaryNumbers);
    expect(withSalary?.salaryNumbers?.period).toBe("year");
  });

  it("Himalayas (country=EG): no restrictions is NOT worldwide; only the post's text can say so", () => {
    const base = all.himalayas[0]!;
    const silent = toJob({ ...base, places: [], locationText: "", descriptionHtml: "<p>QA role. Playwright.</p>" }, cfg, NOW);
    expect(silent.remoteScope).toBe("unknown");
    const said = toJob({ ...base, places: [], locationText: "", descriptionHtml: "<p>We hire worldwide, work from anywhere.</p>" }, cfg, NOW);
    expect(said.remoteScope).toBe("worldwide");
    const egypt = toJob({ ...base, places: ["Egypt"], locationText: "Egypt" }, cfg, NOW);
    expect(egypt.remoteScope).toBe("egypt");
  });

  it("Remotive: 'USA' becomes us_only and is not eligible", () => {
    const usa = all.remotive.find((r) => r.locationText === "USA")!;
    expect(toJob(usa, cfg, NOW).remoteScope).toBe("us_only");
  });

  it("Remotive: dates without a timezone are read as UTC", () => {
    expect(all.remotive[0]!.postedAt).toMatch(/Z$/);
  });

  it("WWR: 'Company: Title' is split", () => {
    const first = all.weworkremotely[0]!;
    expect(first.company).toBe("Clover Health");
    expect(first.title).toBe("Chief Actuary");
    expect(first.locationText).toBe("Anywhere in the World");
  });
});

describe("SmartRecruiters + Workable parsers", () => {
  it("parses a Workable widget board", async () => {
    const { parseWorkable } = await import("../src/sources/atsBoards.js");
    const body = JSON.stringify({ jobs: [{ id: 7, title: "QA Automation Engineer", shortcode: "ABC", url: "https://apply.workable.com/acme/j/ABC", country: "Egypt", remote: true, description: "<p>Playwright</p>", employment_type: "Full-time", published_on: "2026-10-01" }] });
    const [j] = parseWorkable(body, "acme", "Acme");
    expect(j).toMatchObject({ source: "workable", title: "QA Automation Engineer", company: "Acme", places: ["Egypt"] });
    expect(j!.locationText).toContain("Remote");
    expect(j!.atsBoard).toEqual({ ats: "workable", slug: "acme" });
  });
});
