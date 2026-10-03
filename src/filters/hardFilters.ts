// Hard filters: plain code, any failure drops the job. Reasons are kept for the Sheet.
// See docs/PLAN.md section 8.
import type { Targeting } from "../config.js";
import { eligibilityOf } from "../normalize/location.js";
import { findPhrases } from "../normalize/text.js";
import { titlePriority } from "../normalize/title.js";
import type { FilterResult, Job } from "../schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(postedAt: string | null, now: Date): number | null {
  if (!postedAt) return null;
  const t = Date.parse(postedAt);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export function checkTitle(job: Job, t: Targeting): string | null {
  return titlePriority(job.title, t) === "skip" ? `title: skipped role "${job.title}"` : null;
}

export function checkLocation(job: Job): string | null {
  return eligibilityOf(job.remoteScope, job.viaEor) === "no"
    ? `location: not open to Egypt (${job.remoteScope}${job.locationRaw ? `: ${job.locationRaw}` : ""})`
    : null;
}

/** Description-level reject phrases ("must be authorized to work in the US"…). */
export function checkRejectPhrases(job: Job, t: Targeting): string | null {
  const hits = findPhrases(`${job.locationRaw}\n${job.description}`, t.location.reject);
  return hits.length ? `location: "${hits[0]}"` : null;
}

export function checkSalary(job: Job, t: Targeting): string | null {
  if (job.salaryMaxUsdMonth === null) return null; // not stated is fine
  if (job.salaryPeriod === "hour") {
    const hourly = job.salaryMaxUsdMonth / 160;
    return hourly < t.salaryFloorUsdHour ? `salary: about ${hourly.toFixed(1)} USD/hour is below ${t.salaryFloorUsdHour}` : null;
  }
  return job.salaryMaxUsdMonth < t.salaryFloorUsdMonth
    ? `salary: ${job.salaryMaxUsdMonth} USD/month is below ${t.salaryFloorUsdMonth}`
    : null;
}

export function checkSeniority(job: Job, t: Targeting): string | null {
  const seniorTitle = job.seniorityHint === "senior" || job.seniorityHint === "lead";
  if (seniorTitle && job.yearsRequired !== null && job.yearsRequired > t.maxYearsForSeniorTitles) {
    return `seniority: ${job.seniorityHint} title asking ${job.yearsRequired}+ years`;
  }
  return null;
}

export function checkRedFlags(job: Job, t: Targeting): string | null {
  const hits = findPhrases(job.description, t.redFlags);
  return hits.length ? `red flag: "${hits.join('", "')}"` : null;
}

export function checkRemote(job: Job, t: Targeting): string | null {
  const hits = [...findPhrases(job.title, t.notRemoteTitleSignals), ...findPhrases(job.locationRaw, t.notRemoteSignals)];
  return hits.length ? `not remote: "${hits[0]}"` : null;
}

export function checkAge(job: Job, t: Targeting, now: Date): string | null {
  const age = ageInDays(job.postedAt, now);
  return age !== null && age > t.maxAgeDays ? `too old: posted ${age} days ago` : null;
}

export function applyHardFilters(job: Job, t: Targeting, now: Date): FilterResult {
  const reasons = [
    checkTitle(job, t),
    checkLocation(job),
    checkRejectPhrases(job, t),
    checkSalary(job, t),
    checkSeniority(job, t),
    checkRedFlags(job, t),
    checkRemote(job, t),
    checkAge(job, t, now),
  ].filter((r): r is string => r !== null);
  // The location check and the reject-phrase check can say the same thing twice.
  const unique = [...new Set(reasons)];
  return { pass: unique.length === 0, reasons: unique };
}
