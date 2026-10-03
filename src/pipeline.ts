// Phase 1 run: kill switch → fetch → normalize → dedupe → hard filters → score → write → heartbeat.
// Nothing in here sends anything.
import type { Config } from "./config.js";
import { dedupe, type KnownJob } from "./dedupe.js";
import { applyHardFilters } from "./filters/hardFilters.js";
import { toJob } from "./normalize/index.js";
import { passesTitlePrefilter } from "./normalize/title.js";
import { combineScore, formatBreakdown, statusForScore } from "./score/deterministic.js";
import { estimateCostUsd, type Scorer } from "./score/scorer.js";
import type { Job, JobRow, RunLog } from "./schema.js";
import { fetchAll } from "./sources/index.js";
import type { Store } from "./store/types.js";
import type { HttpGet } from "./util/http.js";

export interface RunOptions {
  cfg: Config;
  store: Store;
  get: HttpGet;
  /** null = no API key: jobs that pass the filters are saved as "unscored". */
  scorer: Scorer | null;
  now?: Date;
  log?: (msg: string) => void;
}

export interface RunSummary {
  stopped: boolean;
  run: RunLog | null;
  rows: JobRow[];
}

const RESCORE = new Set(["unscored", "score_error"]);

function salaryText(job: Job): string {
  const { salaryMinUsdMonth: lo, salaryMaxUsdMonth: hi } = job;
  if (hi === null) return "";
  return lo !== null && lo !== hi ? `${lo}-${hi}` : String(hi);
}

export function rowFromJob(job: Job, sources: string[], now: Date): JobRow {
  return {
    job_id: job.id,
    status: "new",
    score: "",
    breakdown: "",
    why: "",
    title: job.title,
    company: job.company,
    remote_scope: job.remoteScope,
    location_raw: job.locationRaw,
    salary_usd_month: salaryText(job),
    posted_at: job.postedAt?.slice(0, 10) ?? "",
    sources: [...new Set(sources)].sort().join(", "),
    url: job.url,
    apply_url: job.applyUrl ?? "",
    ats: job.ats,
    apply_email: job.applyEmail ?? "",
    filter_reasons: "",
    red_flags: "",
    first_seen: now.toISOString(),
    last_seen: now.toISOString(),
    notes: "",
  };
}

