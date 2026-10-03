// Shared test setup: the real config files, a fixed "now", and a quick Job builder.
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { toJob, type RawJob } from "../src/normalize/index.js";
import type { Job } from "../src/schema.js";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const cfg = loadConfig(path.join(ROOT, "config"));
export const NOW = new Date("2026-10-02T12:00:00Z");

export function fixture(name: string): string {
  return readFileSync(path.join(ROOT, "tests", "fixtures", name), "utf8");
}

export function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

export function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: "test",
    sourceId: "1",
    url: "https://example.com/jobs/1",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    title: "QA Automation Engineer",
    company: "Acme",
    locationText: "Worldwide",
    postedAt: daysAgo(2),
    descriptionHtml: "<p>We use Playwright and TypeScript. 3+ years of experience.</p>",
    ...overrides,
  };
}

export function job(overrides: Partial<RawJob> = {}, jobOverrides: Partial<Job> = {}): Job {
  return { ...toJob(raw(overrides), cfg, NOW), ...jobOverrides };
}
