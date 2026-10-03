// Checks a job on the company's OWN careers site before Islam spends time on it.
// Job boards get "where can you live" wrong (Himalayas lists every job with no country as open
// to Egypt). The company's ATS usually has the real list: TransPerfect lists 15 countries,
// zvoove says Germany/Austria employees only.
//
// Looks the company up by name on Recruitee, Personio, Greenhouse, Lever, Ashby and Workable,
// finds the same job title, and returns its locations and its own application link.
import { cleanCompany } from "../generate/gates.js";
import { normalizeTitleForId } from "../normalize/index.js";
import { stripHtml } from "../normalize/text.js";
import type { HttpGet } from "../util/http.js";

export interface CompanyPosting {
  provider: "recruitee" | "personio" | "greenhouse" | "lever" | "ashby" | "workable";
  url: string;            // the company's own page for this job (apply there)
  title: string;
  /** Places the company says the job is open to. Empty = it doesn't say. */
  places: string[];
  remote: boolean;
  text: string;           // description, plain text
}

/** Slugs a company name is likely to use: "The Codest" → thecodest, the-codest, codest… */
export function slugCandidates(company: string): string[] {
  const base = cleanCompany(company).toLowerCase().replace(/&/g, "and");
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  const noThe = words[0] === "the" ? words.slice(1) : words;
  const out = [words.join(""), words.join("-"), noThe.join(""), noThe.join("-"), `the${noThe.join("")}`, noThe[0] ?? ""];
  return [...new Set(out.filter((s) => s.length >= 3))];
}

/** Same job? Titles match after removing seniority words, brackets and "(m/f/d)". */
export function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => normalizeTitleForId(s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s[-–—|]\s/)[0] ?? s);
  const x = n(a);
  const y = n(b);
  return x.length > 0 && (x === y || (x.length > 8 && (y.includes(x) || x.includes(y))));
}

const json = async <T>(get: HttpGet, url: string): Promise<T | null> => {
  try {
    return JSON.parse(await get(url)) as T;
  } catch {
    return null;
  }
};
const isRemoteWord = (p: string) => /^(remote|anywhere|fully remote|remote job)$/i.test(p.trim());

type Finder = (get: HttpGet, slug: string, title: string) => Promise<CompanyPosting | null>;

const recruitee: Finder = async (get, slug, title) => {
  const d = await json<{ offers: { title: string; careers_url: string; remote: boolean; locations?: { country?: string; city?: string }[]; description?: string; requirements?: string }[] }>(get, `https://${slug}.recruitee.com/api/offers/`);
  const o = d?.offers?.find((x) => sameTitle(x.title, title));
  if (!o) return null;
  const places = [...new Set((o.locations ?? []).map((l) => l.country ?? "").filter(Boolean))];
  return { provider: "recruitee", url: o.careers_url, title: o.title, places, remote: o.remote, text: stripHtml(`${o.description ?? ""} ${o.requirements ?? ""}`) };
};

const personio: Finder = async (get, slug, title) => {
  let xml: string;
  try {
    xml = await get(`https://${slug}.jobs.personio.de/xml?language=en`);
  } catch {
    return null;
  }
  for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    const b = m[1]!;
    const tag = (t: string) => b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    if (!sameTitle(tag("name"), title)) continue;
    const offices = [tag("office"), ...[...b.matchAll(/<additionalOffice>([\s\S]*?)<\/additionalOffice>/g)].map((x) => x[1]!.trim())].filter(Boolean);
    return {
      provider: "personio", url: `https://${slug}.jobs.personio.de/job/${tag("id")}?display=en`, title: tag("name"),
      places: offices.filter((o) => !isRemoteWord(o)), remote: offices.some(isRemoteWord), text: stripHtml(b),
    };
  }
  return null;
};

const greenhouse: Finder = async (get, slug, title) => {
  const d = await json<{ jobs: { title: string; absolute_url: string; location?: { name?: string }; offices?: { name?: string }[]; content?: string }[] }>(get, `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  const j = d?.jobs?.find((x) => sameTitle(x.title, title));
  if (!j) return null;
  const loc = j.location?.name ?? "";
  const places = loc.split(/[;|]|,\s(?=[A-Z])|\bor\b/).map((p) => p.replace(/\bremote\b[\s:-]*/i, "").trim()).filter((p) => p && !isRemoteWord(p));
  return { provider: "greenhouse", url: j.absolute_url, title: j.title, places, remote: /remote/i.test(loc), text: stripHtml(j.content ?? "") };
};

const lever: Finder = async (get, slug, title) => {
  const d = await json<{ text: string; hostedUrl: string; workplaceType?: string; categories?: { location?: string; allLocations?: string[] }; descriptionPlain?: string; additionalPlain?: string }[]>(get, `https://api.lever.co/v0/postings/${slug}?mode=json`);
  const j = Array.isArray(d) ? d.find((x) => sameTitle(x.text, title)) : undefined;
  if (!j) return null;
  const all = j.categories?.allLocations?.length ? j.categories.allLocations : [j.categories?.location ?? ""];
  return {
    provider: "lever", url: j.hostedUrl, title: j.text, places: all.filter((p) => p && !isRemoteWord(p)),
    remote: j.workplaceType === "remote" || all.some(isRemoteWord), text: `${j.descriptionPlain ?? ""} ${j.additionalPlain ?? ""}`,
  };
};

const ashby: Finder = async (get, slug, title) => {
  const d = await json<{ jobs: { title: string; jobUrl: string; isRemote?: boolean; location?: string; secondaryLocations?: { location?: string }[]; descriptionPlain?: string }[] }>(get, `https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  const j = d?.jobs?.find((x) => sameTitle(x.title, title));
  if (!j) return null;
  const all = [j.location ?? "", ...(j.secondaryLocations ?? []).map((s) => s.location ?? "")];
  return { provider: "ashby", url: j.jobUrl, title: j.title, places: all.filter((p) => p && !isRemoteWord(p)), remote: Boolean(j.isRemote), text: j.descriptionPlain ?? "" };
};

const workable: Finder = async (get, slug, title) => {
  const d = await json<{ jobs: { title: string; url: string; telecommuting?: boolean; country?: string; locations?: { country?: string }[] }[] }>(get, `https://apply.workable.com/api/v1/widget/accounts/${slug}`);
  const j = d?.jobs?.find((x) => sameTitle(x.title, title));
  if (!j) return null;
  const places = [...new Set([j.country ?? "", ...(j.locations ?? []).map((l) => l.country ?? "")].filter(Boolean))];
  return { provider: "workable", url: j.url, title: j.title, places, remote: Boolean(j.telecommuting), text: "" };
};

const FINDERS: Finder[] = [recruitee, personio, greenhouse, lever, ashby, workable];

/** Finds the job on the company's own site, or null if it can't be found. */
export async function findCompanyPosting(get: HttpGet, company: string, title: string): Promise<CompanyPosting | null> {
  for (const slug of slugCandidates(company)) {
    const found = await Promise.all(FINDERS.map((f) => f(get, slug, title).catch(() => null)));
    const hit = found.find(Boolean);
    if (hit) return hit;
  }
  return null;
}
