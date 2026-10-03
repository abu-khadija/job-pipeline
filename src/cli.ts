// Entry point. Usage:
//   npm run fetch                      → everything, Google Sheet (needs SHEET_ID + Google key)
//   npm run fetch -- --only=boards     → job boards only (2x/day; Batch API scoring)
//   npm run fetch -- --only=ats        → watchlist ATS boards only (every 3h; real-time scoring)
//   npm run fetch -- --local           → write to out/ instead of the Sheet
//   npm run fetch -- --no-ai           → skip Haiku scoring (jobs saved as "unscored")
//   npm run report [-- --local]        → reply rates by source / CV variant / score band
//   npm run generate [-- --local]      → Phase 2: drafts for shortlisted jobs (Drafts tab + out/drafts/)
//   npm run generate -- --job=<id>,<id> --max=3   → only these jobs / at most 3
//   npm run send                       → Phase 3: email applications (dry unless Control!B2=live AND DRY_RUN=false)
//   npm run apply                      → Phase 4: fill forms in a browser; you press Submit
//   npm run replies                    → Phase 5: read replies, alert + prep pack on invites
//   npm run followup                   → Phase 5: one follow-up after N days without a reply
//   npm run daily                      → generate → send → replies → followup (the Mac runs this hourly)
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { loadConfig, type Config } from "./config.js";
import { sendTelegram } from "./digest.js";
import { PlaywrightFiller } from "./forms/browser.js";
import { runApply } from "./forms/index.js";
import { runGenerate } from "./generate/index.js";
import { SonnetWriter } from "./generate/writer.js";
import { execFile } from "node:child_process";
import { GmailMailbox, gmailDaysLeft, type Mailbox } from "./gmail.js";
import { ClaudeReplyBrain, runFollowups, runReplies } from "./replies.js";
import { runSend } from "./send/index.js";
import { runFetch, type RunKind } from "./pipeline.js";
import { buildReport } from "./report.js";
import { BatchHaikuScorer, HaikuScorer, type Scorer } from "./score/scorer.js";
import { LocalStore } from "./store/local.js";
import { SheetStore } from "./store/sheet.js";
import type { Store } from "./store/types.js";
import { makeHttpGet } from "./util/http.js";

function makeStore(local: boolean): Store {
  if (local) return new LocalStore();
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID is not set. Use --local, or follow docs/SETUP-ISLAM.md A5-A6.");
  return new SheetStore(sheetId);
}

function gmailIfSetUp(): Mailbox | null {
  return process.env.GMAIL_REFRESH_TOKEN ? new GmailMailbox() : null;
}

/** A Mac notification (plus Telegram if set) when the Gmail sign-in is about to expire or has. */
async function warnGmailExpiry() {
  if (!process.env.GMAIL_REFRESH_TOKEN) return;
  const left = gmailDaysLeft(process.env.GMAIL_AUTH_AT);
  if (left === null || left > 1) return;
  const text = left < 0
    ? "Gmail sign-in expired: run npm run gmail:auth"
    : `Gmail sign-in expires in ${left <= 0 ? "less than a day" : "1 day"}: run npm run gmail:auth`;
  log(`WARNING: ${text}`);
  if (process.platform === "darwin") execFile("osascript", ["-e", `display notification "${text}" with title "Job pipeline"`], () => undefined);
  await telegram()?.(`Job pipeline: ${text}`).catch(() => undefined);
}

const log = (m: string) => console.log(m);

function telegram(): ((t: string) => Promise<void>) | undefined {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return token && chat ? (t) => sendTelegram(t, token, chat) : undefined;
}

async function generate(cfg: Config, store: Store, jobIds?: string[], max?: number) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (docs/SETUP-ISLAM.md A4/A6).");
  await runGenerate({ cfg, store, get: makeHttpGet(cfg.sources), writer: new SonnetWriter(cfg), jobIds, max, log });
}

