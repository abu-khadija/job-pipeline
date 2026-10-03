// Remote OK public API. The first array element is a legal notice, not a job.
// Terms: link back to the Remote OK job URL and mention Remote OK as the source.
import type { RawJob } from "../normalize/index.js";
import type { HttpGet } from "../util/http.js";
import type { Config } from "../config.js";

interface RemoteOkJob {
  id?: string;
  legal?: string;
  date: string;
  company: string;
  position: string;
  tags?: string[];
  description: string;
  location: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url: string;
}

export function parseRemoteOk(body: string): RawJob[] {
  const data = JSON.parse(body) as RemoteOkJob[];
  return data
    .filter((j) => !j.legal && j.id && j.position)
    .map((j) => ({
      source: "remoteok",
      sourceId: String(j.id),
      url: j.url,
      // Remote OK's apply_url points back to its own page, which redirects to the real form.
      applyUrl: j.apply_url ?? j.url,
      title: j.position,
      company: j.company,
      locationText: j.location ?? "",
      // Remote OK salaries are yearly USD.
      salaryNumbers: j.salary_min || j.salary_max
        ? { min: j.salary_min ?? null, max: j.salary_max ?? null, period: "year" as const, currency: "USD" }
        : null,
      postedAt: j.date ? new Date(j.date).toISOString() : null,
      descriptionHtml: j.description ?? "",
      tags: j.tags ?? [],
    }));
}

export async function fetchRemoteOk(cfg: Config, get: HttpGet): Promise<RawJob[]> {
  return parseRemoteOk(await get(cfg.sources.sources.remoteok.url));
}
