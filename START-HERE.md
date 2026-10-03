# START HERE — ابدأ من هنا

## بالعربي (لإسلام)

**الحالة:** Phase 1 اتبنت واتختبرت (184 تيست ناجحين)، من غير أي مفاتيح ولا حسابات، ومفيش أي حاجة اترفعت.
التفاصيل في `docs/PROGRESS.md`.

**خطوات النقل للماك الشخصي:**
1. انسخ الفولدر كله **من غير** `node_modules` (امسحه الأول، حجمه كبير وبيتعمل تاني بـ `npm install`).
   استخدم فلاشة أو Google Drive شخصي. **متستخدمش** OneDrive أو إيميل أو Slack بتوع الشغل.
2. على الماك الشخصي، جوه الفولدر، غيّر صاحب الـ commits لإيميلك الشخصي (الأوامر في
   `docs/PROGRESS.md` → "Move to the personal Mac"). Claude Code هيساعدك فيها.
3. اعمل repo خاص على GitHub الشخصي وارفع عليه.
4. اعمل الجزء A من `docs/SETUP-ISLAM.md` (حوالي 45 دقيقة).
5. افتح Claude Code بحسابك الشخصي جوه الفولدر، والصق محتوى `FIRST-PROMPT.md`.
6. امسح الفولدر من لابتوب الشغل.

**مفيش أي إرسال لحد ما إنت تقرا الـ calibration بعد الامتحان.**

## Files

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Permanent rules for every Claude Code session in this repo. |
| `FIRST-PROMPT.md` | Paste this into Claude Code on the personal Mac. |
| `README.md` | How to run, stop and tune the pipeline. |
| `docs/PROGRESS.md` | What is built, what is left, decisions to confirm, how to move the repo. |
| `docs/PLAN.md` | Full technical plan: architecture, schema, sources, filters, scoring, gates, phases. |
| `docs/SOURCES-VERIFIED.md` | What each job source really returns, its limits and terms. |
| `docs/master-profile.md` | The ONLY source of facts about Islam. |
| `docs/cv-master.md` | The fixed master CV text. |
| `docs/SETUP-ISLAM.md` | Accounts and keys Islam sets up by hand. |
| `docs/ROADMAP-AFTER-PIPELINE.md` | Interviews, platforms and side-income decisions (not for the build). |
| `config/*.yaml` | Targeting, scoring, sources and limits. Edit these, not code. |
| `src/`, `tests/`, `prompts/` | The code, 184 tests with real saved responses, and the scoring prompt. |
