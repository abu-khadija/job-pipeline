// Phase 2 run: kill switch → pick shortlisted jobs with no draft → read their posts again →
// write (Sonnet) → code gates → fact check (Sonnet) → retry once → PDF CV + texts in out/drafts/ →
// Drafts tab. Nothing in here sends anything: Islam applies by hand from the files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { toJob, type RawJob } from "../normalize/index.js";
import { passesTitlePrefilter } from "../normalize/title.js";
import { fetchAtsBoards } from "../pipeline.js";
import type { AiDraft, DraftRow, Job, JobRow } from "../schema.js";
import { addUsage, emptyUsage, estimateCostUsd, pool, type Usage } from "../score/scorer.js";
import { fetchAll } from "../sources/index.js";
import type { Store } from "../store/types.js";
import type { HttpGet } from "../util/http.js";
import { withSeeds } from "../watchlist.js";
import { cvHtml, loadCvMarkdown, renderPdf, withSummary } from "./cv.js";
import {
  bannedClaimsGate, cleanCompany, cleanTitle, companyLimitGate, companyRoleGate, formatGates,
  pickVariant, routeFor, type GateResult,
} from "./gates.js";
import type { Writer } from "./writer.js";

export interface GenerateOptions {
  cfg: Config;
  store: Store;
  get: HttpGet;
  writer: Writer;
  /** Only these job ids (from the Jobs tab); default: every shortlisted job without a draft. */
  jobIds?: string[];
  max?: number;
  outDir?: string;
  now?: Date;
  log?: (msg: string) => void;
  /** Injected in tests; defaults to Playwright. */
  pdf?: (html: string, file: string) => Promise<void>;
  /** Injected in tests; defaults to fetching the boards again. */
  loadJobs?: () => Promise<Job[]>;
}

export interface GenerateSummary {
  stopped: boolean;
  drafts: DraftRow[];
  costUsd: number;
}

