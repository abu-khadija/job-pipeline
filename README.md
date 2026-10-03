# job-pipeline

Personal pipeline that finds remote QA jobs open to candidates in Egypt, filters and scores them,
and tracks them in a Google Sheet. **Phase 1: it sends nothing.**

Rules for working on this repo: `CLAUDE.md`. Full plan: `docs/PLAN.md`. Status: `docs/PROGRESS.md`.

## How it works

```
Kill switch → Fetch: job boards (2x/day) or watchlist ATS boards (every 3h)
→ keep QA-like titles → normalize to one Job shape → dedupe (vs Sheet and within the run)
→ hard filters (plain code) → score with Claude Haiku, freshest first (judgement only; code adds the points)
→ link check on new shortlisted jobs → grow the watchlist → referral targets (80+)
→ write tabs → heartbeat row in Runs → digest (console, optional Telegram to yourself)
```

Tabs: `Jobs` (useful rows) · `Filtered` (dropped, with reasons) · `Watchlist` (company ATS boards;
set `active` to `no` to stop one) · `Referrals` (strong jobs to find a referral for by hand) ·
`Runs` (heartbeat, tokens, cost) · `Exceptions` · `Control` (kill switch).

## Run it

```bash
npm install
npm test                          # all tests, no network
npm run typecheck
npm run fetch -- --local --no-ai  # real sources, no AI, results in out/jobs.csv
npm run fetch -- --local          # + Haiku scoring (needs ANTHROPIC_API_KEY in .env)
npm run fetch                     # writes to the Google Sheet (needs SHEET_ID + Google key)
npm run fetch -- --only=boards    # job boards only (Batch API scoring, half price)
npm run fetch -- --only=ats       # watchlist ATS boards only (real-time scoring)
npm run report                    # reply rate by source / CV variant / score band
```

Set up keys first: `docs/SETUP-ISLAM.md`. Copy `.env.example` to `.env`.

## Stop everything

Put `STOP` in cell `Control!B1` of the Sheet (or `"killSwitch": "STOP"` in `out/control.json`
for `--local`). Any other value than `RUN` also stops it.

## Tuning (no code changes needed)

| What | Where |
| --- | --- |
| Job titles, location words, red flags, salary floor, max age | `config/targeting.yaml` |
| Score weights and thresholds (apply ≥ 70, maybe 60–69, referral ≥ 80) | `config/scoring.yaml` |
| Sources, search terms, pages, watchlist seeds | `config/sources.yaml` |
| Models, prices, batch/concurrency, run cost cap, exchange rates | `config/limits.yaml` |
| What Haiku is asked to judge | `prompts/score.md` |
| Facts about Islam | `docs/master-profile.md` |

## Statuses in the Jobs tab

`filtered_out` (see `filter_reasons`) · `unscored` (no API key yet, or run cap reached; retried next run)
· `score_error` · `low_score` · `maybe` · `shortlisted` · `closed` (listing gone). Later phases add `drafted`, `held`, `applied`, ….
You can edit `status` and `notes` by hand; runs keep your edits.

## Sources and their terms

Job data comes from Himalayas, [Remote OK](https://remoteok.com), [Remotive](https://remotive.com),
We Work Remotely, and companies' public Greenhouse / Lever / Ashby boards. Each row links back to the original listing. Data is used only for Islam's own
applications and is not republished. Details: `docs/SOURCES-VERIFIED.md`.
