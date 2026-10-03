// Phase 4: what to put in each application-form field, decided from its question text.
// Pure and tested. Islam reviews the filled form and presses Submit himself: every ATS checked
// (Greenhouse, Lever, Ashby) has a CAPTCHA, and the pipeline never tries to get past one.
//
//   fill  — a fact from master-profile.md, safe to fill (green)
//   check — a reasonable answer Islam should glance at (yellow)
//   ask   — only Islam can answer (visa, consent, custom questions): left empty, marked red
//   skip  — optional and not useful (pronouns, marketing consent)

export interface FieldInfo {
  kind: "text" | "textarea" | "select" | "file" | "radio" | "checkbox" | "combobox";
  question: string;
  options: string[];
  required: boolean;
}

export interface AnswerContext {
  company: string;
  coverLetter: string;
  /** "3500" or "3000-4500" (USD/month) from the Jobs tab, "" if not stated. */
  salaryUsdMonth: string;
  defaultSalaryUsdMonth: number;
  source: string;
}

export type Answer =
  | { action: "fill" | "check"; value: string }
  | { action: "file"; file: "cv" | "cover" }
  | { action: "ask"; reason: string }
  | { action: "skip" };

// Facts from docs/master-profile.md.
export const PROFILE = {
  first: "Islam",
  last: "Abu-Khadija",
  full: "Islam Ibrahim Abu-Khadija",
  email: "islamabukhadiga@gmail.com",
  phone: "+20 106 899 2404",
  linkedin: "https://www.linkedin.com/in/abukhadija-iti",
  github: "https://github.com/abu-khadija",
  city: "Alexandria",
  country: "Egypt",
  location: "Alexandria, Egypt",
  company: "Flairstech",
  title: "QA Analyst, Automation",
  years: "3",
  notice: "30 days",
} as const;

const DECLINE = /decline|prefer not|choose not|don.?t wish|do not wish|not to (say|disclose|answer)/i;

/** Picks the option whose text matches, for selects and radio groups. */
export function pickOption(options: string[], want: RegExp): string | null {
  return options.find((o) => want.test(o.trim())) ?? null;
}

/** Salary rule (PLAN section 12): top of the posted range, else the default. */
export function salaryAnswer(posted: string, fallback: number): string {
  const top = Number(posted.split("-").pop()?.replace(/[^\d.]/g, ""));
  const n = Number.isFinite(top) && top > 0 ? top : fallback;
  return `${Math.round(n).toLocaleString("en-US")} USD per month`;
}

export function answerFor(f: FieldInfo, ctx: AnswerContext): Answer {
  const q = f.question.replace(/[*✱]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const choose = (want: RegExp, action: "fill" | "check" = "fill"): Answer => {
    const o = pickOption(f.options, want);
    return o ? { action, value: o } : f.required ? { action: "ask", reason: "no matching option" } : { action: "skip" };
  };
  const text = (value: string, action: "fill" | "check" = "fill"): Answer =>
    f.kind === "select" || f.kind === "radio" ? choose(new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), action) : { action, value };

  // Files first: the label is often just "Attach".
  if (f.kind === "file") {
    if (/cover/.test(q)) return { action: "file", file: "cover" };
    if (/resume|cv|attach|upload/.test(q) || q === "") return { action: "file", file: "cv" };
    return f.required ? { action: "ask", reason: "unknown file upload" } : { action: "skip" };
  }

  // Things only Islam can answer: legal, consent, visa.
  if (/sponsor|visa|authori[sz]ed to work|work authori[sz]ation|right to work|work permit|citizenship|security clearance/.test(q)) {
    return { action: "ask", reason: "work authorization / visa" };
  }
  if (/employment agreement|non-?compete|post-employment|restrictive covenant/.test(q)) return { action: "ask", reason: "employment agreements" };
  if (/privacy|consent|agree|terms|gdpr|data processing|acknowledg/.test(q)) {
    if (/marketing|future (job )?opportunit|text messages|sms/.test(q)) return { action: "skip" };
    return f.required ? { action: "ask", reason: "consent: your decision" } : { action: "skip" };
  }

  // Demographic surveys: decline if possible, never guess.
  if (/gender|race|ethnic|hispanic|latino|veteran|disabilit|sexual orientation|transgender/.test(q)) {
    const d = pickOption(f.options, DECLINE);
    return d ? { action: "fill", value: d } : f.required ? { action: "ask", reason: "demographic question" } : { action: "skip" };
  }
  if (/pronoun/.test(q)) return { action: "skip" };
  // A lone checkbox that isn't consent is a yes/no claim ("Do you have 7 years of…?"): Islam decides.
  if (f.kind === "checkbox") return f.required ? { action: "ask", reason: "yes/no question" } : { action: "skip" };

  // Identity and contact.
  if (/preferred (first )?name|name you.?d prefer|nickname/.test(q)) return text(PROFILE.first);
  if (/first name|given name/.test(q)) return text(PROFILE.first);
  if (/last name|surname|family name/.test(q)) return text(PROFILE.last);
  if (/(full|legal) name|^name$|^your name/.test(q)) return text(PROFILE.full);
  if (/e-?mail/.test(q)) return text(PROFILE.email);
  if (/phone|mobile|whatsapp/.test(q)) return text(PROFILE.phone);
  if (/linkedin/.test(q)) return text(PROFILE.linkedin);
  if (/github/.test(q)) return text(PROFILE.github);
  if (/portfolio|website|personal site|other url|other website/.test(q)) return f.required ? text(PROFILE.linkedin, "check") : { action: "skip" };

  // Where he is.
  if (/country/.test(q)) return text(PROFILE.country);
  if (/city/.test(q)) return text(PROFILE.city);
  if (/location|where (are you|do you|will you).*(based|live|located|work)|working from|reside|residence|time ?zone/.test(q)) {
    if (/time ?zone/.test(q)) return text("UTC+2 (Egypt)", "check");
    return text(PROFILE.location, f.kind === "combobox" ? "check" : "fill");
  }

  // Work.
  if (/current (company|employer)|^company$|^org/.test(q)) return text(PROFILE.company);
  if (/current (job )?title|current role|job title/.test(q)) return text(PROFILE.title);
  if (/notice period|start date|when can you start|availability to start/.test(q)) return text(PROFILE.notice, "check");
  if (/years of (professional |relevant |qa |testing )?experience|how many years/.test(q)) {
    return f.options.length ? choose(/^(3|2-4|3-5|0-4|1-3|3\+)/, "check") : text(PROFILE.years, "check");
  }
  if (/salary|compensation|pay expectation|expected (pay|rate)|desired pay/.test(q)) {
    return { action: "check", value: salaryAnswer(ctx.salaryUsdMonth, ctx.defaultSalaryUsdMonth) };
  }
  if (/how did you (hear|find|learn)|where did you (hear|find|see)|source/.test(q)) {
    return f.options.length ? choose(/job board|online|website|other/i, "check") : text(`Job board (${ctx.source || "online"})`, "check");
  }
  if (/previously (worked|been employed|employed|applied)|ever (worked|been employed)|worked (at|for) .* before|consulted for|former employee/.test(q)) {
    return f.options.length ? choose(/^no\b/i, "check") : text("No", "check");
  }
  if (/cover letter|why (do you want|are you interested)|tell us why|motivation/.test(q) && (f.kind === "textarea" || f.kind === "text")) {
    return { action: "check", value: ctx.coverLetter };
  }

  return f.required ? { action: "ask", reason: "custom question" } : { action: "skip" };
}
