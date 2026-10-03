// End-to-end runs against saved fixtures, an in-memory store and a fake scorer.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runFetch, type RunOptions } from "../src/pipeline.js";
import type { AiScore, Job, WatchRow } from "../src/schema.js";
import type { ScoreResult, Scorer } from "../src/score/scorer.js";
import { LocalStore } from "../src/store/local.js";
import type { Control, Store, TabName, TabRows } from "../src/store/types.js";
import type { HttpGet } from "../src/util/http.js";
import { NOW, cfg, fixture, goodAi } from "./helpers.js";

/** Serves the saved fixtures by URL. */
const fakeGet: HttpGet = async (url) => {
  if (url.includes("himalayas.app")) return url.includes("offset=0") && url.includes("q=qa%20engineer") ? fixture("himalayas.json") : JSON.stringify({ totalCount: 0, jobs: [] });
  if (url.includes("remoteok.com")) return fixture("remoteok.json");
  if (url.includes("remotive.com")) return url.includes("category=qa") ? fixture("remotive.json") : JSON.stringify({ jobs: [] });
  if (url.includes("weworkremotely.com/remote-jobs.rss")) return fixture("wwr.xml");
  if (url.includes("weworkremotely.com")) return '<?xml version="1.0"?><rss><channel></channel></rss>';
  if (url.includes("api.lever.co/v0/postings/spotify")) return fixture("lever.json");
  if (url.includes("boards-api.greenhouse.io/v1/boards/gitlab")) return fixture("greenhouse.json");
  if (url.includes("api.ashbyhq.com/posting-api/job-board/ramp")) return fixture("ashby.json");
  throw new Error(`HTTP 404 for ${url}`);
};

class MemoryStore implements Store {
  readonly name = "memory";
  tables: { [T in TabName]: TabRows[T][] } = { Jobs: [], Filtered: [], Referrals: [], Watchlist: [], Runs: [], Exceptions: [] };
  private raw = this.tables as unknown as Record<TabName, object[]>;
  reads = 0;
  constructor(public control: Control = { killSwitch: "RUN", mode: "dry" }) {}
  async readControl() { return this.control; }
  async readTable<T extends TabName>(tab: T) { this.reads++; return this.raw[tab].map((r) => ({ ...r })) as TabRows[T][]; }
  async writeTable<T extends TabName>(tab: T, rows: TabRows[T][]) { this.raw[tab] = rows as object[]; }
  async appendRows<T extends TabName>(tab: T, rows: TabRows[T][]) { this.raw[tab] = [...this.raw[tab], ...(rows as object[])]; }
  get allJobs() { return [...this.tables.Jobs, ...this.tables.Filtered]; }
}

class FakeScorer implements Scorer {
  calls = 0;
  constructor(private ai: AiScore | null | ((j: Job) => AiScore | null) = goodAi) {}
  async scoreMany(jobs: Job[]): Promise<Map<string, ScoreResult>> {
    const out = new Map<string, ScoreResult>();
    for (const j of jobs) {
      this.calls++;
      const ai = typeof this.ai === "function" ? this.ai(j) : this.ai;
      out.set(j.id, { ai, error: ai ? null : "boom", usage: { input: 1000, output: 200, cacheRead: 4500, cacheWrite: 0 }, batch: false });
    }
    return out;
  }
}

const noProbe = async () => null;
const run = (store: Store, scorer: Scorer | null, extra: Partial<RunOptions> = {}) =>
  runFetch({ cfg, store, get: fakeGet, scorer, now: NOW, kind: "boards", liveness: async () => "live", probe: noProbe, ...extra });

