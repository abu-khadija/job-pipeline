// One shape for every job, whatever source it came from. See docs/PLAN.md section 5.
import { z } from "zod";

export const RemoteScope = z.enum([
  "worldwide",
  "emea",
  "africa",
  "egypt",
  "europe_only",
  "us_only",
  "americas_only",
  "country_list",
  "gulf",
  "unknown",
]);
export type RemoteScope = z.infer<typeof RemoteScope>;

export const Ats = z.enum([
  "greenhouse", "lever", "ashby", "workable", "recruitee", "teamtailor", "bamboohr",
  "personio", "breezy", "jazzhr", "workday", "icims", "smartrecruiters", "taleo",
  "successfactors", "email", "other", "unknown",
]);
export type Ats = z.infer<typeof Ats>;

export const AtsBoard = z.object({ ats: z.enum(["greenhouse", "lever", "ashby"]), slug: z.string().min(1) });
export type AtsBoard = z.infer<typeof AtsBoard>;

export const SalaryPeriod = z.enum(["hour", "day", "month", "year"]);
export type SalaryPeriod = z.infer<typeof SalaryPeriod>;

export const Job = z.object({
  id: z.string().min(1),
  source: z.string(),
  sourceId: z.string(),
  url: z.string().url(),
  applyUrl: z.string().url().nullable(),
  applyEmail: z.string().email().nullable(),
  ats: Ats,
  title: z.string().min(1),
  company: z.string().min(1),
  companyUrl: z.string().nullable(),
  locationRaw: z.string(),
  remoteScope: RemoteScope,
  allowedCountries: z.array(z.string()),
  viaEor: z.boolean(),
  /** "mena_gulf" when the post is limited to Gulf/MENA places or asks for Arabic. */
  segment: z.enum(["global", "mena_gulf"]),
  arabicPlus: z.boolean(),
  /** Company's own Greenhouse/Lever/Ashby board, when known (feeds the watchlist). */
  atsBoard: AtsBoard.nullable(),
  salaryRaw: z.string().nullable(),
  salaryMinUsdMonth: z.number().nullable(),
  salaryMaxUsdMonth: z.number().nullable(),
  salaryPeriod: SalaryPeriod.nullable(),
  employmentType: z.enum(["full_time", "contract", "part_time", "freelance", "unknown"]),
  seniorityHint: z.enum(["junior", "mid", "senior", "lead", "unknown"]),
  yearsRequired: z.number().nullable(),
  postedAt: z.string().nullable(),
  description: z.string(),
  tags: z.array(z.string()),
  fetchedAt: z.string(),
});
export type Job = z.infer<typeof Job>;

export type TitlePriority = "p1" | "p2" | "p3" | "skip" | "unknown";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

// What Haiku returns. Ranges are checked again in code (score/scorer.ts) because
// structured outputs guarantee the shape, not the number ranges.
export const AiScore = z.object({
  roleFit: z.number(),
  stackMatch: z.number(),
  domain: z.number(),
  interviewRisk: z.number(),
  isTypeB: z.boolean(),
  locationEligible: z.enum(["yes", "no", "unclear"]),
  locationEvidence: z.string(),
  /** Overlap between Egypt (UTC+2/+3) and the hours the job needs. */
  timezoneOverlap: z.enum(["full", "partial", "none", "unknown"]),
  timezoneNote: z.string(),
  /** Who they can pay: anyone, contractors only, or a list that leaves Egypt out. */
  payrollRestriction: z.enum(["none", "contractor_only", "excludes_egypt", "unclear"]),
  redFlags: z.array(z.string()),
  mustHaveGaps: z.array(z.string()),
  oneLineWhy: z.string(),
});
export type AiScore = z.infer<typeof AiScore>;

export const JobStatus = z.enum([
  "filtered_out", "new", "unscored", "score_error", "maybe", "shortlisted", "low_score",
  "drafted", "held", "queued", "applied", "followed_up",
  "replied_invite", "replied_reject", "replied_question", "closed",
]);
export type JobStatus = z.infer<typeof JobStatus>;

// One row in the Jobs tab.
export interface JobRow {
  job_id: string;
  status: JobStatus;
  score: number | "";
  breakdown: string;
  why: string;
  title: string;
  company: string;
  remote_scope: string;
  location_raw: string;
  salary_usd_month: string;
  posted_at: string;
  sources: string;
  url: string;
  apply_url: string;
  ats: string;
  apply_email: string;
  segment: string;
  score_band: string;
  cv_variant: string;
  filter_reasons: string;
  red_flags: string;
  first_seen: string;
  last_seen: string;
  notes: string;
}

export const JOB_COLUMNS: (keyof JobRow)[] = [
  "job_id", "status", "score", "breakdown", "why", "title", "company", "remote_scope",
  "location_raw", "salary_usd_month", "posted_at", "sources", "url", "apply_url", "ats",
  "apply_email", "segment", "score_band", "cv_variant", "filter_reasons", "red_flags",
  "first_seen", "last_seen", "notes",
];

export interface RunLog {
  run_id: string;
  started_at: string;
  finished_at: string;
  mode: "dry" | "live";
  fetched: number;
  after_filters: number;
  new: number;
  scored: number;
  shortlisted: number;
  errors: string;
  cost_usd_est: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  watchlist_added: number;
}

export const RUN_COLUMNS: (keyof RunLog)[] = [
  "run_id", "started_at", "finished_at", "mode", "fetched", "after_filters", "new",
  "scored", "shortlisted", "errors", "cost_usd_est", "input_tokens", "cache_read_tokens",
  "cache_write_tokens", "watchlist_added",
];

/** A company whose ATS board is polled directly. */
export interface WatchRow {
  company: string;
  ats: string;          // greenhouse | lever | ashby | none
  slug: string;
  added_at: string;
  reason: string;
  active: string;       // "yes" or "no" (Islam can switch a company off)
  last_checked: string;
}
export const WATCH_COLUMNS: (keyof WatchRow)[] = ["company", "ats", "slug", "added_at", "reason", "active", "last_checked"];

/** A strong job where a referral from someone inside would help. Islam searches by hand. */
export interface ReferralRow {
  job_id: string;
  company: string;
  title: string;
  score: number | "";
  url: string;
  linkedin_people_search: string;
  added_at: string;
  status: string;       // todo | asked | referred | none_found
  notes: string;
}
export const REFERRAL_COLUMNS: (keyof ReferralRow)[] = [
  "job_id", "company", "title", "score", "url", "linkedin_people_search", "added_at", "status", "notes",
];
