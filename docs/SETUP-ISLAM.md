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
- [ ] **B2. Connect Gmail with an App Password (about 3 minutes, never expires).** This replaces the old OAuth setup. It needs 2-Step Verification on the account.
  1. Turn on 2-Step Verification: myaccount.google.com/signinoptions/two-step-verification
  2. Create an app password: myaccount.google.com/apppasswords → name it `job-pipeline` → copy the 16 letters.
  3. In the repo run `npm run gmail:connect`, paste the 16 letters when asked (they are not shown in chat). It logs in over SMTP + IMAP to check them, then saves `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` to `.env`.
  4. For the cloud (Mac off), add `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` to GitHub Secrets too.
  App passwords do not expire, so this is done once. No OAuth consent screen, no app publishing, no verification.

- [ ] **B3. Job alerts to that Gmail.** Create alerts on LinkedIn, Wellfound, Jobgether, EU Remote Jobs, Remote Rocketship, Built In, Welcome to the Jungle, using the P1/P2 titles in `config/targeting.yaml`, remote, worldwide/EMEA. Also **Bayt** and **Wuzzuf** (Gulf/Egypt market): remote QA, foreign-currency pay.
- [ ] **B3b. LinkedIn profile** (recruiter advice, ~15 min): headline and Open to Work as in `docs/ROADMAP-AFTER-PIPELINE.md`.
- [ ] **B4. Go-live approval.** Only after B1–B2: set `Control!B2` to `live` in the Sheet AND `DRY_RUN=false` in `.env`. Both are needed; caps apply automatically (15/day, 3 per hourly run, 07:00–19:00 UTC Monday–Friday, one per company per 60 days).
- [ ] **B5. Hourly runs on the Mac (optional).** `zsh scripts/install-mac-schedule.sh` runs `npm run daily` every hour (drafts, email sends, replies, follow-ups). The Mac must be awake. Remove it with the command at the top of that script.
- **Forms:** run `npm run apply` when you sit down. It opens each form in a browser and fills it (green = filled, yellow = check, red = you answer). You press Submit, then type `s` in the terminal.

## Part C — by hand, never automated

- Accounts and skills tests on Turing, Andela, Arc.dev, Crossover, Proxify, Index.dev, Remotebase, Braintrust, Mercor, Toptal, X-Team, and the AI-training platforms. Claude can prepare profile text and answers; you submit.
- Upwork / Contra proposals: the pipeline can draft; you press send.
- Anything in the `Exceptions` tab (CAPTCHAs, account-required portals, custom questions). Weekly, about 5 minutes.
