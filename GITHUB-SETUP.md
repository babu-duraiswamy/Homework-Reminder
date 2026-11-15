# Running on GitHub Actions (your computer can be off)

GitHub runs the program on its own computers on this schedule (India time):

| When | What it checks |
|---|---|
| Mon–Sat 2:07, 3:07, 4:07, 5:07, 7:07 PM | Homework |
| Mon–Sat 6:07 PM | Homework + circulars |
| Mon–Sat 8:07 PM | Homework + circulars + daily summary |
| Sunday 10:07 PM | Everything + summary |

- Every homework and every circular is sent **once**, individually, to **all WhatsApp numbers** in your settings.
- If WhatsApp fails for **any** number, a copy goes to your Telegram (with a note saying which number failed).
- The 8 PM summary is always also copied to Telegram. Errors (e.g. school site down) come as ⚠️ on Telegram,
  and GitHub emails you when a run fails.
- GitHub may start a run 5–20 minutes late, occasionally later. Anything posted after the 8 PM check is sent
  at the next day's first check, marked "posted late".
- To change the times, edit the `cron:` lines in `.github/workflows/notifier.yml` (times there are UTC = India − 5:30).

---

## Step 1 – Create a private repository (2 min)
1. Sign in at **github.com**. Click **+** (top right) → **New repository**.
2. **Repository name:** `homework-notifier`. Select **Private**. Leave the rest as is.
3. Click **Create repository**.

## Step 2 – Upload the program (3 min)
1. Unzip `homework-notifier.zip` on your computer.
2. On the new repository page, click the link **uploading an existing file**.
3. Open the unzipped folder, select everything **except** `.env`, `node_modules`, `out`, `state`
   (if they're there), and drag it into the browser. Click **Commit changes**.
4. Check that the repository now shows a folder named **`.github`**. Windows often skips it when dragging.
   If it's missing:
   1. Click **Add file → Create new file**.
   2. In the name box type exactly: `.github/workflows/notifier.yml`
   3. Open `notifier.yml` from the unzipped folder (`.github\workflows\`) in Notepad, copy everything, paste it in.
   4. Click **Commit changes**.

> Never upload `.env` — it holds your password and tokens. It goes in as a secret in Step 3.

## Step 3 – Add your settings as a secret (2 min)
1. On your computer, open your working settings in PowerShell:
   `notepad "$HOME\homework-notifier\.env"` → **Ctrl+A** → **Ctrl+C**.
   Make sure `WA_TO` lists both numbers, e.g. `WA_TO="91XXXXXXXXXX,91YYYYYYYYYY"`.
2. In the repository: **Settings** (top menu) → **Secrets and variables** (left) → **Actions** →
   **New repository secret**.
3. **Name:** `ENV_FILE`  **Secret:** paste (**Ctrl+V**) → **Add secret**.

## Step 4 – Test on your number only (3 min)
1. Click the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **School notifier** (left) → **Run workflow** (right) and fill in:
   - What to check: `everything`
   - date: `friday`
   - to: **your** 10-digit number
   - leave "Test only" unticked
3. Click the green **Run workflow**. Refresh after ~10 seconds; a run appears.
4. Within 2–4 minutes Friday's homework, circulars and a 📅 line arrive on **your** WhatsApp only.
   ✅ green tick = worked. ❌ red cross = click it → **check** → read the last lines (or send them to me).

## Step 5 – Switch off the computer version
So you don't get everything twice, stop the schedule on your PC (PowerShell):

    Unregister-ScheduledTask -TaskName 'Homework notifier' -Confirm:$false

From now on GitHub does all the scheduled runs. Your computer can be off.

---

## Everyday tips
- **Run a check now:** Actions → School notifier → Run workflow (leave date/to empty).
- **Change a setting** (new number, new password): edit `.env` on your PC, then Settings → Secrets → `ENV_FILE`
  → **Update** and paste the whole file again.
- **Pause everything:** Actions → School notifier → **⋯** → **Disable workflow** (Enable again the same way).
- **See what a run did:** Actions → click the run → **check** → "Check the school app". Screenshots are kept
  for 3 days under **Artifacts** at the bottom of the run page.
- Each run saves `state/sent.json` (what was already sent) back to the repo — that's how nothing gets
  sent twice. You'll see small "Update sent state" commits; that's normal.
