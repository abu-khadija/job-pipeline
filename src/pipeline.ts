// One run: kill switch → fetch → normalize → dedupe → hard filters → score → watchlist →
// referrals → link check → write tabs → heartbeat → digest. Nothing in here sends applications.
//
// Two kinds of run (see .github/workflows):
//   "boards": job boards (Himalayas, Remote OK, Remotive, WWR), twice a day, Batch API scoring.
//   "ats":    companies' own Greenhouse/Lever/Ashby boards from the watchlist, every 3 hours,
//             real-time scoring, so a new post is seen within hours (the first 48h matter most).
import type { Config } from "./config.js";
import { dedupe, type KnownJob } from "./dedupe.js";
import { buildDigest } from "./digest.js";
import { applyHardFilters } from "./filters/hardFilters.js";
import { checkLive, type Liveness } from "./liveness.js";
import { detectAts } from "./normalize/ats.js";
import { toJob, type RawJob } from "./normalize/index.js";
import { eligibilityOf } from "./normalize/location.js";
import { passesTitlePrefilter } from "./normalize/title.js";
import { combineScore, formatBreakdown, scoreBand, statusForScore } from "./score/deterministic.js";
import { addUsage, emptyUsage, estimateCostUsd, pool, type Scorer } from "./score/scorer.js";
import type { Job, JobRow, ReferralRow, RunLog, WatchRow } from "./schema.js";
import { fetchBoard } from "./sources/atsBoards.js";
import { fetchAll } from "./sources/index.js";
import type { Store } from "./store/types.js";
import type { HttpGet } from "./util/http.js";
import { verifyJob, type Verdict } from "./verify/index.js";
import { activeBoards, updateWatchlist, withSeeds } from "./watchlist.js";

export type RunKind = "boards" | "ats" | "all";

export interface RunOptions {
  cfg: Config;
  store: Store;
  get: HttpGet;
  /** null = no API key: jobs that pass the filters are saved as "unscored". */
  scorer: Scorer | null;
  kind?: RunKind;
  now?: Date;
  log?: (msg: string) => void;
  /** Injected in tests; defaults to a real HEAD/GET check. */
  liveness?: (url: string) => Promise<Liveness>;
  /** Injected in tests; defaults to the real Greenhouse/Lever/Ashby lookup. */
  probe?: Parameters<typeof updateWatchlist>[5];
  /** Injected in tests; defaults to checking the job on the company's own careers site. */
  verify?: (company: string, title: string) => Promise<Verdict>;
}

export interface RunSummary {
  stopped: boolean;
  run: RunLog | null;
  rows: JobRow[];
  newRows: JobRow[];
  digest: string;
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
    segment: job.segment,
    score_band: "",
    cv_variant: "",
    filter_reasons: "",
    red_flags: "",
    first_seen: now.toISOString(),
    last_seen: now.toISOString(),
    notes: "",
  };
}

export function linkedinPeopleSearch(company: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} Egypt`)}`;
}

/** Freshest first, so caps and timeouts never cost us the newest posts. */
function byFreshness(a: Job, b: Job): number {
  return (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0);
}