export async function runFetch(opts: RunOptions): Promise<RunSummary> {
  const { cfg, store, get, scorer } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  // 1. Kill switch first. STOP means do nothing at all.
  const control = await store.readControl();
  if (control.killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting without doing anything.");
    return { stopped: true, run: null, rows: [] };
  }

  // 2. Fetch.
  const fetched = await fetchAll(cfg, get);
  errors.push(...fetched.errors);
  log(`Fetched ${fetched.jobs.length} jobs: ${JSON.stringify(fetched.perSource)}`);

  // 3. Keep QA-ish titles, then normalize.
  const jobs: Job[] = [];
  for (const raw of fetched.jobs) {
    if (!passesTitlePrefilter(raw.title, cfg.targeting)) continue;
    try {
      jobs.push(toJob(raw, cfg, now));
    } catch (err) {
      errors.push(`normalize ${raw.source}/${raw.sourceId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  log(`${jobs.length} QA-related jobs after the title pre-filter`);

  // 4. Dedupe against the store and within this run.
  const existing = await store.readJobs();
  const known: KnownJob[] = existing.map((r) => ({ id: r.job_id, applyUrl: r.apply_url, sources: r.sources.split(", ").filter(Boolean) }));
  const { fresh, seenAgain } = dedupe(jobs, known);
  const existingIds = new Set(existing.map((r) => r.job_id));

  // Jobs saved earlier without a score get another chance when they show up again.
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const retry = existing.filter((r) => RESCORE.has(r.status) && jobsById.has(r.job_id));

  // 5. Hard filters on new jobs.
  const newRows: JobRow[] = [];
  const toScore: { job: Job; row: JobRow }[] = [];
  for (const job of fresh) {
    const row = rowFromJob(job, [job.source, ...(seenAgain.get(job.id) ?? [])], now);
    const f = applyHardFilters(job, cfg.targeting, now);
    if (!f.pass) {
      row.status = "filtered_out";
      row.filter_reasons = f.reasons.join("; ");
    } else {
      toScore.push({ job, row });
    }
    newRows.push(row);
  }
  for (const row of retry) toScore.push({ job: jobsById.get(row.job_id)!, row });
  const afterFilters = toScore.length;
  log(`${fresh.length} new jobs, ${afterFilters} to score after hard filters`);

  // 6. Score with Haiku (or mark unscored when there is no API key).
  let scored = 0;
  let costUsd = 0;
  for (const { job, row } of toScore) {
    if (!scorer) {
      row.status = "unscored";
      continue;
    }
    if (scored >= cfg.limits.maxScoredPerRun || costUsd >= cfg.limits.maxRunCostUsd) {
      row.status = "unscored";
      row.notes = "run cap reached, will score next run";
      continue;
    }
    const res = await scorer.score(job);
    costUsd += estimateCostUsd(cfg.limits.models.score, res.inputTokens, res.outputTokens, cfg);
    if (!res.ai) {
      row.status = "score_error";
      row.notes = res.error ?? "";
      errors.push(`score ${job.id}: ${res.error}`);
      continue;
    }
    scored++;
    const ai = res.ai;
    row.red_flags = ai.redFlags.join("; ");
    row.why = ai.oneLineWhy;
    if (ai.locationEligible === "no") {
      row.status = "filtered_out";
      row.filter_reasons = `ai: location not open to Egypt${ai.locationEvidence ? ` ("${ai.locationEvidence}")` : ""}`;
      continue;
    }
    if (ai.redFlags.length > 0) {
      row.status = "filtered_out";
      row.filter_reasons = `ai: red flags`;
      continue;
    }
    const b = combineScore(job, ai, cfg, now);
    row.score = b.total;
    row.breakdown = formatBreakdown(b) + (ai.mustHaveGaps.length ? ` | gaps: ${ai.mustHaveGaps.join(", ")}` : "")
      + (ai.locationEligible === "unclear" ? " | location unclear" : "");
    row.status = statusForScore(b.total, cfg.scoring);
  }

  // 7. Merge: existing rows (last_seen/sources updated) first, then new rows best-first.
  const nowIso = now.toISOString();
  const merged = existing.map((r) => {
    const again = seenAgain.get(r.job_id);
    if (!again) return r;
    const sources = new Set([...r.sources.split(", ").filter(Boolean), ...again]);
    return { ...r, last_seen: nowIso, sources: [...sources].sort().join(", ") };
  });
  // Rows from `retry` were edited in place; copy their new values into `merged`.
  for (const r of retry) {
    const i = merged.findIndex((m) => m.job_id === r.job_id);
    if (i >= 0) merged[i] = { ...merged[i]!, ...r, last_seen: nowIso, sources: merged[i]!.sources };
  }
  const score = (r: JobRow) => (typeof r.score === "number" ? r.score : -1);
  newRows.sort((a, b) => score(b) - score(a));
  const rows = [...merged, ...newRows.filter((r) => !existingIds.has(r.job_id))];
  await store.writeJobs(rows);

  // 8. Heartbeat: one row per run, so a silent day means something is stuck.
  const run: RunLog = {
    run_id: startedAt.replace(/[^0-9]/g, "").slice(0, 14),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode: control.mode,
    fetched: fetched.jobs.length,
    after_filters: afterFilters,
    new: fresh.length,
    scored,
    shortlisted: rows.filter((r) => r.status === "shortlisted").length,
    errors: errors.join(" | ").slice(0, 2000),
    cost_usd_est: Math.round(costUsd * 1000) / 1000,
  };
  await store.appendRun(run);
  log(`Done. ${run.new} new, ${run.scored} scored, ${run.shortlisted} shortlisted in total, ~$${run.cost_usd_est}`);
  return { stopped: false, run, rows };
}
