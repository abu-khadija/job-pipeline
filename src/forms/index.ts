// `npm run apply`: Islam's form session. For each ready draft that goes through a form or link,
// best score first: open the form in a visible browser, fill it, then wait for Islam:
//   s = I submitted it · k = keep for later · n = not applying · q = quit
// Only "s" is recorded as sent. The pipeline never presses Submit.
//
// Himalayas shows a human check to automated browsers, and we never get past those. So a Himalayas
// link opens in Islam's own browser; he clicks Apply there and pastes the company's link back.
import path from "node:path";
import type { Config } from "../config.js";
import { cleanUrl, detectAts } from "../normalize/ats.js";
import type { DraftRow, JobRow, SentRow } from "../schema.js";
import { companyAllowed } from "../send/rules.js";
import type { Store } from "../store/types.js";
import type { FormFiller } from "./browser.js";

export interface ApplyOptions {
  cfg: Config;
  store: Store;
  filler: FormFiller;
  /** Asks Islam a question in the terminal and returns the answer. */
  ask: (question: string) => Promise<string>;
  /** Opens a URL in Islam's normal browser (macOS `open`). */
  openExternal: (url: string) => void;
  max?: number;
  now?: Date;
  log?: (msg: string) => void;
}

export function formDrafts(drafts: DraftRow[]): DraftRow[] {
  return drafts
    .filter((d) => d.status === "draft" && (d.route === "form" || d.route === "link"))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
}

const isHimalayas = (url: string) => {
  try {
    return new URL(url).hostname.endsWith("himalayas.app");
  } catch {
    return false;
  }
};

export async function runApply(opts: ApplyOptions): Promise<{ submitted: number }> {
  const { cfg, store, filler, ask } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  if ((await store.readControl()).killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting.");
    return { submitted: 0 };
  }
  const drafts = await store.readTable("Drafts");
  const sent = await store.readTable("Sent");
  const jobs = await store.readTable("Jobs");
  const jobById = new Map(jobs.map((j) => [j.job_id, j]));
  const queue = formDrafts(drafts).slice(0, opts.max ?? 50);
  if (queue.length === 0) {
    log("No form applications waiting. (Email applications go out with `npm run send`.)");
    return { submitted: 0 };
  }
  log(`${queue.length} application(s) to fill. A browser window opens for each one.`);
  log("Green = filled, yellow = check it, red = only you can answer. Review, press Submit yourself, then come back here.\n");

  const newSent: SentRow[] = [];
  const applied = new Set<string>();
  try {
    for (const d of queue) {
      const okCompany = companyAllowed(d.company, [...sent, ...newSent], now, cfg.limits);
      if (!okCompany.ok) {
        d.status = "skipped";
        d.hold_reason = okCompany.reason;
        continue;
      }
      const job: JobRow | undefined = jobById.get(d.job_id);
      log(`\n=== ${d.company} — ${d.title} (score ${d.score})`);
      let url = d.apply_to;
      // The ATS comes from the link itself (it may be a company link pasted in an earlier session).
      let ats = detectAts(url, null);
      if (isHimalayas(url)) {
        log("Opening the Himalayas page in your normal browser. Click \"Apply\" there; it takes you to the company's page.");
        opts.openExternal(url);
        const pasted = (await ask("Paste the company's application link here (Enter = skip for now): ")).trim();
        const clean = cleanUrl(pasted);
        if (!clean || isHimalayas(clean)) {
          log(pasted ? "That isn't a company link. Skipped for now." : "Skipped for now.");
          continue;
        }
        // Remember it, so next time the form opens directly.
        url = d.apply_to = clean;
        ats = detectAts(clean, null);
        d.route = "form";
      }
      const r = await filler.fill(url, ats, path.resolve(d.files || "."), {
        company: d.company,
        coverLetter: d.cover_letter,
        salaryUsdMonth: job?.salary_usd_month ?? "",
        defaultSalaryUsdMonth: cfg.limits.salaryAnswer.defaultUsdMonth,
        source: (job?.sources ?? "").split(", ")[0] ?? "",
      });
      log(`Form: ${r.url}`);
      if (r.error) log(`Problem: ${r.error}`);
      log(`Filled ${r.filled.length}, check ${r.check.length}, you answer ${r.ask.length}.`);
      for (const c of r.check) log(`  check: ${c}`);
      for (const a of r.ask) log(`  YOU:   ${a}`);
      log(`Cover letter and CV are in ${d.files}.`);

      const answer = (await ask("Submitted? [s] yes I submitted · [k] keep for later · [n] not applying · [q] quit: ")).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "n") {
        d.status = "skipped";
        d.hold_reason = "Islam chose not to apply";
      } else if (answer === "s") {
        newSent.push({
          sent_at: new Date().toISOString(), job_id: d.job_id, company: d.company, title: d.title, channel: "form", to: r.url,
          subject: "", gmail_thread_id: "", gmail_message_id: "", followed_up_at: "", reply_status: "", reply_at: "", reply_summary: "", notes: "",
        });
        d.status = "sent";
        applied.add(d.job_id);
      }
    }
  } finally {
    await filler.close();
    await store.writeTable("Drafts", drafts);
    if (newSent.length) await store.appendRows("Sent", newSent);
    if (applied.size) {
      const latest = await store.readTable("Jobs");
      for (const j of latest) if (applied.has(j.job_id)) j.status = "applied";
      await store.writeTable("Jobs", latest);
    }
  }
  log(`\nDone. ${newSent.length} submitted this session.`);
  return { submitted: newSent.length };
}
