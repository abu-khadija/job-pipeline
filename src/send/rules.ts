// Plain-code rules every send must pass (PLAN section 12, gates 4, 5 and 8). Pure functions, tested.
import type { Limits } from "../config.js";
import { cleanCompany } from "../generate/gates.js";
import type { SentRow } from "../schema.js";
import type { Control } from "../store/types.js";

/**
 * Live only when BOTH switches say so: Control!B2 = live in the Sheet AND DRY_RUN=false in the
 * environment. Anything else (missing, mistyped) is a dry run.
 */
export function isLive(control: Control, env: NodeJS.ProcessEnv = process.env): boolean {
  return control.killSwitch === "RUN" && control.mode === "live" && env.DRY_RUN?.trim().toLowerCase() === "false";
}

const day = (iso: string) => iso.slice(0, 10);

/** Applications sent today (UTC) — gate 5. Follow-ups are counted separately. */
export function sentToday(sent: SentRow[], now: Date): number {
  return sent.filter((s) => s.sent_at && day(s.sent_at) === day(now.toISOString())).length;
}

export function followUpsToday(sent: SentRow[], now: Date): number {
  return sent.filter((s) => s.followed_up_at && day(s.followed_up_at) === day(now.toISOString())).length;
}

/** Sending window: working hours, and not on weekend days (config `skipDaysUtc`). */
export function inWorkingHours(now: Date, l: Limits): boolean {
  if (l.sending.skipDaysUtc.includes(now.getUTCDay())) return false;
  const h = now.getUTCHours();
  return h >= l.sending.workingHoursUtc.start && h < l.sending.workingHoursUtc.end;
}

/** Gate 4 at send time: default cooldown per company, plus special limits (e.g. Deel 3 per 60 days). */
export function companyAllowed(company: string, sent: SentRow[], now: Date, l: Limits): { ok: boolean; reason: string } {
  const key = cleanCompany(company).toLowerCase();
  const sameCompany = sent.filter((s) => cleanCompany(s.company).toLowerCase() === key);
  const special = l.perCompanyLimits.special.find((x) => key.includes(x.company.toLowerCase()));
  const windowDays = special?.windowDays ?? l.perCompanyLimits.defaultCooldownDays;
  const max = special?.maxApplications ?? 1;
  const since = now.getTime() - windowDays * 86_400_000;
  const recent = sameCompany.filter((s) => Date.parse(s.sent_at) >= since);
  return recent.length >= max
    ? { ok: false, reason: `already applied to ${cleanCompany(company)} ${recent.length}x in the last ${windowDays} days` }
    : { ok: true, reason: "" };
}

/** Rows due one follow-up: email sent N+ days ago, no real reply (auto-receipts don't count), no follow-up yet. */
export function dueForFollowUp(sent: SentRow[], now: Date, l: Limits): SentRow[] {
  const cutoff = now.getTime() - l.sending.followUpAfterDays * 86_400_000;
  return sent.filter(
    (s) => s.channel === "email" && !s.followed_up_at
      && (!s.reply_status || s.reply_status === "other") && Date.parse(s.sent_at) <= cutoff,
  );
}