async function replies(cfg: Config, store: Store, mailbox: Mailbox | null) {
  if (!mailbox) return log("Replies: Gmail not set up yet (npm run gmail:auth). Skipped.");
  await runReplies({ cfg, store, mailbox, brain: new ClaudeReplyBrain(cfg), log, notify: telegram() });
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const local = flags.includes("--local");
  const cfg = loadConfig();

  if (command === "report") {
    const store = makeStore(local);
    const report = buildReport(await store.readTable("Jobs"));
    mkdirSync("out", { recursive: true });
    writeFileSync("out/report.md", report.text);
    console.log(report.text);
    return;
  }
  const max = Number(flags.find((f) => f.startsWith("--max="))?.split("=")[1]) || undefined;
  if (command === "generate") {
    const jobIds = flags.find((f) => f.startsWith("--job="))?.split("=")[1]?.split(",").filter(Boolean);
    const store = makeStore(local);
    console.log(`Drafting to: ${store.name}. Drafting never sends anything.`);
    await generate(cfg, store, jobIds, max);
    return;
  }
  if (command === "send") {
    await runSend({ cfg, store: makeStore(local), mailbox: gmailIfSetUp(), log });
    return;
  }
  if (command === "apply") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runApply({ cfg, store: makeStore(local), filler: new PlaywrightFiller(), ask: (q) => rl.question(q), max, log });
    } finally {
      rl.close();
    }
    return;
  }
  if (command === "replies") {
    await replies(cfg, makeStore(local), gmailIfSetUp());
    return;
  }
  if (command === "followup") {
    await runFollowups({ cfg, store: makeStore(local), mailbox: gmailIfSetUp(), log });
    return;
  }
  if (command === "daily") {
    // One step failing must not stop the others; each step checks the kill switch itself.
    const store = makeStore(local);
    const mailbox = gmailIfSetUp();
    const steps: [string, () => Promise<unknown>][] = [
      ["generate", () => generate(cfg, store)],
      ["send", () => runSend({ cfg, store, mailbox, log })],
      ["replies", () => replies(cfg, store, mailbox)],
      ["followup", () => runFollowups({ cfg, store, mailbox, log })],
    ];
    await warnGmailExpiry();
    let failed = 0;
    for (const [name, step] of steps) {
      log(`\n--- ${name} (${new Date().toISOString()})`);
      await step().catch((e) => {
        failed++;
        log(`${name} failed: ${e instanceof Error ? e.message : e}`);
      });
    }
    if (failed) process.exit(1);
    return;
  }
  if (command !== "fetch") {
    console.error("Usage: npm run fetch | generate | send | apply | replies | followup | daily | report   (add -- --local for out/ files)");
    process.exit(2);
  }

  const only = flags.find((f) => f.startsWith("--only="))?.split("=")[1];
  const kind: RunKind = only === "boards" || only === "ats" ? only : "all";
  const noAi = flags.includes("--no-ai");
  const store = makeStore(local);

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!noAi && !hasKey) console.log("ANTHROPIC_API_KEY is not set: jobs will be saved as 'unscored' (docs/SETUP-ISLAM.md A4/A6).");
  let scorer: Scorer | null = null;
  if (!noAi && hasKey) {
    // Board runs aren't urgent: Batch API at half price. ATS runs need speed: real time.
    scorer = kind === "boards" && cfg.limits.scoring.useBatchForBoards ? new BatchHaikuScorer(cfg) : new HaikuScorer(cfg);
  }

  console.log(`Run: ${kind}. Writing to: ${store.name}. No applications are sent in this phase.`);
  const summary = await runFetch({ cfg, store, get: makeHttpGet(cfg.sources), scorer, kind, log: (m) => console.log(m) });
  if (summary.stopped) return;

  console.log(`\n${summary.digest}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    await sendTelegram(summary.digest, token, chat).catch((e) => console.log(`Telegram digest failed: ${e instanceof Error ? e.message : e}`));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
