# Homework Notifier

Mon–Fri every hour from 2 to 8 PM, and Sat/Sun at 10 PM, this checks the Yuvabharathi ERP for **today's**
**homework and circulars** from your own computer and sends them to Telegram (or WhatsApp):

- a screenshot of each new homework's or circular's details popup (the 👁 icon), plus any linked Google Doc / Slides / Sheet as a PDF
  (long circulars are split into parts so they stay readable)
- each item only once; it logs out after every check
- **2–7 PM checks stay quiet when there's nothing new** (so an early check never says "nothing today" by mistake)
- **8 PM final check always sends a summary** (weekends: the 10 PM check):
  `✅ Final check, 8:00 PM, Tue (10-11-2026): No homework. Circulars (2): PTM Regarding; Children's Day - Dress code.`
  If this message doesn't arrive, the computer was off/asleep or the scheduler stopped.
- anything posted **after** the 8 PM check is sent at the next day's first check, marked "posted late"
- if something breaks (wrong password, site changed), you get a ⚠️ message on Telegram

Your password stays on your computer in the `.env` file. It is never sent to Telegram.

## Setup (about 15 minutes)

### 1. Create the Telegram bot (on your phone)
1. In Telegram, open **@BotFather** (blue tick) → **Start** → send `/newbot`.
2. Name: e.g. `Abhay Homework`. Username: anything ending in `bot`, e.g. `abhay_hw_bot`.
3. Copy the **token** it gives you. You'll paste it in step 3.

### 2. Install Node.js
Download the **LTS** version from <https://nodejs.org> and install with the default options.

### 3. Run the setup
Unzip this folder into your **home folder** (e.g. `C:\Users\<you>\homework-notifier` or
`/Users/<you>/homework-notifier`). On Mac, avoid Desktop/Documents/Downloads — macOS blocks background
jobs from reading those.

**Windows:** right-click `setup-windows.ps1` → **Run with PowerShell**.
If Windows blocks it, open PowerShell in the folder and run:
`powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1`

**Mac:** open Terminal and run: `bash ~/homework-notifier/setup-mac.sh`

The setup will:
1. install what it needs (a few minutes)
2. ask for the school username, password and bot token (typing is hidden)
3. ask you to press **Start** on your bot in Telegram, then find your chat automatically
   (for both parents: add the bot to a family group and say "hi" there before pressing Enter)
4. send a ✅ test message to Telegram
5. test the school login without sending anything
6. schedule it for Mon–Fri every hour 2–8 PM and Sat/Sun at 10 PM

## WhatsApp instead of Telegram
See **WHATSAPP-SETUP.md** (free Meta test number, no SIM needed). Telegram then only gets ⚠️ error alerts.

## Check another day
Open a terminal in the folder and run, for example:

    node src/notify.js friday        (most recent Friday; any weekday name works)
    node src/notify.js yesterday
    node src/notify.js 06-11-2026    (or 06-11 for this year)

It sends everything posted for that day to Telegram. Add `--test` to only save the screenshots to the
`out` folder without sending. Manual checks don't change what the scheduler remembers.

## Not getting messages?
Open a terminal in the folder and run:

    node src/doctor.js

It checks Node.js, your settings, the Telegram bot and the schedule, sends a test message,
and tells you exactly what to fix.

## Good to know
- The computer must be **on and logged in**. If it was asleep/off at a scheduled time, the check runs when it wakes up,
  and nothing is sent twice.
- Activity log: `run.log` in the folder.
- **Run a check now:** Windows → Task Scheduler → "Homework notifier" → Run. Mac → `launchctl start com.homework.notifier`
- **Changed the school password?** Run `node src/setup.js` in the folder again.
- **Stop it:** Windows → Task Scheduler → delete "Homework notifier".
  Mac → `launchctl unload ~/Library/LaunchAgents/com.homework.notifier.plist`
- **Test with a past date without sending:** `node src/notify.js 21-08-2026 --test` saves files to `out/`.