export async function fetchAtsBoards(cfg: Config, get: HttpGet, watch: WatchRow[], nowIso: string, errors: string[]): Promise<RawJob[]> {
  const boards = activeBoards(watch);
  const out: RawJob[] = [];
  await pool(boards, cfg.limits.scoring.concurrency, async ({ board, company }) => {
    try {
      out.push(...(await fetchBoard(cfg, get, board, company)));
      const row = watch.find((w) => w.ats === board.ats && w.slug === board.slug);
      if (row) row.last_checked = nowIso;
    } catch (err) {
      errors.push(`${board.ats}/${board.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return out;
}

export async function runFetch(opts: RunOptions): Promise<RunSummary> {
  const { cfg, store, get, scorer } = opts;
  const kind = opts.kind ?? "all";
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const log = opts.log ?? (() => {});
  const liveness = opts.liveness ?? ((url: string) => checkLive(url, cfg.sources.userAgent));
  const verify = opts.verify ?? ((company: string, title: string) => verifyJob(get, company, title, cfg.targeting));
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  // 1. Kill switch first. STOP means do nothing at all.
  const control = await store.readControl();
  if (control.killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting without doing anything.");
    return { stopped: true, run: null, rows: [], newRows: [], digest: "" };
  }

  // 2. Fetch.
  let watch = withSeeds(await store.readTable("Watchlist"), cfg, nowIso);
  const raws: RawJob[] = [];
  const perSource: Record<string, number> = {};
  if (kind !== "ats") {
    const f = await fetchAll(cfg, get);
    raws.push(...f.jobs);
    Object.assign(perSource, f.perSource);
    errors.push(...f.errors);
  }
  if (kind !== "boards" && cfg.sources.ats.enabled) {
    const atsJobs = await fetchAtsBoards(cfg, get, watch, nowIso, errors);
    raws.push(...atsJobs);
    perSource.ats_boards = atsJobs.length;
  }
  log(`Fetched ${raws.length} jobs: ${JSON.stringify(perSource)}`);

  // 3. Keep QA-ish titles, then normalize.
  const jobs: Job[] = [];
  for (const raw of raws) {
    if (!passesTitlePrefilter(raw.title, cfg.targeting)) continue;
    try {
      jobs.push(toJob(raw, cfg, now));
    } catch (err) {
      errors.push(`normalize ${raw.source}/${raw.sourceId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  log(`${jobs.length} QA-related jobs after the title pre-filter`);

  // 4. Dedupe against both job tabs and within this run.
  const existing = [...(await store.readTable("Jobs")), ...(await store.readTable("Filtered"))];
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
  toScore.sort((a, b) => byFreshness(a.job, b.job));
  const afterFilters = toScore.length;
  log(`${fresh.length} new jobs, ${afterFilters} to score after hard filters`);

  // 6. Score (Haiku), freshest first, within the per-run cap.
  let scored = 0;
  let usage = emptyUsage();
  let costUsd = 0;
  const capped = toScore.slice(0, cfg.limits.maxScoredPerRun);
  const results = scorer && capped.length ? await scorer.scoreMany(capped.map((t) => t.job)) : new Map();
  const newlyShortlisted: JobRow[] = [];
  const toVerify: { job: Job; row: JobRow }[] = [];
  for (const { job, row } of toScore) {
    const res = results.get(job.id);
    if (!scorer || !res) {
      row.status = "unscored";
      if (scorer) row.notes = "not scored this run (cap, cost limit or batch timeout); retried next run";
      continue;
    }
    usage = addUsage(usage, res.usage);
    costUsd += estimateCostUsd(cfg.limits.models.score, res.usage, cfg, res.batch);
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
    row.notes = "";
    if (ai.locationEligible === "no") {
      row.status = "filtered_out";
      row.filter_reasons = `ai: location not open to Egypt${ai.locationEvidence ? ` ("${ai.locationEvidence}")` : ""}`;
      continue;
    }
    if (ai.payrollRestriction === "excludes_egypt") {
      row.status = "filtered_out";
      row.filter_reasons = "ai: cannot pay or employ people in Egypt";
      continue;
    }
    if (ai.redFlags.length > 0) {
      row.status = "filtered_out";
      row.filter_reasons = "ai: red flags";
      continue;
    }
    const b = combineScore(job, ai, cfg, now);
    row.score = b.total;
    row.score_band = scoreBand(b.total);
    const notes = [
      ai.mustHaveGaps.length ? `gaps: ${ai.mustHaveGaps.join(", ")}` : "",
      ai.locationEligible === "unclear" ? "location unclear" : "",
      ai.timezoneNote ? `hours: ${ai.timezoneNote}` : "",
      ai.payrollRestriction === "contractor_only" ? "contractor only" : "",
    ].filter(Boolean);
    row.breakdown = [formatBreakdown(b), ...notes].join(" | ");
    row.status = statusForScore(b, cfg.scoring);
    if (row.status === "shortlisted") toVerify.push({ job, row });
  }
  log(`Scored ${scored}, ~$${costUsd.toFixed(3)} (cache read ${usage.cacheRead} tokens)`);

  // 6b. Can someone in Egypt really get it? Check the company's own careers site, because
  // boards get this wrong. "No" drops the job; a job whose post never says where it hires is
  // shortlisted only with a high score (the letter then explains contractor / EOR).
  await pool(toVerify, 3, async ({ job, row }) => {
    const v = await verify(job.company, job.title).catch((): Verdict => ({ egypt: "unknown", reason: "company site check failed", posting: null }));
    if (v.posting) {
      row.apply_url = v.posting.url;
      row.ats = detectAts(v.posting.url, null);
    }
    if (v.egypt === "no") {
      row.status = "filtered_out";
      row.filter_reasons = `not open to Egypt: ${v.reason}`;
      return;
    }
    const confirmed = v.egypt === "yes" || eligibilityOf(job.remoteScope, job.viaEor) === "yes";
    if (confirmed) {
      row.breakdown = [row.breakdown, `Egypt OK: ${v.egypt === "yes" ? v.reason : `post says ${job.remoteScope}`}`].join(" | ");
      newlyShortlisted.push(row);
      return;
    }
    row.breakdown = [row.breakdown.replace(" | location unclear", ""), `location unclear: ${v.reason}`].join(" | ");
    if (Number(row.score) >= cfg.scoring.unclearLocationMinScore) newlyShortlisted.push(row);
    else row.status = "maybe";
  });

  // 7. Is each new shortlisted job still open? (cheap; avoids wasted drafts later)
  await pool(newlyShortlisted, 5, async (row) => {
    if ((await liveness(row.apply_url || row.url)) === "gone") {
      row.status = "closed";
      row.notes = [row.notes, "listing gone (404/410) when checked"].filter(Boolean).join("; ");
    }
  });

  // 8. Watchlist: companies with Egypt-eligible jobs get their own board polled.
  let watchAdded = 0;
  if (cfg.sources.ats.enabled) {
    try {
      const w = await updateWatchlist(watch, jobs, cfg, get, nowIso, opts.probe);
      watch = w.rows;
      watchAdded = w.added.length;
    } catch (err) {
      errors.push(`watchlist: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 9. Referral targets: the strongest jobs, where someone inside could refer Islam.
  const referrals = await store.readTable("Referrals");
  const haveRef = new Set(referrals.map((r) => r.job_id));
  const newRefs: ReferralRow[] = newlyShortlisted
    .filter((r) => r.status === "shortlisted" && Number(r.score) >= cfg.scoring.referralMinScore && !haveRef.has(r.job_id))
    .map((r) => ({
      job_id: r.job_id, company: r.company, title: r.title, score: r.score, url: r.url,
      linkedin_people_search: linkedinPeopleSearch(r.company), added_at: nowIso, status: "todo", notes: "",
    }));

  // 10. Merge: existing rows (last_seen/sources updated, Islam's edits kept), then new rows best-first.
  const merged = existing.map((r) => {
    const again = seenAgain.get(r.job_id);
    if (!again) return r;
    const sources = new Set([...r.sources.split(", ").filter(Boolean), ...again]);
    return { ...r, last_seen: nowIso, sources: [...sources].sort().join(", ") };
  });
  const score = (r: JobRow) => (typeof r.score === "number" ? r.score : Number(r.score) || -1);
  newRows.sort((a, b) => score(b) - score(a));
  const rows = [...merged, ...newRows.filter((r) => !existingIds.has(r.job_id))];

  // Readable Jobs tab: dropped jobs live in Filtered.
  await store.writeTable("Jobs", rows.filter((r) => r.status !== "filtered_out"));
  await store.writeTable("Filtered", rows.filter((r) => r.status === "filtered_out"));
  await store.writeTable("Watchlist", watch);
  if (newRefs.length) await store.appendRows("Referrals", newRefs);

  // 11. Heartbeat: one row per run, so a silent day means something is stuck.
  const run: RunLog = {
    run_id: `${kind}-${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode: control.mode,
    fetched: raws.length,
    after_filters: afterFilters,
    new: fresh.length,
    scored,
    shortlisted: rows.filter((r) => r.status === "shortlisted").length,
    errors: errors.join(" | ").slice(0, 2000),
    cost_usd_est: Math.round(costUsd * 1000) / 1000,
    input_tokens: usage.input,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    watchlist_added: watchAdded,
  };
  await store.appendRows("Runs", [run]);
  const freshRows = newRows.filter((r) => !existingIds.has(r.job_id));
  log(`Done. ${run.new} new, ${run.scored} scored, ${run.shortlisted} shortlisted in total, +${watchAdded} watchlist, ~$${run.cost_usd_est}`);
  return { stopped: false, run, rows, newRows: freshRows, digest: buildDigest(freshRows, run) };
}