/** Signature added by code after the gates, from master-profile.md (the single source of facts). */
export function signature(root = process.cwd()): string {
  const profile = readFileSync(path.join(root, "docs", "master-profile.md"), "utf8");
  const field = (name: string) => profile.match(new RegExp(`^- ${name}: (.+)$`, "m"))?.[1]?.replace(/`/g, "").trim() ?? "";
  const links = field("Links").split("·")[0]?.trim() ?? "";
  return ["Best regards,", field("Name"), [field("Phone"), field("Email")].filter(Boolean).join(" · "), links].filter(Boolean).join("\n");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** The posts behind the Jobs rows: read again from the same sources (descriptions are not kept in the Sheet). */
async function currentJobs(cfg: Config, store: Store, get: HttpGet, now: Date, errors: string[]): Promise<Job[]> {
  const raws: RawJob[] = [];
  const boards = await fetchAll(cfg, get);
  raws.push(...boards.jobs);
  errors.push(...boards.errors);
  if (cfg.sources.ats.enabled) {
    const watch = withSeeds(await store.readTable("Watchlist"), cfg, now.toISOString());
    raws.push(...(await fetchAtsBoards(cfg, get, watch, now.toISOString(), errors)));
  }
  const jobs: Job[] = [];
  for (const raw of raws) {
    if (!passesTitlePrefilter(raw.title, cfg.targeting)) continue;
    try {
      jobs.push(toJob(raw, cfg, now));
    } catch {
      // A post that no longer normalizes is treated as missing.
    }
  }
  return jobs;
}

export async function runGenerate(opts: GenerateOptions): Promise<GenerateSummary> {
  const { cfg, store, writer } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const outDir = opts.outDir ?? path.join(process.cwd(), "out", "drafts");
  const pdf = opts.pdf ?? renderPdf;
  const gen = cfg.writing.generation;

  // Gate 8: kill switch first.
  const control = await store.readControl();
  if (control.killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting without doing anything.");
    return { stopped: true, drafts: [], costUsd: 0 };
  }

  const existingDrafts = await store.readTable("Drafts");
  const drafted = new Set(existingDrafts.map((d) => d.job_id));
  const rows = await store.readTable("Jobs");
  const score = (r: JobRow) => Number(r.score) || 0;
  const candidates = rows
    .filter((r) => (opts.jobIds ? opts.jobIds.includes(r.job_id) : r.status === "shortlisted"))
    .filter((r) => !drafted.has(r.job_id))
    .sort((a, b) => score(b) - score(a))
    .slice(0, opts.max ?? gen.maxDraftsPerRun);
  if (candidates.length === 0) {
    log("No shortlisted jobs without a draft. Nothing to do.");
    return { stopped: false, drafts: [], costUsd: 0 };
  }
  log(`${candidates.length} job(s) to draft. Reading the posts again...`);

  const errors: string[] = [];
  const jobs = opts.loadJobs ? await opts.loadJobs() : await currentJobs(cfg, store, opts.get, now, errors);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const byUrl = new Map(jobs.filter((j) => j.applyUrl).map((j) => [j.applyUrl!, j]));

  const sig = signature();
  const cvMd = loadCvMarkdown();
  const nowIso = now.toISOString();
  const newDrafts: DraftRow[] = [];
  const claimed = new Set<string>();
  let costUsd = 0;
  const cost = (u: Usage, model: string) => {
    const c = estimateCostUsd(model, u, cfg);
    costUsd += c;
    return c;
  };

  await pool(candidates, gen.concurrency, async (row) => {
    const job = byId.get(row.job_id) ?? (row.apply_url ? byUrl.get(row.apply_url) : undefined);
    const company = cleanCompany(row.company);
    const role = cleanTitle(row.title);
    const base: DraftRow = {
      job_id: row.job_id, created_at: nowIso, status: "held", hold_reason: "", company: row.company, title: row.title,
      score: row.score, cv_variant: "", route: "", apply_to: "", email_subject: "", email_body: "", cover_letter: "",
      cv_summary: "", post_detail: "", files: "", gates: "", unsupported_claims: "", cost_usd_est: "", notes: "",
    };

    if (!job) {
      newDrafts.push({ ...base, hold_reason: "post not found in today's fetch (maybe closed); open the link to check", apply_to: row.apply_url || row.url });
      return;
    }
    const { route, to } = routeFor(job);
    base.route = route;
    base.apply_to = to;

    // Gate 4 before spending money: one draft per company in the cooldown window. Jobs run in
    // parallel, so the company is claimed here, before any await, not when its draft is done.
    let g4 = companyLimitGate(row.company, existingDrafts, now, gen.companyCooldownDays);
    if (g4.pass && claimed.has(company.toLowerCase())) g4 = { gate: "4 company", pass: false, detail: "another job at this company is drafted in this run" };
    if (!g4.pass) {
      newDrafts.push({ ...base, status: "skipped", hold_reason: g4.detail, gates: formatGates([g4]) });
      return;
    }
    claimed.add(company.toLowerCase());

    const variant = pickVariant(row.title, cfg.writing);
    const leadStatements = cfg.writing.leadStatements[variant];
    let usage = emptyUsage();
    let draft: AiDraft | null = null;
    let gates: GateResult[] = [];
    let unsupported: string[] = [];
    let feedback: string[] = [];

    // Write → code gates → fact check; one retry with the reasons, then hold.
    for (let attempt = 0; attempt < 2; attempt++) {
      const w = await writer.write({ job, company, role, variant, leadStatements, feedback });
      usage = addUsage(usage, w.usage);
      if (!w.draft) {
        gates = [{ gate: "write", pass: false, detail: w.error ?? "no draft" }];
        break;
      }
      draft = w.draft;
      const g2 = bannedClaimsGate(draft, cfg.writing, { title: job.title, company: job.company });
      const g3 = companyRoleGate(draft, company, role);
      let g1: GateResult = { gate: "1 facts", pass: false, detail: "not checked (code gates failed first)" };
      unsupported = [];
      if (g2.pass && g3.pass) {
        const fc = await writer.factCheck(draft);
        usage = addUsage(usage, fc.usage);
        if (!fc.check) g1 = { gate: "1 facts", pass: false, detail: fc.error ?? "fact check failed" };
        else {
          unsupported = fc.check.claims.filter((c) => !c.supported).map((c) => c.claim);
          g1 = { gate: "1 facts", pass: unsupported.length === 0, detail: unsupported.length ? `${unsupported.length} unsupported claim(s)` : `${fc.check.claims.length} claims checked` };
        }
      }
      gates = [g1, g2, g3, g4];
      if (gates.every((g) => g.pass)) break;
      feedback = [
        ...(g2.pass ? [] : g2.detail.split("; ")),
        ...(g3.pass ? [] : g3.detail.split("; ")),
        ...unsupported.map((c) => `unsupported claim, remove it: ${c}`),
      ];
    }

    const allPass = gates.length > 0 && gates.every((g) => g.pass);
    const notes = [
      { gate: "5 cap", pass: true, detail: "checked at send time (Phase 3)" },
      { gate: "6 route", pass: true, detail: route },
      { gate: "7 questions", pass: true, detail: route === "form" ? "form questions not read yet (Phase 4)" : "n/a" },
      { gate: "8 kill switch", pass: true, detail: "RUN" },
    ];
    const d: DraftRow = {
      ...base,
      status: allPass ? "draft" : "held",
      hold_reason: allPass ? "" : gates.filter((g) => !g.pass).map((g) => `${g.gate}: ${g.detail}`).join("; "),
      cv_variant: variant,
      gates: formatGates([...gates, ...notes]),
      unsupported_claims: unsupported.join("; "),
      cost_usd_est: Math.round(cost(usage, cfg.limits.models.write) * 1000) / 1000,
    };
    if (draft) {
      d.email_subject = draft.emailSubject;
      d.email_body = `${draft.emailBody.trim()}\n\n${sig}`;
      d.cover_letter = `${draft.coverLetter.trim()}\n\n${sig}`;
      d.cv_summary = draft.cvSummary;
      d.post_detail = draft.postDetail;

      // Files Islam uses to apply by hand. The PDF uses the master CV with only the summary changed.
      const folder = path.join(outDir, `${slug(company)}-${row.job_id.slice(0, 8)}`);
      mkdirSync(folder, { recursive: true });
      const html = cvHtml(withSummary(cvMd, draft.cvSummary));
      writeFileSync(path.join(folder, "cv.html"), html);
      writeFileSync(path.join(folder, "cover-letter.txt"), d.cover_letter + "\n");
      writeFileSync(path.join(folder, "email.txt"), `To: ${route === "email" ? to : "(no address in the post: use the application link)"}\nSubject: ${d.email_subject}\n\n${d.email_body}\n`);
      writeFileSync(path.join(folder, "job-post.txt"), `${job.title}\n${job.company}\n${to}\n\n${job.description}\n`);
      try {
        await pdf(html, path.join(folder, "Islam-Abu-Khadija-CV.pdf"));
      } catch (err) {
        d.notes = `PDF failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
      }
      d.files = path.relative(process.cwd(), folder);
    }
    newDrafts.push(d);
  }, () => costUsd >= gen.maxRunCostUsd);

  // Jobs tab: mark drafted/held. Read it again right before writing so a fetch run in between
  // isn't undone; only status and cv_variant of these rows change.
  const byJob = new Map(newDrafts.map((d) => [d.job_id, d]));
  const latest = await store.readTable("Jobs");
  for (const r of latest) {
    const d = byJob.get(r.job_id);
    if (!d || d.status === "skipped") continue;
    r.status = d.status === "draft" ? "drafted" : "held";
    if (d.cv_variant) r.cv_variant = d.cv_variant;
  }
  await store.writeTable("Jobs", latest);
  if (newDrafts.length) await store.appendRows("Drafts", newDrafts);
  if (errors.length) log(`Source errors while reading posts: ${errors.join(" | ").slice(0, 500)}`);

  const count = (s: string) => newDrafts.filter((d) => d.status === s).length;
  log(`Done. ${count("draft")} draft(s) ready, ${count("held")} held, ${count("skipped")} skipped, ~$${costUsd.toFixed(3)}. Files in ${path.relative(process.cwd(), outDir)}/`);
  return { stopped: false, drafts: newDrafts, costUsd };
}