describe("runFetch — boards", () => {
  it("kill switch STOP: exits before fetching, reading, writing or logging anything", async () => {
    const store = new MemoryStore({ killSwitch: "STOP", mode: "dry" });
    const get = vi.fn(fakeGet);
    const scorer = new FakeScorer();
    const r = await run(store, scorer, { get });
    expect(r.stopped).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(scorer.calls).toBe(0);
    expect(store.reads).toBe(0);
    expect(store.tables.Runs).toHaveLength(0);
  });

  it("splits rows: dropped jobs go to Filtered, the rest to Jobs; one heartbeat row", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer());
    expect(store.tables.Jobs.length).toBeGreaterThan(0);
    expect(store.tables.Filtered.length).toBeGreaterThan(0);
    expect(store.tables.Jobs.every((r) => r.status !== "filtered_out")).toBe(true);
    expect(store.tables.Filtered.every((r) => r.status === "filtered_out" && r.filter_reasons !== "")).toBe(true);
    expect(store.tables.Jobs.some((r) => r.status === "shortlisted" && r.score_band !== "")).toBe(true);
    expect(store.tables.Runs).toHaveLength(1);
    expect(store.tables.Runs[0]!.cache_read_tokens).toBeGreaterThan(0);
  });

  it("running twice creates no duplicate rows and scores nothing twice", async () => {
    const store = new MemoryStore();
    const scorer = new FakeScorer();
    await run(store, scorer);
    const count = store.allJobs.length;
    const calls = scorer.calls;
    await run(store, scorer);
    expect(store.allJobs).toHaveLength(count);
    expect(new Set(store.allJobs.map((r) => r.job_id)).size).toBe(count);
    expect(scorer.calls).toBe(calls);
    expect(store.tables.Runs[1]!.new).toBe(0);
  });

  it("keeps Islam's notes and manual status edits between runs", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer());
    store.tables.Jobs[0]!.notes = "applied by hand";
    store.tables.Jobs[0]!.status = "closed";
    const id = store.tables.Jobs[0]!.job_id;
    await run(store, new FakeScorer());
    const row = store.tables.Jobs.find((r) => r.job_id === id)!;
    expect(row.notes).toBe("applied by hand");
    expect(row.status).toBe("closed");
  });

  it("without an API key, passing jobs are 'unscored' and get scored on a later run", async () => {
    const store = new MemoryStore();
    await run(store, null);
    const unscored = store.tables.Jobs.filter((r) => r.status === "unscored").length;
    expect(unscored).toBeGreaterThan(0);
    const scorer = new FakeScorer();
    await run(store, scorer);
    expect(scorer.calls).toBe(unscored);
    expect(store.allJobs.filter((r) => r.status === "unscored")).toHaveLength(0);
  });

  it("a failed score is saved as score_error with the reason", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer(null));
    const errs = store.tables.Jobs.filter((r) => r.status === "score_error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.notes).toBe("boom");
  });

  it("AI 'not open to Egypt' and 'cannot pay in Egypt' drop the job with the reason", async () => {
    const store = new MemoryStore();
    let n = 0;
    await run(store, new FakeScorer(() => (n++ % 2 === 0
      ? { ...goodAi, locationEligible: "no", locationEvidence: "US residents only" }
      : { ...goodAi, payrollRestriction: "excludes_egypt" })));
    expect(store.tables.Filtered.some((r) => r.filter_reasons.includes("US residents only"))).toBe(true);
    expect(store.tables.Filtered.some((r) => r.filter_reasons.includes("cannot pay or employ people in Egypt"))).toBe(true);
    expect(store.tables.Jobs.some((r) => r.status === "shortlisted")).toBe(false);
  });

  it("timezone and contractor notes end up in the breakdown", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer({ ...goodAi, timezoneOverlap: "partial", timezoneNote: "4h overlap with EST", payrollRestriction: "contractor_only" }));
    const r = store.tables.Jobs.find((x) => x.breakdown.includes("hours: 4h overlap with EST"));
    expect(r?.breakdown).toContain("contractor only");
    expect(r?.breakdown).toContain("tz 6");
  });

  it("respects the per-run scoring cap and scores the freshest jobs first", async () => {
    const store = new MemoryStore();
    const seen: Job[] = [];
    const scorer: Scorer = { scoreMany: async (jobs) => { seen.push(...jobs); return new FakeScorer().scoreMany(jobs); } };
    const small = { ...cfg, limits: { ...cfg.limits, maxScoredPerRun: 2 } };
    await runFetch({ cfg: small, store, get: fakeGet, scorer, now: NOW, kind: "boards", liveness: async () => "live", probe: noProbe });
    expect(seen).toHaveLength(2);
    const notScored = store.tables.Jobs.filter((r) => r.status === "unscored");
    expect(notScored.length).toBeGreaterThan(0);
    const newestUnscored = Math.max(...notScored.map((r) => Date.parse(r.posted_at)));
    for (const j of seen) expect(Date.parse(j.postedAt!.slice(0, 10))).toBeGreaterThanOrEqual(newestUnscored);
  });

  it("marks a shortlisted job closed when its listing is gone", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer(), { liveness: async () => "gone" });
    expect(store.tables.Jobs.some((r) => r.status === "closed" && r.notes.includes("listing gone"))).toBe(true);
    expect(store.tables.Jobs.some((r) => r.status === "shortlisted")).toBe(false);
  });

  it("strong jobs (80+) become referral targets, once", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer());
    const refs = store.tables.Referrals;
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => Number(r.score) >= cfg.scoring.referralMinScore && r.status === "todo")).toBe(true);
    expect(refs[0]!.linkedin_people_search).toMatch(/^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=/);
    await run(store, new FakeScorer());
    expect(store.tables.Referrals).toHaveLength(refs.length);
  });

  it("companies with Egypt-eligible jobs are looked up and added to the watchlist", async () => {
    const store = new MemoryStore();
    const probe = vi.fn(async (_c: unknown, _g: unknown, company: string) => (company === "Halborn" ? { ats: "lever" as const, slug: "halborn" } : null));
    await run(store, new FakeScorer(), { probe });
    const w = store.tables.Watchlist;
    expect(w.some((r) => r.slug === "halborn" && r.ats === "lever" && r.active === "yes")).toBe(true);
    expect(w.some((r) => r.ats === "none" && r.active === "no")).toBe(true); // remembered, not looked up again
    expect(probe.mock.calls.length).toBeLessThanOrEqual(cfg.sources.ats.maxNewCompanyLookupsPerRun);
    const calls = probe.mock.calls.length;
    await run(store, new FakeScorer(), { probe });
    expect(probe.mock.calls.length).toBe(calls);
  });

  it("one source failing does not stop the run; the error is logged", async () => {
    const store = new MemoryStore();
    const broken: HttpGet = async (url) => {
      if (url.includes("remoteok")) throw new Error("HTTP 503");
      return fakeGet(url);
    };
    const r = await run(store, null, { get: broken });
    expect(r.run!.errors).toMatch(/remoteok: HTTP 503/);
    expect(store.allJobs.length).toBeGreaterThan(0);
  });

  it("returns a digest with the heartbeat line", async () => {
    const r = await run(new MemoryStore(), new FakeScorer());
    expect(r.digest).toMatch(/^Job pipeline · /);
    expect(r.digest).toMatch(/New \d+ · scored \d+/);
  });
});

