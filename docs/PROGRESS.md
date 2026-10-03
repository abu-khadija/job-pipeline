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

## Phase 2 — built Oct 3, 2026 (drafts only, nothing is sent)

Islam asked to start applying right away, so Phase 2 was built before the exam ends. Islam applies
by hand from the drafts; there is still no sending code.

- `npm run generate`: every `shortlisted` job without a draft → read the post again from the sources
  (descriptions are not kept in the Sheet) → Sonnet writes a CV summary, cover letter and cold email →
  code gates → Sonnet fact check → one retry with the reasons → `Drafts` tab + `out/drafts/<company>/`
  (`Islam-Abu-Khadija-CV.pdf`, `cover-letter.txt`, `email.txt`, `job-post.txt`).
- The PDF CV is `docs/cv-master.md` word for word with only the Summary replaced (fact-checked).
  Rendered with Playwright Chromium (`npx playwright install chromium` once per machine).
- Gates: 1 fact check (model maps each claim to the profile) · 2 banned words/claims, numbers not in the
  profile, ticket ids, AI-built work called hand-written, em dashes, salary, work authorization, word
  counts (`config/writing.yaml`) · 3 company + role named · 4 one draft per company per 60 days ·
  6 route (email only if literally in the post, else form/link) · 8 kill switch. Gates 5 (daily cap)
  and 7 (form questions) are recorded as "checked at send time" until Phases 3–4.
- Signature (name, phone, email, LinkedIn) is added by code after the gates, from `master-profile.md`.
- 42 new tests, including 14 known-bad drafts that must fail gate 2. 288 tests in total.
- First real run: 5 shortlisted jobs → 5 drafts, 0 held, ~$0.50.

Decisions to confirm (Islam):

9. **Real-time calls, not the Batch API**, for generation: only a few drafts per run, and Islam wants
   them now. Switch later if volume grows.
10. **Generation runs on the Mac, not in GitHub Actions:** the PDFs are local files and the service
    account cannot store files in personal Drive.
11. **Held or missing posts are not retried automatically.** Delete the Drafts row and set the Jobs
    status back to `shortlisted` to redraft.

## Phases 3–5 — built Oct 3, 2026 (code done; live sending needs Islam's Gmail sign-in + switch)

Islam asked for all phases now. Everything runs on the Mac (the PDFs live there).

- **Phase 3, email (`npm run send`):** ready drafts whose post literally gave an address. Before each
  send: kill switch, `Control!B2 = live` AND `DRY_RUN=false`, 07–19 UTC, 15/day and 3 per run, one per
  company per 60 days (Deel 3). Gmail API with the PDF CV attached; `Sent` tab (new), Drafts `sent`,
  Jobs `applied`. Dry run (default) only lists what it would send.
- **Phase 4, forms (`npm run apply`):** live check found a CAPTCHA on all three ATSs (Greenhouse and
  Ashby: invisible reCAPTCHA; Lever: hCaptcha). The pipeline never gets past CAPTCHAs, so it does not
  submit forms. Instead it opens each form in a visible browser, follows Himalayas "Apply" links to the
  company page, fills every field it can from `master-profile.md` (CV and cover-letter PDFs uploaded),
  colours fields green/yellow/red, and Islam presses Submit and types `s`. Tested on live Greenhouse
  (GitLab), Lever (Spotify) and Ashby (Ramp) forms without submitting: all standard fields filled;
  only visa, employment-agreement and custom questions left red.
- **Phase 5 (`npm run replies`, `npm run followup`):** replies read via Gmail (read-only), by thread for
  emails and by company name for forms; Haiku sorts invite / reject / question / other; invites get a
  Sonnet prep pack (`out/prep/`) and an alert email to Islam's own address (+ Telegram if set). One
  follow-up in the same thread after 6 days without a real reply (auto-receipts don't count).
- `npm run daily` = generate → send → replies → followup; `scripts/install-mac-schedule.sh` runs it
  hourly with launchd (not installed: Islam decides).
- 33 new tests (send rules, MIME/header injection, form answers incl. labels from the live forms, all
  four runs with fakes). 321 tests in total.

What Islam must do to go live: SETUP B2 (Gmail sign-in, ~15 min), then B4 (both switches), optionally B5.

Decisions to confirm (Islam):

12. **Forms are filled, not submitted**, because of the CAPTCHAs (see above).
13. **Form answers marked "check"**: "previously worked at X?" → No, years of experience → 3,
    salary → top of posted range else 3,500 USD/month, notice → 30 days. Visa/sponsorship and
    employment-agreement questions are always left to Islam.
14. **The `Sent` tab replaces the planned `Contacts` tab** (same job: caps and per-company limits).
15. **Exceptions in dry runs:** none are written by `send` any more; forms are all handled in `apply`.

## Egypt eligibility fix — Oct 3, 2026

Problem Islam found: 3 of the first 5 "Egypt-eligible" jobs were not open to Egypt.
Root cause: Himalayas returns every job with NO country list for `country=EG`, and our code read an
empty list as "worldwide". TransPerfect (15 countries, no Egypt) and zvoove (Germany/Austria
employees) came in this way.

- Empty country list = unknown, never worldwide. A Gulf/MENA verdict needs the whole list to be
  Gulf/MENA (Morocco among 14 other countries is just a country list).
- **Company-site check** (`src/verify/`): before a job is shortlisted, it is looked up on the
  company's own Recruitee / Personio / Greenhouse / Lever / Ashby / Workable board by name. That
  site's locations decide: not Egypt → dropped with the reason; found → the company's own apply link
  replaces the job board's (no more Himalayas paywall). One country next to a remote job is read as
  the office (The Codest: Poland); a region ("Europe") or a list is a real limit.
- German permanent-employment phrases added to `rejectRegion` (DE/AT, Festangestellte, …).
- A job that never says where it hires is shortlisted only at score ≥ 80
  (`scoring.yaml → unclearLocationMinScore`), and its letter adds one sentence: based in Egypt,
  contractor or EOR (Deel), US and EU time zones.
- `npm run verify` re-checks jobs already in the Sheet. First run: TransPerfect and zvoove moved
  to Filtered; Codest recorded as applied (Islam applied by hand).
- **New source: Built In** (`country=EGY` QA pages). Each job page states its allowed countries in
  schema.org data, so "open to Egypt" comes from the company. Storyteller's QA job was listed there.
  robots.txt allows these pages; search and pagination are disallowed, so supply is ~15-20 jobs.
- Checked and not added: Jobicy (filters return Europe-only, non-QA jobs), Working Nomads (6 QA
  jobs, none relevant), Jobgether (403 to automated requests).

Decisions to confirm (Islam):

16. **Salary floor lowered to 1,800 USD/month** (Islam, Oct 3), so roles like Storyteller (≈1,800)
    pass. Higher pay stays the priority: 1,800–1,999 earns 4 salary points, below an unstated
    salary (7) and every tier from 2,000 up.
17. **LinkedIn / Wuzzuf job-alert emails** are the biggest untapped source of jobs that say
    "Egypt (Remote)". Gmail read access now exists; the parser needs real alert emails to be built from.

## Next: calibration

Islam reads the drafts and writes comments in Drafts `notes`; prompts and `config/writing.yaml` are
tuned from them.
