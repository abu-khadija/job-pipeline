// Greenhouse / Lever / Ashby adapters (real responses saved Oct 2, 2026), board discovery and the watchlist.
import { describe, expect, it, vi } from "vitest";
import { findAtsBoard } from "../src/normalize/ats.js";
import { toJob } from "../src/normalize/index.js";
import { Job, type WatchRow } from "../src/schema.js";
import { boardUrl, parseAshby, parseGreenhouse, parseLever, probeCompany, slugCandidates } from "../src/sources/atsBoards.js";
import type { HttpGet } from "../src/util/http.js";
import { activeBoards, updateWatchlist, withSeeds } from "../src/watchlist.js";
import { NOW, cfg, fixture, job } from "./helpers.js";

describe.each([
  ["greenhouse", () => parseGreenhouse(fixture("greenhouse.json"), "gitlab")],
  ["lever", () => parseLever(fixture("lever.json"), "spotify", "Spotify")],
  ["ashby", () => parseAshby(fixture("ashby.json"), "ramp", "Ramp")],
])("%s adapter", (ats, parse) => {
  const raws = parse();
  it("parses jobs that normalize into the Job schema", () => {
    expect(raws.length).toBeGreaterThan(0);
    for (const r of raws) {
      const j = toJob(r, cfg, NOW);
      expect(Job.safeParse(j).success).toBe(true);
      expect(j.atsBoard?.ats).toBe(ats);
      expect(j.description).not.toMatch(/&lt;|<\/?(p|div|li)\b/);
    }
  });
});

describe("adapter details", () => {
  it("Greenhouse: escaped HTML is decoded and company name comes from the board", () => {
    const [first] = parseGreenhouse(fixture("greenhouse.json"), "gitlab");
    expect(first!.descriptionHtml).not.toContain("&lt;");
    expect(first!.company.toLowerCase()).toContain("gitlab");
  });
  it("Lever: hybrid/on-site roles carry the workplace type into the location text", () => {
    const hybrid = parseLever(fixture("lever.json"), "spotify").find((r) => /^hybrid - /i.test(r.locationText));
    expect(hybrid).toBeDefined();
    expect(toJob(hybrid!, cfg, NOW).locationRaw).toMatch(/hybrid/i);
  });
  it("Ashby: unlisted jobs are skipped", () => {
    const body = JSON.stringify({ jobs: [{ id: "1", title: "QA", jobUrl: "https://jobs.ashbyhq.com/x/1", isListed: false }] });
    expect(parseAshby(body, "x")).toHaveLength(0);
  });
  it("builds API URLs from the config", () => {
    expect(boardUrl(cfg, { ats: "lever", slug: "spotify" })).toBe("https://api.lever.co/v0/postings/spotify?mode=json");
  });
});

describe("findAtsBoard", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/123", { ats: "greenhouse", slug: "acme" }],
    ["https://job-boards.greenhouse.io/acme/jobs/123", { ats: "greenhouse", slug: "acme" }],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/1", { ats: "greenhouse", slug: "acme" }],
    ["<a href=\"https://boards.greenhouse.io/embed/job_board?for=acme\">", { ats: "greenhouse", slug: "acme" }],
    ["https://jobs.lever.co/acme-labs/abc-123/apply", { ats: "lever", slug: "acme-labs" }],
    ["Apply: https://jobs.ashbyhq.com/Acme/uuid/application", { ats: "ashby", slug: "acme" }],
  ])("%s", (text, expected) => expect(findAtsBoard(text)).toEqual(expected));
  it.each([null, "", "https://example.com/careers", "https://remoteok.com/remote-jobs/123"])("none in %j", (t) =>
    expect(findAtsBoard(t)).toBeNull());
  it("is picked up from links inside a job post", () => {
    const j = job({ applyUrl: "https://remoteok.com/remote-jobs/1", descriptionHtml: '<p>Apply at <a href="https://jobs.lever.co/acme/1">Lever</a></p>' });
    expect(j.atsBoard).toEqual({ ats: "lever", slug: "acme" });
  });
});

