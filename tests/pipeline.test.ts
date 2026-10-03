// End-to-end Phase 1 run against saved fixtures, an in-memory store and a fake scorer.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runFetch } from "../src/pipeline.js";
import type { AiScore, JobRow, RunLog } from "../src/schema.js";
import type { ScoreResult, Scorer } from "../src/score/scorer.js";
import { LocalStore } from "../src/store/local.js";
import type { Control, Store } from "../src/store/types.js";
import type { HttpGet } from "../src/util/http.js";
import { NOW, cfg, fixture } from "./helpers.js";

/** Serves the saved fixtures by URL; one call per source is enough for these tests. */
const fakeGet: HttpGet = async (url) => {
  if (url.includes("himalayas.app")) return url.includes("offset=0") && url.includes("q=qa%20engineer") ? fixture("himalayas.json") : JSON.stringify({ totalCount: 0, jobs: [] });
  if (url.includes("remoteok.com")) return fixture("remoteok.json");
  if (url.includes("remotive.com")) return url.includes("category=qa") ? fixture("remotive.json") : JSON.stringify({ jobs: [] });
  if (url.includes("weworkremotely.com/remote-jobs.rss")) return fixture("wwr.xml");
  if (url.includes("weworkremotely.com")) return '<?xml version="1.0"?><rss><channel></channel></rss>';
  throw new Error(`unexpected URL ${url}`);
};

class MemoryStore implements Store {
  readonly name = "memory";
  rows: JobRow[] = [];
  runs: RunLog[] = [];
  reads = 0;
  constructor(public control: Control = { killSwitch: "RUN", mode: "dry" }) {}
  async readControl() { return this.control; }
  async readJobs() { this.reads++; return this.rows.map((r) => ({ ...r })); }
  async writeJobs(rows: JobRow[]) { this.rows = rows; }
  async appendRun(run: RunLog) { this.runs.push(run); }
}

const goodAi: AiScore = {
  roleFit: 28, stackMatch: 22, domain: 8, interviewRisk: 9, isTypeB: false,
  locationEligible: "yes", locationEvidence: "", redFlags: [], mustHaveGaps: [], oneLineWhy: "Good fit",
};
class FakeScorer implements Scorer {
  calls = 0;
  constructor(private ai: AiScore | null = goodAi) {}
  async score(): Promise<ScoreResult> {
    this.calls++;
    return { ai: this.ai, error: this.ai ? null : "boom", inputTokens: 2000, outputTokens: 200 };
  }
}

const run = (store: Store, scorer: Scorer | null, get: HttpGet = fakeGet) =>
  runFetch({ cfg, store, get, scorer, now: NOW });

describe("runFetch", () => {
  it("kill switch STOP: exits before fetching, writing or logging anything", async () => {
    const store = new MemoryStore({ killSwitch: "STOP", mode: "dry" });
    const get = vi.fn(fakeGet);
    const scorer = new FakeScorer();
    const r = await run(store, scorer, get);
    expect(r.stopped).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(scorer.calls).toBe(0);
    expect(store.reads).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  it("writes rows with statuses and reasons, plus one heartbeat row", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer());
    expect(store.rows.length).toBeGreaterThan(0);
    expect(store.runs).toHaveLength(1);
    for (const r of store.rows) {
      if (r.status === "filtered_out") expect(r.filter_reasons).not.toBe("");
      if (r.status === "shortlisted") expect(Number(r.score)).toBeGreaterThanOrEqual(70);
    }
    expect(store.rows.some((r) => r.status === "shortlisted")).toBe(true);
    expect(store.rows.some((r) => r.status === "filtered_out")).toBe(true);
  });

  it("running twice creates no duplicate rows and scores nothing twice", async () => {
    const store = new MemoryStore();
    const scorer = new FakeScorer();
    await run(store, scorer);
    const firstCount = store.rows.length;
    const firstCalls = scorer.calls;
    await run(store, scorer);
    expect(store.rows).toHaveLength(firstCount);
    expect(new Set(store.rows.map((r) => r.job_id)).size).toBe(firstCount);
    expect(scorer.calls).toBe(firstCalls);
    expect(store.runs).toHaveLength(2);
    expect(store.runs[1]!.new).toBe(0);
  });

  it("keeps Islam's notes and manual status edits between runs", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer());
    store.rows[0]!.notes = "applied by hand";
    store.rows[0]!.status = "closed";
    await run(store, new FakeScorer());
    expect(store.rows[0]!.notes).toBe("applied by hand");
    expect(store.rows[0]!.status).toBe("closed");
  });

  it("without an API key, passing jobs are 'unscored' and get scored on a later run", async () => {
    const store = new MemoryStore();
    await run(store, null);
    const unscored = store.rows.filter((r) => r.status === "unscored").length;
    expect(unscored).toBeGreaterThan(0);
    const scorer = new FakeScorer();
    await run(store, scorer);
    expect(scorer.calls).toBe(unscored);
    expect(store.rows.filter((r) => r.status === "unscored")).toHaveLength(0);
  });

  it("a failed score is saved as score_error with the reason", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer(null));
    const errs = store.rows.filter((r) => r.status === "score_error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.notes).toBe("boom");
  });

  it("AI saying 'not open to Egypt' drops the job with the reason", async () => {
    const store = new MemoryStore();
    await run(store, new FakeScorer({ ...goodAi, locationEligible: "no", locationEvidence: "US residents only" }));
    expect(store.rows.some((r) => r.filter_reasons.includes("US residents only"))).toBe(true);
    expect(store.rows.some((r) => r.status === "shortlisted")).toBe(false);
  });

  it("respects the per-run scoring cap", async () => {
    const store = new MemoryStore();
    const scorer = new FakeScorer();
    const small = { ...cfg, limits: { ...cfg.limits, maxScoredPerRun: 1 } };
    await runFetch({ cfg: small, store, get: fakeGet, scorer, now: NOW });
    expect(scorer.calls).toBe(1);
    expect(store.rows.some((r) => r.notes.includes("run cap"))).toBe(true);
  });

  it("one source failing does not stop the run; the error is logged", async () => {
    const store = new MemoryStore();
    const broken: HttpGet = async (url) => {
      if (url.includes("remoteok")) throw new Error("HTTP 503");
      return fakeGet(url);
    };
    const r = await run(store, null, broken);
    expect(r.run!.errors).toMatch(/remoteok: HTTP 503/);
    expect(store.rows.length).toBeGreaterThan(0);
  });
});

describe("LocalStore (--local)", () => {
  it("writes jobs.csv, jobs.json and runs.csv, and honours control.json STOP", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "job-pipeline-"));
    const store = new LocalStore(dir);
    await run(store, null);
    expect(readFileSync(path.join(dir, "jobs.csv"), "utf8").split("\n")[0]).toMatch(/^job_id,status,score/);
    expect(readFileSync(path.join(dir, "runs.csv"), "utf8").trim().split("\n")).toHaveLength(2);

    writeFileSync(path.join(dir, "control.json"), JSON.stringify({ killSwitch: "STOP", mode: "dry" }));
    expect((await run(store, null)).stopped).toBe(true);
  });
});
