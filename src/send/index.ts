// Phase 3 send step (email only). For each ready email draft, best score first:
// kill switch → live check → working hours → daily cap → per-company limit → send → log.
// Dry run (the default) only reports what it would do. Form applications go through
// `npm run apply` (forms/index.ts), where Islam presses Submit himself.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../config.js";
import { cvHtml, loadCvMarkdown, renderPdf, withSummary } from "../generate/cv.js";
import { cvAttachment, type Attachment, type Mailbox } from "../gmail.js";
import type { DraftRow, SentRow } from "../schema.js";
import type { Store } from "../store/types.js";
import { companyAllowed, inWorkingHours, isLive, sentToday } from "./rules.js";

/** Rebuilds the tailored CV PDF from the draft's saved summary (the generate-run file is gone in CI). */
async function rebuildCv(d: DraftRow): Promise<Attachment | null> {
  if (!d.cv_summary?.trim()) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "cv-"));
  const file = path.join(dir, "Islam-Abu-Khadija-CV.pdf");
  await renderPdf(cvHtml(withSummary(loadCvMarkdown(), d.cv_summary)), file);
  return { filename: "Islam-Abu-Khadija-CV.pdf", path: file, mimeType: "application/pdf" };
}

export interface SendOptions {
  cfg: Config;
  store: Store;
  mailbox: Mailbox | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export interface SendSummary {
  stopped: boolean;
  live: boolean;
  sent: SentRow[];
  wouldSend: string[];
  waitingForms: number;
}

const emptySent = (): Omit<SentRow, "sent_at" | "job_id" | "company" | "title" | "channel" | "to"> => ({
  subject: "", gmail_thread_id: "", gmail_message_id: "", followed_up_at: "", reply_status: "", reply_at: "", reply_summary: "", notes: "",
});

export async function runSend(opts: SendOptions): Promise<SendSummary> {
  const { cfg, store } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const env = opts.env ?? process.env;
  const l = cfg.limits;

  // Gate 8: kill switch first.
  const control = await store.readControl();
  if (control.killSwitch === "STOP") {
    log("Kill switch is STOP. Exiting without doing anything.");
    return { stopped: true, live: false, sent: [], wouldSend: [], waitingForms: 0 };
  }
  const live = isLive(control, env);
  log(live ? "LIVE: applications will really be sent." : "DRY RUN: nothing is sent (Control!B2 must be live AND DRY_RUN=false to send).");
  if (live && !inWorkingHours(now, l)) {
    log(`Outside sending hours (${l.sending.workingHoursUtc.start}:00-${l.sending.workingHoursUtc.end}:00 UTC, no sends on Saturday/Sunday). Nothing sent this run.`);
    return { stopped: false, live, sent: [], wouldSend: [], waitingForms: 0 };
  }

  const drafts = await store.readTable("Drafts");
  const sentRows = await store.readTable("Sent");
  const ready = drafts.filter((d) => d.status === "draft" && d.route === "email").sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const waitingForms = drafts.filter((d) => d.status === "draft" && d.route !== "email").length;
  // Gate 5: daily cap, and a per-run cap so sends spread over the day.
  let budget = Math.max(0, Math.min(l.sending.maxApplicationsPerDay - sentToday(sentRows, now), l.sending.maxSendsPerRun));
  log(`${ready.length} email draft(s) ready; can send ${budget} now (${sentToday(sentRows, now)} sent today, cap ${l.sending.maxApplicationsPerDay}).`);

  const newSent: SentRow[] = [];
  const wouldSend: string[] = [];
  let changed = false;

  for (const d of ready) {
    if (budget <= 0) break;
    const company = companyAllowed(d.company, [...sentRows, ...newSent], now, l);
    if (!company.ok) {
      d.status = "skipped";
      d.hold_reason = company.reason;
      changed = true;
      continue;
    }
    const label = `${d.company} — ${d.title}`;
    // The CV PDF. In the cloud the file from the generate run is gone, so rebuild it from the
    // draft's saved cv_summary (stored in the Sheet). Only truly unrecoverable drafts are held.
    let cv = cvAttachment(path.resolve(d.files || "."));
    if (!d.files || !existsSync(cv.path)) {
      const rebuilt = await rebuildCv(d).catch(() => null);
      if (!rebuilt) {
        d.status = "held";
        d.hold_reason = "CV PDF missing and could not be rebuilt (no cv_summary); run npm run generate";
        changed = true;
        continue;
      }
      cv = rebuilt;
    }
    if (!live) {
      wouldSend.push(`[dry] email to ${d.apply_to}: ${label}`);
      budget--;
      continue;
    }
    if (!opts.mailbox) throw new Error("Live run but Gmail is not set up (npm run gmail:auth).");
    // Gate 8 again right before sending: a STOP set a minute ago still counts.
    if ((await store.readControl()).killSwitch === "STOP") {
      log("Kill switch turned STOP during the run. Stopping.");
      break;
    }
    const res = await opts.mailbox.send({ to: d.apply_to, subject: d.email_subject, body: d.email_body, attachments: [cv] });
    newSent.push({
      ...emptySent(), sent_at: new Date().toISOString(), job_id: d.job_id, company: d.company, title: d.title,
      channel: "email", to: d.apply_to, subject: d.email_subject, gmail_thread_id: res.threadId, gmail_message_id: res.messageId,
    });
    d.status = "sent";
    changed = true;
    budget--;
    log(`Sent email: ${label} → ${d.apply_to}`);
  }

  if (changed) {
    await store.writeTable("Drafts", drafts);
    if (newSent.length) {
      await store.appendRows("Sent", newSent);
      const sentIds = new Set(newSent.map((s) => s.job_id));
      const jobs = await store.readTable("Jobs");
      for (const j of jobs) if (sentIds.has(j.job_id)) j.status = "applied";
      await store.writeTable("Jobs", jobs);
    }
  }
  for (const w of wouldSend) log(w);
  if (waitingForms) log(`${waitingForms} form application(s) wait for you: run \`npm run apply\`.`);
  log(`Done. ${newSent.length} sent, ${wouldSend.length} would send (dry run).`);
  return { stopped: false, live, sent: newSent, wouldSend, waitingForms };
}
