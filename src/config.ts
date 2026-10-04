// Loads and validates config/*.yaml. Islam tunes behaviour there, not in code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const TargetingSchema = z.object({
  titles: z.object({
    p1: z.array(z.string()),
    p2: z.array(z.string()),
    p3: z.array(z.string()),
    skip: z.array(z.string()),
  }),
  prefilterTitleKeywords: z.array(z.string()),
  location: z.object({
    accept: z.array(z.string()),
    eorSignals: z.array(z.string()),
    rejectAuthorization: z.array(z.string()),
    rejectRegion: z.array(z.string()),
    gulfPlaces: z.array(z.string()),
  }),
  redFlags: z.array(z.string()),
  notRemoteSignals: z.array(z.string()),
  notRemoteTitleSignals: z.array(z.string()),
  stackKeywords: z.array(z.string()),
  domainKeywords: z.array(z.string()),
  arabicKeywords: z.array(z.string()),
  interviewRiskKeywords: z.array(z.string()),
  typeBKeywords: z.array(z.string()),
  maxAgeDays: z.number(),
  maxYearsForSeniorTitles: z.number(),
  salaryFloorUsdMonth: z.number(),
  salaryFloorUsdHour: z.number(),
});

const ScoringSchema = z.object({
  applyThreshold: z.number(),
  maybeThreshold: z.number(),
  referralMinScore: z.number(),
  unclearLocationMinScore: z.number(),
  weights: z.object({
    roleFit: z.number(),
    roleFitP3Cap: z.number(),
    stackMatch: z.number(),
    salary: z.number(),
    domain: z.number(),
    interviewRisk: z.number(),
    freshness: z.number(),
    timezone: z.number(),
  }),
  salaryPoints: z.object({
    tiers: z.array(z.object({ min: z.number(), points: z.number() })),
    notStated: z.number(),
  }),
  freshnessPoints: z.object({
    tiers: z.array(z.object({ maxDays: z.number(), points: z.number() })),
    older: z.number(),
  }),
  timezonePoints: z.object({ full: z.number(), partial: z.number(), unknown: z.number(), none: z.number() }),
  typeB: z.object({ penaltyEnabled: z.boolean(), penalty: z.number(), keepAtLeastMaybe: z.boolean() }),
});

const SourcesSchema = z.object({
  userAgent: z.string(),
  timeoutMs: z.number(),
  retries: z.number(),
  sources: z.object({
    himalayas: z.object({
      enabled: z.boolean(),
      url: z.string(),
      country: z.string(),
      queries: z.array(z.string()),
      maxPagesPerQuery: z.number(),
    }),
    remoteok: z.object({ enabled: z.boolean(), url: z.string() }),
    remotive: z.object({
      enabled: z.boolean(),
      url: z.string(),
      requests: z.array(z.record(z.string(), z.string())),
    }),
    weworkremotely: z.object({ enabled: z.boolean(), feeds: z.array(z.string()) }),
    builtin: z.object({ enabled: z.boolean(), listPages: z.array(z.string()), maxJobsPerRun: z.number(), delayMs: z.number() }),
  }).passthrough(),
  emailLeads: z.object({
    enabled: z.boolean(),
    lookbackDays: z.number(),
    maxEmailsPerRun: z.number(),
    senders: z.array(z.string()),
  }),
  ats: z.object({
    enabled: z.boolean(),
    greenhouse: z.string(),
    lever: z.string(),
    ashby: z.string(),
    maxNewCompanyLookupsPerRun: z.number(),
    seeds: z.array(z.object({ ats: z.enum(["greenhouse", "lever", "ashby"]), slug: z.string(), company: z.string() })),
  }),
});

const LimitsSchema = z.object({
  models: z.object({ score: z.string(), classify: z.string(), write: z.string(), factCheck: z.string() }),
  prices: z.record(z.string(), z.object({ inputPerMTok: z.number(), outputPerMTok: z.number() })),
  cacheReadMultiplier: z.number(),
  cacheWriteMultiplier: z.number(),
  batchDiscount: z.number(),
  scoring: z.object({ useBatchForBoards: z.boolean(), batchMaxWaitMinutes: z.number(), concurrency: z.number().int().min(1) }),
  maxRunCostUsd: z.number(),
  maxDescriptionChars: z.number(),
  maxScoredPerRun: z.number(),
  fx: z.record(z.string(), z.number()),
  sending: z.object({
    maxApplicationsPerDay: z.number(),
    maxFollowUpsPerDay: z.number(),
    maxSendsPerRun: z.number(),
    workingHoursUtc: z.object({ start: z.number(), end: z.number() }),
    skipDaysUtc: z.array(z.number().int().min(0).max(6)),
    followUpAfterDays: z.number(),
    maxFollowUps: z.number(),
    replyLookbackDays: z.number(),
  }),
  perCompanyLimits: z.object({
    defaultCooldownDays: z.number(),
    special: z.array(z.object({ company: z.string(), maxApplications: z.number(), windowDays: z.number() })),
  }),
  salaryAnswer: z.object({ rule: z.string(), defaultUsdMonth: z.number() }),
}).passthrough();

const Range = z.object({ min: z.number(), max: z.number() });
const WritingSchema = z.object({
  generation: z.object({
    maxDraftsPerRun: z.number().int().min(1),
    maxRunCostUsd: z.number(),
    concurrency: z.number().int().min(1),
    companyCooldownDays: z.number(),
  }),
  variants: z.object({ mobile_qa: z.array(z.string()), qa_analyst: z.array(z.string()) }),
  leadStatements: z.object({
    ai_automation: z.array(z.number()),
    qa_analyst: z.array(z.number()),
    mobile_qa: z.array(z.number()),
  }),
  words: z.object({ coverLetter: Range, emailBody: Range, cvSummary: Range }),
  bannedWords: z.array(z.string()),
  bannedClaims: z.array(z.string()),
  handBuiltVerbs: z.array(z.string()),
  aiBuiltWork: z.array(z.string()),
  allowedNumbers: z.array(z.number()),
  followUpTemplate: z.string(),
});

export type Targeting = z.infer<typeof TargetingSchema>;
export type Writing = z.infer<typeof WritingSchema>;
export type Scoring = z.infer<typeof ScoringSchema>;
export type Sources = z.infer<typeof SourcesSchema>;
export type Limits = z.infer<typeof LimitsSchema>;

export interface Config {
  targeting: Targeting;
  scoring: Scoring;
  sources: Sources;
  limits: Limits;
  writing: Writing;
}

function load<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const raw = parse(readFileSync(path.join(dir, file), "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`config/${file} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadConfig(dir = path.join(process.cwd(), "config")): Config {
  return {
    targeting: load(dir, "targeting.yaml", TargetingSchema),
    scoring: load(dir, "scoring.yaml", ScoringSchema),
    sources: load(dir, "sources.yaml", SourcesSchema),
    limits: load(dir, "limits.yaml", LimitsSchema),
    writing: load(dir, "writing.yaml", WritingSchema),
  };
}
