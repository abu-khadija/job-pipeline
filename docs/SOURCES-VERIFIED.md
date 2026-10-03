# Sources — verified Oct 2, 2026

Checked by calling each endpoint live. Saved samples are in `tests/fixtures/`.

| Source | Endpoint used | Limits / terms | Quirks |
| --- | --- | --- | --- |
| Himalayas | `https://himalayas.app/jobs/api/search?q=…&country=EG&sort=recent&offset=…` | Fixed 20 jobs per page (`limit` is ignored). The plain feed `/jobs/api` has ~99k jobs and moved to cursor pagination (`?cursor=`; `offset` is deprecated there). | `country=EG` returns only jobs open to Egypt (~109 for "qa"), which is the best eligibility signal of all sources. `locationRestrictions: []` = worldwide. Salaries: `minSalary`/`maxSalary` + `salaryPeriod` + `currency`. `pubDate` is Unix seconds. Search pagination is offset-based; the search endpoint returns no cursor. |
| Remote OK | `https://remoteok.com/api` | Terms: link back to the Remote OK job URL (followed link) and mention Remote OK as the source, or API access is suspended. Don't use their logo. | First array element is the legal notice. Returns the latest ~100 jobs only, few QA. `salary_min`/`salary_max` are yearly USD. `location` is free text and often "Remote" or empty. Descriptions arrive with broken UTF-8 (mojibake); `fixMojibake()` repairs it. |
| Remotive | `https://remotive.com/api/remote-jobs?category=qa` and `?search=test automation` | Max ~4 requests per day (excess is blocked). Link back + mention Remotive. Jobs are delayed 24h. **Their terms forbid republishing jobs to collect sign-ups/emails** — so the "Telegram jobs channel" idea must not use Remotive data. | `category=qa` exists but is loosely labelled (returned developer and support roles). `candidate_required_location` is a comma list ("USA, Canada", "Worldwide", "Northern America, LATAM, Europe, APAC"). `publication_date` has no timezone (UTC). |
| We Work Remotely | `https://weworkremotely.com/remote-jobs.rss` + 4 category feeds | No published API limits; RSS. | The main feed has ~10 jobs per category. There is **no QA category**, so QA jobs are rare here. `<title>` is "Company: Job title". `<region>` is the useful field ("Anywhere in the World", "Europe", "Remote - Americas"); `<country>` is the company HQ, not a requirement. |

## Company ATS boards (watchlist)

| ATS | Endpoint | Behaviour |
| --- | --- | --- |
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | 404 for unknown slugs. `content` is HTML **escaped** (`&lt;p&gt;`), decoded before cleanup. Has `company_name` (used to confirm a name lookup) and `first_published`. Location is free text. Note: slug ≠ company sometimes (`remote` is General Assembly), hence the name check. |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json` | 404 for unknown slugs. No company name in the data. `workplaceType` (remote/hybrid/onsite), `categories.allLocations`, `createdAt` (ms), sometimes `salaryRange`. `limit`/`skip` work. |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | 404 for unknown slugs; a real board with no openings returns `{"jobs": []}`. `isRemote`, `workplaceType`, `location` + `secondaryLocations`, `publishedAt`, compensation summary text. |

Most companies found on Himalayas use other systems (Workable, BambooHR, own pages): in the first
live run 2 of 15 looked-up companies had a Greenhouse/Lever/Ashby board (Sporty Group, DualEntry).

## First live results (Oct 2, 2026, no AI scoring)

- 642 jobs fetched (Himalayas 303 across 6 queries, Remote OK 99, WWR 240; Remotive skipped to respect its daily limit).
- 208 had QA-like titles → **43 unique** after dedupe → 25 passed the hard filters, 18 filtered out (too old, senior roles asking 7+ years, skipped titles, US-only).
- Almost all useful jobs came from Himalayas. Supply of Egypt-eligible remote QA jobs is limited, so Phase 1b sources (Jobicy, Arbeitnow, Working Nomads, HN) and the alert-email parsers matter.

## Phase 1b (not built yet)

Jobicy, Arbeitnow, Working Nomads, Hacker News "Who is hiring". Verify each the same way before adding.
