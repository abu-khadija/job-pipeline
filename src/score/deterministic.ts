// The parts of the score that plain code computes: salary, freshness, timezone, role-fit cap,
// Arabic bonus and the final sum. The model only supplies judgement fields; code adds them up.
import type { Config, Scoring } from "../config.js";
import { ageInDays } from "../filters/hardFilters.js";
import { titlePriority } from "../normalize/title.js";
import type { AiScore, Job, JobStatus } from "../schema.js";

export function salaryPoints(maxUsdMonth: number | null, s: Scoring): number {
  if (maxUsdMonth === null) return s.salaryPoints.notStated;
  const tiers = [...s.salaryPoints.tiers].sort((a, b) => b.min - a.min);
  return tiers.find((t) => maxUsdMonth >= t.min)?.points ?? 0;
}

export function freshnessPoints(postedAt: string | null, now: Date, s: Scoring): number {
  const age = ageInDays(postedAt, now);
  if (age === null) return s.freshnessPoints.older;
  const tiers = [...s.freshnessPoints.tiers].sort((a, b) => a.maxDays - b.maxDays);
  return tiers.find((t) => age <= t.maxDays)?.points ?? s.freshnessPoints.older;
}

export function timezonePoints(overlap: AiScore["timezoneOverlap"], s: Scoring): number {
  return s.timezonePoints[overlap];
}

/** P1/P2 can earn full role-fit points; P3 and unknown titles are capped. */
export function roleFitCap(job: Job, cfg: Config): number {
  const p = titlePriority(job.title, cfg.targeting);
  return p === "p1" || p === "p2" ? cfg.scoring.weights.roleFit : cfg.scoring.weights.roleFitP3Cap;
}

/** The model judges role fit and stack on a fixed 0–30 / 0–25 scale; we rescale to our weights. */
const AI_SCALE = { roleFit: 30, stackMatch: 25, domain: 10, interviewRisk: 10 } as const;

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
const rescale = (n: number, from: number, to: number) => clamp((Math.max(0, Math.min(from, n)) / from) * to, to);

export interface ScoreBreakdown {
  roleFit: number;
  stackMatch: number;
  salary: number;
  domain: number;
  interviewRisk: number;
  freshness: number;
  timezone: number;
  typeBPenalty: number;
  total: number;
}

export function combineScore(job: Job, ai: AiScore, cfg: Config, now: Date): ScoreBreakdown {
  const w = cfg.scoring.weights;
  const b = {
    roleFit: Math.min(rescale(ai.roleFit, AI_SCALE.roleFit, w.roleFit), roleFitCap(job, cfg)),
    stackMatch: rescale(ai.stackMatch, AI_SCALE.stackMatch, w.stackMatch),
    salary: salaryPoints(job.salaryMaxUsdMonth, cfg.scoring),
    // A post asking for Arabic / RTL testing is a strong fit for Islam: full domain points.
    domain: job.arabicPlus ? w.domain : rescale(ai.domain, AI_SCALE.domain, w.domain),
    interviewRisk: rescale(ai.interviewRisk, AI_SCALE.interviewRisk, w.interviewRisk),
    freshness: freshnessPoints(job.postedAt, now, cfg.scoring),
    timezone: timezonePoints(ai.timezoneOverlap, cfg.scoring),
    typeBPenalty: ai.isTypeB && cfg.scoring.typeB.penaltyEnabled ? cfg.scoring.typeB.penalty : 0,
  };
  const sum = b.roleFit + b.stackMatch + b.salary + b.domain + b.interviewRisk + b.freshness + b.timezone;
  return { ...b, total: Math.max(0, sum - b.typeBPenalty) };
}

export function statusForScore(b: ScoreBreakdown, s: Scoring): JobStatus {
  const status: JobStatus = b.total >= s.applyThreshold ? "shortlisted" : b.total >= s.maybeThreshold ? "maybe" : "low_score";
  // Type B (testing AI products) roles are often open worldwide: don't let the penalty alone bury them.
  if (status === "low_score" && b.typeBPenalty > 0 && s.typeB.keepAtLeastMaybe && b.total + b.typeBPenalty >= s.maybeThreshold) {
    return "maybe";
  }
  return status;
}

export function scoreBand(total: number): string {
  if (total >= 80) return "80+";
  if (total >= 70) return "70-79";
  if (total >= 60) return "60-69";
  return "<60";
}

export function formatBreakdown(b: ScoreBreakdown): string {
  return `role ${b.roleFit} · stack ${b.stackMatch} · salary ${b.salary} · domain ${b.domain} · interview ${b.interviewRisk} · fresh ${b.freshness} · tz ${b.timezone}${b.typeBPenalty ? ` · typeB -${b.typeBPenalty}` : ""}`;
}