describe("runFetch — ATS watchlist", () => {
  const watch = (ats: string, slug: string, company: string, active = "yes"): WatchRow =>
    ({ company, ats, slug, added_at: "", reason: "test", active, last_checked: "" });

  it("polls only active boards and does not touch the job boards", async () => {
    const store = new MemoryStore();
    store.tables.Watchlist = [watch("lever", "spotify", "Spotify"), watch("ashby", "ramp", "Ramp", "no"), watch("none", "", "NoBoard Inc", "no")];
    const get = vi.fn(fakeGet);
    await run(store, new FakeScorer(), { kind: "ats", get });
    const urls = get.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("api.lever.co/v0/postings/spotify"))).toBe(true);
    expect(urls.some((u) => u.includes("ashbyhq"))).toBe(false);
    expect(urls.some((u) => u.includes("himalayas") || u.includes("remoteok"))).toBe(false);
    expect(store.allJobs.some((r) => r.sources.includes("lever"))).toBe(true);
    expect(store.tables.Watchlist.find((w) => w.slug === "spotify")!.last_checked).not.toBe("");
  });

  it("a broken board is logged and the run continues", async () => {
    const store = new MemoryStore();
    store.tables.Watchlist = [watch("greenhouse", "doesnotexist", "Nope"), watch("lever", "spotify", "Spotify")];
    const r = await run(store, new FakeScorer(), { kind: "ats" });
    expect(r.run!.errors).toMatch(/greenhouse\/doesnotexist/);
    expect(store.allJobs.length).toBeGreaterThan(0);
  });
});

describe("LocalStore (--local)", () => {
  it("writes one json + csv per tab, and honours control.json STOP", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "job-pipeline-"));
    const store = new LocalStore(dir);
    await run(store, null);
    expect(readFileSync(path.join(dir, "Jobs.csv"), "utf8").split("\n")[0]).toMatch(/^job_id,status,score/);
    expect(readFileSync(path.join(dir, "Filtered.csv"), "utf8").split("\n").length).toBeGreaterThan(2);
    expect(JSON.parse(readFileSync(path.join(dir, "Runs.json"), "utf8"))).toHaveLength(1);
    writeFileSync(path.join(dir, "control.json"), JSON.stringify({ killSwitch: "STOP", mode: "dry" }));
    expect((await run(store, null)).stopped).toBe(true);
  });
});
