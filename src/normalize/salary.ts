// Turns salary text like "$60k–$80k", "€4,000/month" or "$30/hr" into USD per month.
import type { SalaryPeriod } from "../schema.js";

export interface Salary {
  minUsdMonth: number | null;
  maxUsdMonth: number | null;
  period: SalaryPeriod;
  currency: string;
}

// Hours/days used to convert hourly and daily rates to a month.
const HOURS_PER_MONTH = 160;
const DAYS_PER_MONTH = 21;

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\bC\$|\bCA\$|\bCAD\b/i, "CAD"],
  [/\bA\$|\bAU\$|\bAUD\b/i, "AUD"],
  [/€|\bEUR\b|\beuros?\b/i, "EUR"],
  [/£|\bGBP\b/i, "GBP"],
  [/\bCHF\b/i, "CHF"],
  [/\bPLN\b|\bzł/i, "PLN"],
  [/₹|\bINR\b/i, "INR"],
  [/\$|\bUSD\b/i, "USD"],
];

function detectCurrency(text: string): string | null {
  for (const [re, code] of CURRENCY_PATTERNS) if (re.test(text)) return code;
  return null;
}

function detectPeriod(text: string): SalaryPeriod | null {
  const t = text.toLowerCase();
  if (/\b(per\s+)?(hour|hr|hourly)\b|\/\s*h\b/.test(t)) return "hour";
  if (/\b(per\s+)?(day|daily)\b|\/\s*d\b/.test(t)) return "day";
  if (/\b(per\s+)?(month|monthly|mo)\b|\/\s*m\b/.test(t)) return "month";
  if (/\b(per\s+)?(year|yearly|annual|annually|annum|yr|p\.?a\.?)\b/.test(t)) return "year";
  return null;
}

/** Guess the period from the size of the number when the text doesn't say. */
function periodFromMagnitude(max: number): SalaryPeriod {
  if (max < 300) return "hour";
  if (max < 20000) return "month";
  return "year";
}

/** Extracts numbers, handling "60k", "60,000", "60.000" and "1.5k". */
function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/gi;
  for (const m of text.matchAll(re)) {
    const rawNum = m[1] ?? "";
    // Thousands separators are followed by exactly 3 digits; a lone decimal like "1.5" stays.
    const isGrouped = /^\d{1,3}([.,\s]\d{3})+$/.test(rawNum);
    let n = Number(isGrouped ? rawNum.replace(/[.,\s]/g, "") : rawNum);
    const unit = m[2]?.toLowerCase();
    if (unit === "k") n *= 1000;
    if (unit === "m") n *= 1_000_000;
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

export function toUsdMonth(amount: number, period: SalaryPeriod, currency: string, fx: Record<string, number>): number | null {
  const rate = fx[currency];
  if (rate === undefined) return null;
  const perMonth =
    period === "hour" ? amount * HOURS_PER_MONTH
    : period === "day" ? amount * DAYS_PER_MONTH
    : period === "year" ? amount / 12
    : amount;
  return Math.round(perMonth * rate);
}

/** Parses free text. Returns null when there is no usable number. */
export function parseSalaryText(raw: string | null | undefined, fx: Record<string, number>): Salary | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();
  // Drop years-of-experience style numbers so "5+ years" isn't read as a salary.
  const cleaned = text.replace(/\d+\s*\+?\s*(years?|yrs?)\b/gi, " ");
  const nums = extractNumbers(cleaned).filter((n) => n >= 5); // ignore tiny noise like "1 role"
  if (nums.length === 0) return null;

  const currency = detectCurrency(text) ?? "USD";
  const upTo = /\bup\s+to\b/i.test(text);
  const max = Math.max(...nums);
  const min = upTo ? null : Math.min(...nums);
  const period = detectPeriod(text) ?? periodFromMagnitude(max);

  const maxUsd = toUsdMonth(max, period, currency, fx);
  if (maxUsd === null) return null;
  return {
    minUsdMonth: min === null ? null : toUsdMonth(min, period, currency, fx),
    maxUsdMonth: maxUsd,
    period,
    currency,
  };
}

/** For sources that give numbers directly (Himalayas, RemoteOK). */
export function salaryFromNumbers(
  min: number | null | undefined,
  max: number | null | undefined,
  period: SalaryPeriod,
  currency: string,
  fx: Record<string, number>,
): Salary | null {
  const lo = min && min > 0 ? min : null;
  const hi = max && max > 0 ? max : lo;
  if (hi === null) return null;
  const maxUsd = toUsdMonth(hi, period, currency, fx);
  if (maxUsd === null) return null;
  return {
    minUsdMonth: lo === null ? null : toUsdMonth(lo, period, currency, fx),
    maxUsdMonth: maxUsd,
    period,
    currency,
  };
}
