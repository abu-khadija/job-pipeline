// A once-a-day plain-English summary emailed to Islam himself, so he never has to open the Sheet.
// Built from the Sheet: today's sends, new shortlisted jobs, invites/questions, forms waiting for
// him, and anything held. Sent with the same Gmail (SMTP) the pipeline already uses.
import type { Mailbox } from "./gmail.js";
import type { DraftRow, JobRow, SentRow } from "./schema.js";
import type { Store } from "./store/types.js";

const day = (iso: string) => (iso || "").slice(0, 10);

export function buildDailyDigest(
  jobs: JobRow[],
  drafts: DraftRow[],
  sent: SentRow[],
  now: Date,
): { subject: string; body: string } {
  const today = day(now.toISOString());
  const sentToday = sent.filter((s) => day(s.sent_at) === today);
  const invites = sent.filter((s) => s.reply_status === "invite");
  const questions = sent.filter((s) => s.reply_status === "question");
  const repliedToday = sent.filter((s) => day(s.reply_at) === today && (s.reply_status === "invite" || s.reply_status === "question"));
  const shortlisted = jobs.filter((r) => r.status === "shortlisted");
  const formsWaiting = drafts.filter((d) => d.status === "draft" && d.route !== "email");
  const held = drafts.filter((d) => d.status === "held");

  const L: string[] = [];
  L.push(`Job pipeline — ${today}`, "");

  // The one thing that needs Islam: interview invites and questions.
  if (repliedToday.length) {
    L.push("⭐ NEW REPLIES TODAY:");
    for (const s of repliedToday) L.push(`  • ${s.reply_status!.toUpperCase()} — ${s.company}: ${s.reply_summary || s.title}`);
    L.push("");
  }

  L.push(`Applications sent today: ${sentToday.length}`);
  for (const s of sentToday) L.push(`  • ${s.company} — ${s.title} (${s.channel})`);
  L.push("");

  if (formsWaiting.length) {
    L.push(`⚠ ${formsWaiting.length} job(s) need you to apply on their form (run: npm run apply):`);
    for (const d of formsWaiting.slice(0, 10)) L.push(`  • ${d.company} — ${d.title}`);
    L.push("");
  }

  L.push(`Open interview invites: ${invites.length}${invites.length ? " — " + invites.map((s) => s.company).join(", ") : ""}`);
  if (questions.length) L.push(`Questions waiting: ${questions.length} — ${questions.map((s) => s.company).join(", ")}`);
  L.push(`Shortlisted jobs in the Sheet: ${shortlisted.length}`);
  if (held.length) L.push(`Held (a check failed): ${held.length} — see the Drafts tab`);

  const parts: string[] = [];
  if (repliedToday.length) parts.push(`${repliedToday.length} reply(ies)`);
  if (sentToday.length) parts.push(`${sentToday.length} sent`);
  if (formsWaiting.length) parts.push(`${formsWaiting.length} to apply`);
  const subject = `Job pipeline ${today}: ${parts.join(", ") || "no activity today"}`;
  return { subject, body: L.join("\n") };
}

/** Builds the digest from the store and emails it to Islam's own address. */
export async function sendDailyDigest(store: Store, mailbox: Mailbox, now = new Date()): Promise<{ sent: boolean; subject: string }> {
  const [jobs, drafts, sent] = await Promise.all([store.readTable("Jobs"), store.readTable("Drafts"), store.readTable("Sent")]);
  const { subject, body } = buildDailyDigest(jobs, drafts, sent, now);
  const me = await mailbox.me();
  await mailbox.send({ to: me, subject, body });
  return { sent: true, subject };
}
