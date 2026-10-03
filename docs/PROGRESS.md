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
- 184 unit tests, no network needed.
- Live run (no AI): 642 fetched → 208 QA → 43 unique → 25 passed filters. Details in `SOURCES-VERIFIED.md`.

### Acceptance criteria (PLAN section 16)

- [x] `npm test` and `npm run typecheck` pass; tests cover section 14 incl. prompt injection.
- [x] `npm run fetch -- --local` produces `out/jobs.csv` from real sources.
- [ ] `npm run fetch` writes to the Sheet — **code done, not run yet: needs SETUP A4–A6.**
- [x] `STOP` makes the run exit immediately (tested, also via the CLI).
- [x] Running twice creates no duplicate rows (tested and checked live).
- [ ] GitHub Actions runs on schedule — **needs the private repo + secrets (SETUP A3, A7).**
- [x] `docs/PROGRESS.md` and `docs/SOURCES-VERIFIED.md` written.
- [x] Zero sending code exists.
- [ ] First AI-scored run reviewed (top 10 + cost) — **needs the API key.**

### Decisions to confirm (Islam)

1. **Remotive and the Telegram channel idea:** Remotive's terms forbid republishing its jobs to collect
   sign-ups. If the channel happens later, it must exclude Remotive data (and attribute Remote OK).
2. **"Hybrid QA" titles are kept.** "Hybrid" in a title usually means manual + automation; only a
   location saying hybrid/on-site drops a job.
3. **Senior titles asking 6+ years are dropped** (PLAN rule). Live data showed several "Senior QA" roles
   asking 7+ years. Change `maxYearsForSeniorTitles` in `config/targeting.yaml` to loosen it.
4. **CV summary wording:** `docs/cv-master.md` summary says "built an AI test-case generator"; the
   profile rule says QAX is "designed and directed". Generation (Phase 2) will use "designed and directed".
5. **Supply is thin:** ~25 Egypt-eligible QA jobs per run today, almost all from Himalayas. Phase 1b
   sources and alert-email parsing should come right after Phase 2.
6. **Prompt caching:** the scoring system prompt (~2.5k tokens) may be below Haiku's minimum cacheable
   size, so caching may not kick in. Cost is still small (about $0.002–0.004 per job).

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
