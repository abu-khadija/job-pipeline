// Built In adapter, from pages saved once (tests/fixtures/builtin-*.html).
import { describe, expect, it } from "vitest";
import { toJob } from "../src/normalize/index.js";
import { parseBuiltinJob, parseBuiltinList } from "../src/sources/builtin.js";
import { NOW, cfg, fixture } from "./helpers.js";

describe("Built In", () => {
  it("finds job links on the Egypt QA listing page", () => {
    const links = parseBuiltinList(fixture("builtin-list.html"));
    expect(links.length).toBeGreaterThanOrEqual(5);
    expect(links.every((l) => /^https:\/\/builtin\.com\/job\/[a-z0-9-]+\/\d+$/.test(l))).toBe(true);
  });
  it("reads the JobPosting data, with Egypt as the stated country", () => {
    const raw = parseBuiltinJob(fixture("builtin-job.html"), "https://builtin.com/job/senior-automation-test-engineer/9639363")!;
    expect(raw).toMatchObject({ source: "builtin", title: "Senior Automation Test Engineer", company: "Trimetis AG", places: ["Egypt"] });
    const job = toJob(raw, cfg, NOW);
    expect(job.remoteScope).toBe("egypt");
  });
  it("returns null for a page without job data", () => {
    expect(parseBuiltinJob("<html></html>", "https://builtin.com/job/x/1")).toBeNull();
  });
});
