# Setup — things only Islam does

Do everything on the **personal Mac** with **personal accounts**. Never paste keys into a chat.
Claude Code can walk you through any step: just say "help me with step A4".

## Part A — before the build (about 45 minutes, do it now)

- [ ] **A1. Personal Mac tools.** Install Homebrew, then `brew install node@22 git gh`. Install Claude Code and sign in with your **personal** Claude Pro account.
- [ ] **A2. No global API key.** Run `echo $ANTHROPIC_API_KEY` in Terminal. It must print nothing. If it prints a key, remove it from `~/.zshrc` / `~/.bash_profile`. Otherwise Claude Code bills the API instead of your Pro plan.
- [ ] **A3. GitHub repo.** On your personal GitHub, create a **private** repo `job-pipeline`. Clone it, copy this whole handoff folder's contents into it (so `CLAUDE.md` is at the root), commit, push.
- [ ] **A4. Anthropic API key.** At console.anthropic.com with your **personal** account: add billing, set a **monthly spend limit of 50 USD**, and create an API key named `job-pipeline`. Keep it for A6.
- [ ] **A5. Google Sheet + service account.**
  1. console.cloud.google.com with your **personal** Google account: create project `job-pipeline`.
  2. Enable **Google Sheets API**.
  3. IAM & Admin → Service Accounts → create `pipeline-bot`. Keys → Add key → JSON. A file downloads.
  4. In your personal Google Drive, create a blank Sheet called `Job Pipeline`.
  5. Share it with the service account email (looks like `pipeline-bot@job-pipeline.iam.gserviceaccount.com`) as **Editor**.
  6. Copy the Sheet ID from its URL (the long part between `/d/` and `/edit`).
- [ ] **A6. Local `.env`.** In the repo, copy `.env.example` to `.env` (Claude Code creates the example) and fill:
  `ANTHROPIC_API_KEY`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` (path to the JSON file; keep that file **outside** the repo, for example `~/.secrets/job-pipeline-sa.json`). Leave `DRY_RUN=true`.
- [ ] **A7. GitHub Secrets.** Repo → Settings → Secrets and variables → Actions: add `ANTHROPIC_API_KEY`, `SHEET_ID`, and `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the whole JSON file content).
- [ ] **A8. Personal Gmail.** Decide which personal Gmail address you'll use for job search. Replace `TODO_PERSONAL_GMAIL` in `docs/master-profile.md` and `docs/cv-master.md`. (Can wait until calibration, but nothing can be sent without it.)

- [ ] **A9. (Optional) Telegram digest.** In Telegram, talk to @BotFather → `/newbot` → copy the token. Send any message to your new bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `chat.id`. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` and in GitHub Secrets. You get the top 5 new jobs + heartbeat after every run.

Then open Claude Code in the repo and paste `FIRST-PROMPT.md`.

## Part B — after the exam (~Oct 16, about 1.5 hours)

- [ ] **B1. Calibration read (20 min).** Open the `Drafts` tab, read 20 drafts, write comments in the `notes` column. Tell Claude Code: "read my calibration notes and tune the prompts/config".
- [ ] **B2. Gmail API.** Same Google Cloud project: enable **Gmail API**; OAuth consent screen → External → add yourself as a user; create an OAuth client of type **Desktop app**; run the auth helper Claude Code builds (`npm run gmail:auth`) to get a refresh token; add `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` to `.env` and GitHub Secrets.
  Note: while the consent screen is in "Testing" status, Google refresh tokens expire after about 7 days. Ask Claude Code to check the current rule and how to avoid it for a personal app.
- [ ] **B3. Job alerts to that Gmail.** Create alerts on LinkedIn, Wellfound, Jobgether, EU Remote Jobs, Remote Rocketship, Built In, Welcome to the Jungle, using the P1/P2 titles in `config/targeting.yaml`, remote, worldwide/EMEA. Also **Bayt** and **Wuzzuf** (Gulf/Egypt market): remote QA, foreign-currency pay.
- [ ] **B3b. LinkedIn profile** (recruiter advice, ~15 min): headline and Open to Work as in `docs/ROADMAP-AFTER-PIPELINE.md`.
- [ ] **B4. Go-live approval.** Only after B1–B2: set `Control!B2` to `live` and `DRY_RUN=false`. Caps apply automatically.

## Part C — by hand, never automated

- Accounts and skills tests on Turing, Andela, Arc.dev, Crossover, Proxify, Index.dev, Remotebase, Braintrust, Mercor, Toptal, X-Team, and the AI-training platforms. Claude can prepare profile text and answers; you submit.
- Upwork / Contra proposals: the pipeline can draft; you press send.
- Anything in the `Exceptions` tab (CAPTCHAs, account-required portals, custom questions). Weekly, about 5 minutes.
