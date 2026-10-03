// The parts of the score that plain code can compute: salary, freshness, role-fit cap,
// and the final sum. The model only supplies judgement fields; code adds them up.
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

/** P1/P2 can earn full role-fit points; P3 and unknown titles are capped. */
export function roleFitCap(job: Job, cfg: Config): number {
  const p = titlePriority(job.title, cfg.targeting);
  return p === "p1" || p === "p2" ? cfg.scoring.weights.roleFit : cfg.scoring.weights.roleFitP3Cap;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));

export interface ScoreBreakdown {
  roleFit: number;
  stackMatch: number;
  salary: number;
  domain: number;
  interviewRisk: number;
  freshness: number;
  typeBPenalty: number;
  total: number;
}

export function combineScore(job: Job, ai: AiScore, cfg: Config, now: Date): ScoreBreakdown {
  const w = cfg.scoring.weights;
  const b = {
    roleFit: clamp(ai.roleFit, roleFitCap(job, cfg)),
    stackMatch: clamp(ai.stackMatch, w.stackMatch),
    salary: salaryPoints(job.salaryMaxUsdMonth, cfg.scoring),
    domain: clamp(ai.domain, w.domain),
    interviewRisk: clamp(ai.interviewRisk, w.interviewRisk),
    freshness: freshnessPoints(job.postedAt, now, cfg.scoring),
    typeBPenalty: ai.isTypeB && cfg.scoring.typeB.penaltyEnabled ? cfg.scoring.typeB.penalty : 0,
  };
  const total = Math.max(0, b.roleFit + b.stackMatch + b.salary + b.domain + b.interviewRisk + b.freshness - b.typeBPenalty);
  return { ...b, total };
}

export function statusForScore(total: number, s: Scoring): JobStatus {
  if (total >= s.applyThreshold) return "shortlisted";
  if (total >= s.maybeThreshold) return "maybe";
  return "low_score";
}

export function formatBreakdown(b: ScoreBreakdown): string {
  return `role ${b.roleFit} · stack ${b.stackMatch} · salary ${b.salary} · domain ${b.domain} · interview ${b.interviewRisk} · fresh ${b.freshness}${b.typeBPenalty ? ` · typeB -${b.typeBPenalty}` : ""}`;
}
