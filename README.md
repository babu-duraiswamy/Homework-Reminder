# Homework Notifier

Fetches **homework** and **circulars** from the Yuvabharathi ERP and sends anything new to WhatsApp
(both numbers; if WhatsApp fails for any number, a copy goes to Telegram).

**It runs on GitHub Actions — see GITHUB-SETUP.md.** The schedule (India time):

| When | What |
|---|---|
| Mon–Sat 2, 3, 4, 5, 7 PM | Homework |
| Mon–Sat 6 PM | Homework + circulars |
| Mon–Sat 8 PM | Homework + circulars + daily summary |
| Sunday 10 PM | Everything + summary |

- Every homework and circular is sent **once**, individually: a screenshot of its details, plus linked
  Google Docs / Sheets / Slides / PDFs as PDF files.
- Skipped: weekly food-menu circulars (`CIRCULAR_SKIP` in `.env`), and non-document links (apps, forms, videos).
- Anything posted after the 8 PM check is sent at the next day's first check, marked "posted late".
- The 8 PM summary always comes ("No homework today" or the list) and is also copied to Telegram.

Your password stays on your computer in the `.env` file. It is never sent to Telegram.

## Setting it up
1. **Telegram bot** (for failure copies and ⚠️ alerts) and **WhatsApp** (Meta test number + templates):
   see **WHATSAPP-SETUP.md**. On a computer with Node.js you can create the settings file with
   `node src/setup.js` (school login + Telegram) and then `node src/setup-whatsapp.js`.
2. **GitHub Actions** (runs everything on schedule, computer can be off): see **GITHUB-SETUP.md**.

## More than one WhatsApp number
List them in the settings as `WA_TO="91XXXXXXXXXX,91YYYYYYYYYY"` (10-digit numbers also work).
Each must be verified on Meta (developers.facebook.com → your app → WhatsApp → "Try it out" → recipient list).
Every message goes to all of them; if any number fails, a copy goes to Telegram.

## Checking by hand
On GitHub: **Actions → School notifier → Run workflow**. Or on a computer with the folder set up:

    node src/notify.js                         everything for today (+ summary)
    node src/notify.js --homework              homework only
    node src/notify.js friday                  everything posted on the last Friday
    node src/notify.js 06-11-2026 --test       save screenshots to ./out, send nothing
    node src/notify.js friday --to=98XXXXXXXX  WhatsApp to that number only

Checking another day sends everything for that day and doesn't change what's remembered as sent.

## Not getting messages?
- `node src/doctor.js` — checks settings, Telegram, WhatsApp token and templates, sends test messages.
- `node src/check-templates.js` — shows whether each WhatsApp template is approved and set up correctly.
- `node src/test-whatsapp.js 98XXXXXXXX` — sends one test to one number and shows Meta's exact answer.
- On GitHub: open the failed run → **check** → read the "Check the school app" step.

## Settings (`.env`, or the `ENV_FILE` secret on GitHub)
| Setting | Meaning |
|---|---|
| `SCHOOL_USER`, `SCHOOL_PASS` | school ERP login |
| `SENDER="whatsapp"` | send to WhatsApp (without it, everything goes to Telegram) |
| `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_TO`, `WA_TEMPLATE_LANG` | WhatsApp (filled in by `setup-whatsapp.js`) |
| `TG_BOT_TOKEN`, `TG_CHAT_ID` | Telegram bot and your chat |
| `CIRCULAR_SKIP` | optional: circular titles to ignore, default `\bmenu\b` |
