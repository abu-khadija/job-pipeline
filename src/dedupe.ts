// Removes duplicates inside one run and against jobs already in the Sheet.
// Two jobs are the same if they share an id (company + title) or an apply URL.
import type { Job } from "./schema.js";

export interface KnownJob {
  id: string;
  applyUrl: string;
  sources: string[];
}

export interface DedupeResult {
  /** Jobs never seen before. */
  fresh: Job[];
  /** Already known: id → sources seen in this run (to update last_seen and sources). */
  seenAgain: Map<string, Set<string>>;
}

export function dedupe(jobs: Job[], known: KnownJob[]): DedupeResult {
  const knownIds = new Set(known.map((k) => k.id));
  const knownUrlToId = new Map<string, string>();
  for (const k of known) if (k.applyUrl) knownUrlToId.set(k.applyUrl, k.id);
  // Apply URLs of jobs first seen in this run (kept apart from known ones on purpose).
  const runUrlToId = new Map<string, string>();

  const fresh = new Map<string, Job>();
  const seenAgain = new Map<string, Set<string>>();
  const markSeen = (id: string, source: string) => {
    if (!seenAgain.has(id)) seenAgain.set(id, new Set());
    seenAgain.get(id)!.add(source);
  };

  for (const job of jobs) {
    const existingId = knownIds.has(job.id) ? job.id : job.applyUrl ? knownUrlToId.get(job.applyUrl) : undefined;
    if (existingId) {
      markSeen(existingId, job.source);
      continue;
    }
    const inRun = fresh.get(job.id) ?? (job.applyUrl ? fresh.get(runUrlToId.get(job.applyUrl) ?? "") : undefined);
    if (inRun) {
      markSeen(inRun.id, inRun.source);
      markSeen(inRun.id, job.source);
      // Prefer the copy with more information (a stated salary, a longer description).
      if (!inRun.salaryMaxUsdMonth && job.salaryMaxUsdMonth) fresh.set(inRun.id, { ...job, id: inRun.id });
      continue;
    }
    fresh.set(job.id, job);
    if (job.applyUrl) runUrlToId.set(job.applyUrl, job.id);
  }
  return { fresh: [...fresh.values()], seenAgain };
}