describe("slugCandidates / probeCompany", () => {
  it("makes joined and hyphenated slugs without company suffixes", () => {
    expect(slugCandidates("Acme Labs Inc.")).toEqual(["acmelabs", "acme-labs"]);
    expect(slugCandidates("Halborn")).toEqual(["halborn"]);
    expect(slugCandidates("X")).toEqual([]);
  });

  const getFrom = (boards: Record<string, string>): HttpGet => async (url) => {
    const hit = Object.entries(boards).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`HTTP 404 for ${url}`);
    return hit[1];
  };

  it("finds a Lever board when the slug equals the company name", async () => {
    const get = getFrom({ "api.lever.co/v0/postings/halborn": "[]" });
    expect(await probeCompany(cfg, get, "Halborn")).toEqual({ ats: "lever", slug: "halborn" });
  });
  it("Greenhouse must also match the company name on the board", async () => {
    const other = JSON.stringify({ jobs: [{ id: 1, title: "x", absolute_url: "https://x", company_name: "General Assembly" }] });
    const same = JSON.stringify({ jobs: [{ id: 1, title: "x", absolute_url: "https://x", company_name: "Remote Inc" }] });
    expect(await probeCompany(cfg, getFrom({ "boards/remote/": other }), "Remote")).toBeNull();
    expect(await probeCompany(cfg, getFrom({ "boards/remote/": same }), "Remote")).toEqual({ ats: "greenhouse", slug: "remote" });
  });
  it("returns null when every lookup is a 404", async () => {
    expect(await probeCompany(cfg, getFrom({}), "Nobody Here")).toBeNull();
  });
});

describe("watchlist", () => {
  const row = (over: Partial<WatchRow>): WatchRow => ({ company: "A", ats: "lever", slug: "a", added_at: "", reason: "", active: "yes", last_checked: "", ...over });

  it("adds seeds from the config once", () => {
    const c = { ...cfg, sources: { ...cfg.sources, ats: { ...cfg.sources.ats, seeds: [{ ats: "ashby" as const, slug: "ramp", company: "Ramp" }] } } };
    const once = withSeeds([], c, "now");
    expect(once).toHaveLength(1);
    expect(withSeeds(once, c, "now")).toHaveLength(1);
  });

  it("polls only active rows with a real ATS", () => {
    const boards = activeBoards([row({}), row({ slug: "b", active: "no" }), row({ ats: "none", slug: "" })]);
    expect(boards).toEqual([{ board: { ats: "lever", slug: "a" }, company: "A" }]);
  });

  it("adds a board straight from an eligible job, without a lookup", async () => {
    const probe = vi.fn(async () => null);
    const j = job({ company: "Acme", applyUrl: "https://jobs.lever.co/acme/1", locationText: "Worldwide" });
    const w = await updateWatchlist([], [j], cfg, async () => "", "now", probe);
    expect(w.added).toEqual([expect.objectContaining({ ats: "lever", slug: "acme", active: "yes" })]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("ignores companies whose jobs are not open to Egypt", async () => {
    const probe = vi.fn(async () => null);
    const j = job({ company: "UsOnly", locationText: "USA", applyUrl: "https://jobs.lever.co/usonly/1" });
    const w = await updateWatchlist([], [j], cfg, async () => "", "now", probe);
    expect(w.rows).toHaveLength(0);
    expect(probe).not.toHaveBeenCalled();
  });

  it("looks up at most N new companies per run and remembers misses", async () => {
    const jobs = Array.from({ length: 30 }, (_, i) => job({ company: `Company ${i}`, applyUrl: `https://example.com/${i}` }));
    const probe = vi.fn(async () => null);
    const w = await updateWatchlist([], jobs, cfg, async () => "", "now", probe);
    expect(probe).toHaveBeenCalledTimes(cfg.sources.ats.maxNewCompanyLookupsPerRun);
    expect(w.rows.every((r) => r.ats === "none" && r.active === "no")).toBe(true);
    expect(w.added).toHaveLength(0);
  });
});
