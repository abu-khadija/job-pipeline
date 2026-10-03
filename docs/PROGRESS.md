# Progress

## Phase 1 — built Oct 2, 2026 (code complete; waiting for Islam's keys)

Built on the work machine at Islam's request, **without any keys or accounts**: no Anthropic key,
no Google credentials, no remote, nothing pushed. Commits use a placeholder author
(`TODO_PERSONAL_GMAIL@users.noreply.github.com`); see "Move to the personal Mac" below.

### What works

- Fetchers for Himalayas (search, `country=EG`), Remote OK, Remotive, We Work Remotely.
- Normalizer to one `Job` schema: HTML/mojibake cleanup, salary → USD/month, location → Egypt eligibility,
  title priority, seniority, years required, ATS detection, apply email only if literally in the post.
- Hard filters (title, location, reject phrases, salary floor, senior + years, red flags, not remote, age),
  every drop has a reason in `filter_reasons`.
- Dedupe by company + title and by apply URL, against the store and within a run.
- Haiku scorer with structured output, no tools, post wrapped as untrusted data; code clamps and sums
  the points (a post cannot inflate its own score).
- Stores: Google Sheet (creates tabs `Jobs`, `Runs`, `Exceptions`, `Control`) and `--local` files in `out/`.
- Kill switch checked first; heartbeat row in `Runs` last; per-run caps on model calls and cost.
- GitHub Actions: `ci.yml` (typecheck + tests) and `fetch.yml` (06:00 and 14:00 UTC + manual).
- 246 unit tests, no network needed (184 at first build + recruiter changes).
- Live run (no AI): 642 fetched → 208 QA → 43 unique → 25 passed filters. Details in `SOURCES-VERIFIED.md`.

### Recruiter-advice changes (PLAN section 18) — built Oct 2, 2026

- Watchlist that grows by itself + Greenhouse/Lever/Ashby polling every 3 hours (`--only=ats`, `fetch-ats.yml`).
- Freshness weight 10, freshest-first scoring queue; new timezone factor; payroll restriction check.
- Gulf/MENA scope and Arabic bonus; Bayt/Wuzzuf as email alerts (no scraping).
- Tabs: `Filtered` (dropped rows), `Watchlist`, `Referrals` (80+); Sheet read by header name.
- Batch API for board runs, 5 parallel calls for ATS runs, cache-aware cost estimate, scoring prompt
  over Haiku's 4096-token caching minimum, cache tokens logged in `Runs`.
- Link check on newly shortlisted jobs; digest (console + optional Telegram to Islam's own chat);
  `npm run report` (reply rate by source / CV variant / score band).
- Review fixes: CV header ("Based in Egypt · Remote (US / EU time zones) · Contractor or EOR"),
  EOR-aware region phrases, no plain "contractor" EOR signal, Type B kept at least `maybe`.
- Live check (no AI): boards run 649 → 211 QA → 44 unique → 25 passed; watchlist looked up 15
  companies, found 2 boards (Sporty Group on Greenhouse, DualEntry on Ashby); ATS run read 113 jobs
  from them and merged duplicates with the job-board copies.

### Acceptance criteria (PLAN section 16)

- [x] `npm test` and `npm run typecheck` pass; tests cover section 14 incl. prompt injection.
- [x] `npm run fetch -- --local` produces `out/jobs.csv` from real sources.
- [x] `npm run fetch` writes to the Sheet — done on the personal Mac, Oct 3, 2026.
- [x] `STOP` makes the run exit immediately (tested, also via the CLI).
- [x] Running twice creates no duplicate rows (tested and checked live).
- [ ] GitHub Actions runs on schedule — private repo `abu-khadija/job-pipeline` + secrets set Oct 3, 2026;
  a manual `fetch-boards` run passed. Check that the first scheduled runs appear in the `Runs` tab.
- [x] `docs/PROGRESS.md` and `docs/SOURCES-VERIFIED.md` written.
- [x] Zero sending code exists.
- [ ] First AI-scored run reviewed (top 10 + cost) — run done Oct 3, 2026: 30 jobs scored for ~$0.13
  (5 shortlisted, 9 maybe, 12 low_score). Islam still has to review the top 10.
- [x] `cache_read_tokens` > 0 in the Runs tab after the first scored run (18,162 on Oct 3, 2026).

### Decisions to confirm (Islam)

1. **Remotive and the Telegram channel idea:** Remotive's terms forbid republishing its jobs to collect
   sign-ups. If the channel happens later, it must exclude Remotive data (and attribute Remote OK).
2. **"Hybrid QA" titles are kept.** "Hybrid" in a title usually means manual + automation; only a
   location saying hybrid/on-site drops a job.
3. **Senior titles asking 6+ years are dropped** (PLAN rule). Live data showed several "Senior QA" roles
   asking 7+ years. Change `maxYearsForSeniorTitles` in `config/targeting.yaml` to loosen it.
4. **New score weights** (PLAN section 18): role 25 · stack 20 · salary 15 · domain 10 · interview 10 ·
   freshness 10 · timezone 10. Thresholds unchanged (70 / 60, referrals 80). Tune after calibration.
5. **Watchlist lookups by company name** can occasionally match the wrong company on Lever/Ashby
   (no company name in their data; only exact name slugs are accepted). Wrong rows: set `active` to `no`.
6. **CV summary wording:** `docs/cv-master.md` summary says "built an AI test-case generator"; the
   profile rule says QAX is "designed and directed". Generation (Phase 2) will use "designed and directed".
7. **Supply is thin:** ~25 Egypt-eligible QA jobs per run today, almost all from Himalayas. Phase 1b
   sources and alert-email parsing should come right after Phase 2.
8. **Cost:** about $0.001–0.003 per job with caching and the Batch API (roughly $1–3/month at current volume).

### Move to the personal Mac

1. Copy the whole folder **except `node_modules/`** (or delete it first). `out/` is not needed.
2. On the personal Mac, inside the folder, set your personal identity for this repo and fix the author
   of the commits made here (replace with your personal name and Gmail):

   ```bash
   git config user.name "Islam Ibrahim Abu-Khadija"
   git config user.email "you@gmail.com"
   git rebase -r --root --exec "git commit --amend --no-edit --reset-author"
   ```

3. Create the private GitHub repo, `git remote add origin …`, `git push -u origin main`.
4. `npm install`, then `docs/SETUP-ISLAM.md` part A, then `npm run fetch -- --local` to see scored jobs.
5. Delete the folder from the work machine.

## Next: Phase 2 (dry-run only)

Generation (CV variant, cover letter, cold email with Sonnet), PDF CVs, the 8 safety gates with
known-bad test drafts, `Drafts` tab. See PLAN section 12. Needs the API key to try for real.
