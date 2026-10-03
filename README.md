# job-pipeline

Personal pipeline that finds remote QA jobs open to candidates in Egypt, filters and scores them,
and tracks them in a Google Sheet. **Phase 1: it sends nothing.**

Rules for working on this repo: `CLAUDE.md`. Full plan: `docs/PLAN.md`. Status: `docs/PROGRESS.md`.

## How it works

```
Kill switch → Fetch (Himalayas, Remote OK, Remotive, We Work Remotely)
→ keep QA-like titles → normalize to one Job shape → dedupe (vs Sheet and within the run)
→ hard filters (plain code) → score with Claude Haiku (judgement only; code adds the points)
→ write rows to the Sheet → heartbeat row in Runs
```

## Run it

```bash
npm install
npm test                          # all tests, no network
npm run typecheck
npm run fetch -- --local --no-ai  # real sources, no AI, results in out/jobs.csv
npm run fetch -- --local          # + Haiku scoring (needs ANTHROPIC_API_KEY in .env)
npm run fetch                     # writes to the Google Sheet (needs SHEET_ID + Google key)
```

Set up keys first: `docs/SETUP-ISLAM.md`. Copy `.env.example` to `.env`.

## Stop everything

Put `STOP` in cell `Control!B1` of the Sheet (or `"killSwitch": "STOP"` in `out/control.json`
for `--local`). Any other value than `RUN` also stops it.

## Tuning (no code changes needed)

| What | Where |
| --- | --- |
| Job titles, location words, red flags, salary floor, max age | `config/targeting.yaml` |
| Score weights and thresholds (apply ≥ 70, maybe 60–69) | `config/scoring.yaml` |
| Sources, search terms, pages | `config/sources.yaml` |
| Models, prices, run cost cap, exchange rates | `config/limits.yaml` |
| What Haiku is asked to judge | `prompts/score.md` |
| Facts about Islam | `docs/master-profile.md` |

## Statuses in the Jobs tab

`filtered_out` (see `filter_reasons`) · `unscored` (no API key yet, or run cap reached; retried next run)
· `score_error` · `low_score` · `maybe` · `shortlisted`. Later phases add `drafted`, `held`, `applied`, ….
You can edit `status` and `notes` by hand; runs keep your edits.

## Sources and their terms

Job data comes from Himalayas, [Remote OK](https://remoteok.com), [Remotive](https://remotive.com) and
We Work Remotely. Each row links back to the original listing. Data is used only for Islam's own
applications and is not republished. Details: `docs/SOURCES-VERIFIED.md`.
