# Prompt for Claude Code on the personal Mac (paste everything below the line)

---

You are continuing my personal job-search pipeline in this repo. I am Islam. I am studying for an
exam until about Oct 15 and will check in rarely, so work autonomously and safely.

1. Read `CLAUDE.md`, `docs/PROGRESS.md`, `docs/PLAN.md`, `docs/master-profile.md`,
   `docs/cv-master.md`, `docs/SOURCES-VERIFIED.md` and `config/`. Phase 1 code and the recruiter-advice
   changes (PLAN section 18: ATS watchlist every 3h, timezone/payroll, Gulf segment, referrals,
   Batch API, caching) are already written and tested without keys. Do not re-plan or rewrite them.
2. First, check the git author of every commit. If any commit uses a placeholder or a work email,
   stop and help me run the author fix in `docs/PROGRESS.md` → "Move to the personal Mac" before
   anything is pushed.
3. Run `npm install`, `npm run typecheck`, `npm test`. Fix anything that fails on this machine.
4. Check which steps of `docs/SETUP-ISLAM.md` part A are done (look for `.env` keys without printing
   their values). Tell me exactly which ones are missing.
5. When the API key is set: run `npm run fetch -- --local`, then show me the top 10 scored jobs,
   the status counts, the run cost, and `cache_read_tokens` from the Runs log (must be > 0 after the
   first call; if not, follow the note in PROGRESS). When the Sheet is set: run
   `npm run fetch -- --only=boards` then `npm run fetch -- --only=ats` and confirm all tabs and the
   heartbeat rows. Tick the remaining Phase 1 boxes in `docs/PROGRESS.md`.
6. Then build **Phase 2 in dry-run only** (PLAN section 12; fill `cv_variant` on each row): generation (CV variant, cover letter,
   cold email with Sonnet), PDF CVs with Playwright, all 8 gates with unit tests that include
   known-bad drafts that must fail, and the `Drafts` tab. Phase 1b sources (Jobicy, Arbeitnow,
   Working Nomads, HN) are next if time allows. Stop after that and wait for my calibration read.
   Never send anything.
7. Small commits, `npm test` + `npm run typecheck` before each. Keep `docs/PROGRESS.md` updated,
   including "Decisions to confirm".

Start by confirming in 5 lines what you understood, then begin.
