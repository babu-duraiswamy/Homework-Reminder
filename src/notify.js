// Checks the school ERP for homework and circulars dated today and sends them to Telegram/WhatsApp.
// 2-7 PM: messages only for new items. 8 PM final check: always a summary. Late posts are caught the next day.
//
// Env (normally from .env):
//   SCHOOL_USER, SCHOOL_PASS          ERP login
//   TG_BOT_TOKEN, TG_CHAT_ID          Telegram bot (homework, or error alerts only when SENDER=whatsapp)
//   SENDER=whatsapp, WA_TOKEN, WA_PHONE_NUMBER_ID, WA_TO   send homework to WhatsApp
//   DRY_RUN=1      save files to ./out, send nothing, don't update state
//   HW_DATE=dd-mm-yyyy   check this date instead of today (for testing)
//
// Command line (manual checks):
//   node src/notify.js                 today (what the scheduler runs)
//   node src/notify.js friday          most recent Friday (any weekday name works)
//   node src/notify.js yesterday
//   node src/notify.js 06-11-2026      a specific date (06-11 = this year)
//   add --test to only save files to ./out without sending to Telegram
//   add --final to treat a run as the day's final check (always sends a summary)
// A manual date sends everything for that date and does not affect what the scheduler remembers.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://yuvabharathierp.org';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const STATE = path.join(ROOT, 'state', 'sent.json');
// Load settings from .env on a home computer (existing environment variables win).
require('./env').load(path.join(ROOT, '.env'));
const ARGS = process.argv.slice(2).map(a => a.toLowerCase());
const DRY = process.env.DRY_RUN === '1' || ARGS.some(a => ['--test', '--dry', '--dry-run'].includes(a));

function todayIST() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year}`;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = n => String(n).padStart(2, '0');

// Turn "friday", "yesterday", "6-11", "06-11-2026" into "dd-mm-yyyy" (calendar in India time).
function parseDateArg(arg) {
  const [d, m, y] = todayIST().split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const fmt = dt => `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
  const shift = n => fmt(new Date(today.getTime() - n * 864e5));
  if (arg === 'today') return shift(0);
  if (arg === 'yesterday') return shift(1);
  const dayIdx = DAYS.findIndex(name => name.startsWith(arg) && arg.length >= 3);
  if (dayIdx >= 0) return shift((today.getUTCDay() - dayIdx + 7) % 7); // most recent, including today
  const mm = arg.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
  if (mm) {
    const yr = mm[3] ? (mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3])) : y;
    const dt = new Date(Date.UTC(yr, Number(mm[2]) - 1, Number(mm[1])));
    if (dt.getUTCDate() === Number(mm[1])) return fmt(dt);
  }
  throw new Error(`Don't understand the date "${arg}". Use e.g. friday, yesterday or 06-11-2026.`);
}

function weekdayOf(date) {
  const [d, m, y] = date.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3).replace(/^./, c => c.toUpperCase());
}

// The day's last check: weekdays from 8 PM (incl. catch-up runs after the PC wakes), and weekends.
function isFinalCheck() {
  if (ARGS.includes('--final')) return true;
  const fmt = o => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', ...o }).format(new Date());
  const hour = Number(fmt({ hour: '2-digit', hour12: false }));
  const weekend = ['Sat', 'Sun'].includes(fmt({ weekday: 'short' }));
  return weekend || hour >= 20;
}

// "12-11-2026" minus n days -> "11-11-2026"
function daysBefore(date, n) {
  const [d, m, y] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - n * 864e5);
  return `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
}

// e.g. "3:02 PM, Fri"
function nowLabelIST() {
  const fmt = o => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o }).format(new Date());
  return `${fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}, ${fmt({ weekday: 'short' })}`;
}

const slug = s => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

async function login(page) {
  const { SCHOOL_USER, SCHOOL_PASS } = process.env;
  if (!SCHOOL_USER || !SCHOOL_PASS) throw new Error('SCHOOL_USER and SCHOOL_PASS must be set');
  await page.goto(`${BASE}/site/userlogin`, { waitUntil: 'domcontentloaded' });
  const form = page.locator('form').first();
  await form.locator('input[name=username]').fill(SCHOOL_USER);
  await form.locator('input[name=password]').fill(SCHOOL_PASS);
  await Promise.all([page.waitForURL(/\/user\//, { timeout: 60000, waitUntil: 'commit' }), form.locator('button[type=submit]').click()]);
  await page.waitForLoadState('domcontentloaded');
  // "Select Class/Student" screen: pick the first (default) student.
  if (page.url().includes('/choose')) {
    await page.locator('input[name=clschg]').first().check();
    await Promise.all([page.waitForURL(/dashboard/, { timeout: 60000, waitUntil: 'commit' }), page.locator('input[type=submit][name=submit]').click()]);
    await page.waitForLoadState('domcontentloaded');
  }
}

// Outside images/fonts (Google Fonts, a logo from another site) sometimes never finish loading,
// which stalls page loads and screenshots. Give them 8 seconds, then skip them.
async function skipSlowExtras(page) {
  await page.route(u => !u.hostname.endsWith('yuvabharathierp.org'), async route => {
    if (!['image', 'font', 'media'].includes(route.request().resourceType())) return route.continue();
    try {
      const response = await route.fetch({ timeout: 8000 });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

// The two school sections we watch. Each row's eye icon opens a popup with the full details.
const SECTIONS = {
  homework: {
    name: 'Homework',
    url: '/user/homework',
    idRe: /evaluation\((\d+)\s*,\s*\d+\)/,
    detail: id => `/homework_detail/${id}/`,
    // Columns: Class, Section, Subject, Homework Date, Submission Date, ...
    row: c => ({ label: c[2], date: c[3], due: c[4] }),
    minCells: 8,
  },
  circular: {
    name: 'Circulars',
    url: '/user/notification',
    idRe: /getRecord\((\d+)\)/,
    detail: id => `/notification/getDetail/${id}`,
    // Columns: No, Title, Create Date, Publish Date, Create By, Action
    row: c => ({ label: c[1], date: c[3] }),
    minCells: 6,
  },
};

async function openSection(page, sec) {
  await page.goto(`${BASE}${sec.url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('table tbody tr').first().waitFor({ timeout: 60000 });
  // Circulars show 10 per page; ask the table for 50 so a busy day isn't cut off.
  await page.evaluate(() => {
    try { const t = window.jQuery && window.jQuery('table.dataTable').DataTable(); if (t && t.page.len() < 50) t.page.len(50).draw(false); } catch {}
  });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); // nice-to-have only
  await page.waitForTimeout(500);
}

async function readTable(page, sec) {
  await openSection(page, sec);
  const raw = await page.locator('table tbody tr').evaluateAll((trs, re) => trs.map((tr, idx) => ({
    idx,
    cells: [...tr.cells].map(td => td.innerText.trim()),
    id: ((tr.querySelector('[onclick]')?.getAttribute('onclick') || '').match(new RegExp(re)) || [])[1] || null,
  })), sec.idRe.source);
  return raw.filter(r => r.cells.length >= sec.minCells && r.id).map(r => ({ idx: r.idx, id: r.id, ...sec.row(r.cells) }));
}

// Click the eye icon, screenshot the whole popup (long ones split into parts), return images + links in it.
async function captureDetails(page, sec, item, base) {
  await openSection(page, sec);
  const idx = await page.locator('table tbody tr').evaluateAll((trs, [re, id]) => trs.findIndex(tr =>
    ((tr.querySelector('[onclick]')?.getAttribute('onclick') || '').match(new RegExp(re)) || [])[1] === id), [sec.idRe.source, item.id]);
  if (idx < 0) throw new Error(`${sec.name} item ${item.id} disappeared from the list`);
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes(sec.detail(item.id)), { timeout: 30000 }),
    page.locator('table tbody tr').nth(idx).locator('i.fa-eye').click(),
  ]);
  await resp.finished();
  const modal = page.locator('#evaluation');
  await modal.waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000); // let fade-in animation finish

  // Make the window tall enough to show the whole popup, then cut it into readable parts.
  const content = modal.locator('.modal-content');
  const h = await content.evaluate(el => el.scrollHeight);
  const vp = page.viewportSize();
  if (h + 150 > vp.height) {
    await page.setViewportSize({ width: vp.width, height: Math.min(h + 150, 20000) });
    await page.waitForTimeout(500);
  }
  const box = await content.boundingBox();
  const PART = 1600;
  const parts = Math.max(1, Math.ceil(box.height / PART));
  const images = [];
  for (let i = 0; i < parts; i++) {
    const file = path.join(OUT, `${base}${parts > 1 ? `_part${i + 1}` : ''}.png`);
    const y = box.y + i * PART;
    await page.screenshot({ path: file, clip: { x: box.x, y, width: box.width, height: Math.min(PART, box.y + box.height - y) } });
    images.push(file);
  }
  const links = await modal.evaluate(el => {
    const hrefs = [...el.querySelectorAll('a[href]')].map(a => a.href);
    const text = (el.innerText.match(/https?:\/\/[^\s<>"')]+/g) || []);
    return [...new Set([...hrefs, ...text])].filter(u => /^https?:/.test(u) && !u.includes('yuvabharathierp.org'));
  });
  await page.setViewportSize(vp);
  return { images, links };
}

// Google Docs/Slides/Sheets -> direct PDF export URL (works when the doc is shared publicly).
function googleExportUrl(link) {
  const m = link.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === 'presentation') return `https://docs.google.com/presentation/d/${id}/export/pdf`;
  if (kind === 'spreadsheets') return `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`;
  return `https://docs.google.com/document/d/${id}/export?format=pdf`;
}

async function linkToPdf(browser, link, pdfPath) {
  const exportUrl = googleExportUrl(link);
  if (exportUrl) {
    try {
      const res = await fetch(exportUrl, { redirect: 'follow' });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.subarray(0, 4).toString() === '%PDF') {
        fs.writeFileSync(pdfPath, buf);
        return 'google-export';
      }
      console.log(`  export not available (HTTP ${res.status}), falling back to page print`);
    } catch (e) {
      console.log(`  export failed (${e.message}), falling back to page print`);
    }
  }
  // Fallback: open the link and print what we can see (v1 behaviour for non-shared docs).
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  try {
    await page.goto(link, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    return 'page-print';
  } finally {
    await page.close();
  }
}

// WhatsApp first; if a WhatsApp send fails (template not approved yet, token expired, ...),
// the same message goes to Telegram so no homework is ever lost.
function makeSender() {
  const telegram = require('./telegram');
  if (process.env.SENDER !== 'whatsapp') return telegram;
  const whatsapp = require('./whatsapp');
  let noticeSent = false;
  const sender = { lastVia: null };
  const withFallback = method => async (...args) => {
    try {
      const r = await whatsapp[method](...args);
      sender.lastVia = 'whatsapp';
      return r;
    } catch (err) {
      if (!process.env.TG_BOT_TOKEN) throw err;
      console.log(`WhatsApp ${method} failed (${err.message}) - sending to Telegram instead`);
      if (!noticeSent) {
        noticeSent = true;
        await telegram.sendText(`ℹ️ WhatsApp didn't work this time (${err.message.slice(0, 200)}), so this update comes here on Telegram.`);
      }
      const r = await telegram[method](...args);
      sender.lastVia = 'telegram';
      return r;
    }
  };
  return Object.assign(sender, { sendImage: withFallback('sendImage'), sendDocument: withFallback('sendDocument'), sendText: withFallback('sendText') });
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}

async function main() {
  const dateArg = ARGS.find(a => !a.startsWith('--'));
  const manual = Boolean(dateArg || process.env.HW_DATE);
  const date = dateArg ? parseDateArg(dateArg) : (process.env.HW_DATE || todayIST());
  console.log(`Checking homework & circulars for ${weekdayOf(date)} ${date}${manual ? ' (manual)' : ''}${DRY ? ' (test - nothing sent)' : ''}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });

  // Manual checks send everything for that date and leave the scheduler's memory alone.
  const state = manual ? {} : loadState();
  // Also look at yesterday: anything posted after yesterday's final check is sent now, marked "posted late".
  const yesterday = daysBefore(date, 1);
  const sent = { [date]: new Set(state[date] || []), [yesterday]: new Set(state[yesterday] || []) };
  // Homework + summaries go to WhatsApp when SENDER=whatsapp (falling back to Telegram), otherwise Telegram.
  const tg = DRY ? null : makeSender();

  // Delete local screenshots/PDFs older than 7 days.
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.rmSync(p, { force: true });
  }

  const browser = await chromium.launch();
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await skipSlowExtras(page);
    await login(page);
    const short = t => (t.length > 70 ? t.slice(0, 67) + '...' : t);
    const found = {}; // section key -> { todays, pending }
    for (const [key, sec] of Object.entries(SECTIONS)) {
      const rows = await readTable(page, sec);
      if (!rows.length) throw new Error(`${sec.name} table is empty - page layout may have changed`);
      const stateKey = r => (key === 'homework' ? r.id : `${key}:${r.id}`);
      const todays = rows.filter(r => r.date === date);
      const pending = todays.filter(r => !sent[date].has(stateKey(r)));
      // Only when yesterday was recorded by this version (avoids re-sending everything right after an update).
      const late = manual || !(yesterday in state) ? [] : rows.filter(r => r.date === yesterday && !sent[yesterday].has(stateKey(r)));
      found[key] = { todays, pending, late };
      console.log(`${sec.name}: ${todays.length} item(s) for ${date}, ${pending.length} not yet sent` +
        (late.length ? `; ${late.length} posted late for ${yesterday}` : ''));

      for (const item of [...late, ...pending]) {
        const base = `${item.date}_${key}_${slug(item.label).slice(0, 40)}_${item.id}`;
        const { images, links } = await captureDetails(page, sec, item, base);
        console.log(`- ${short(item.label)}${item.due ? ` (due ${item.due})` : ''}: ${images.length} screenshot(s), ${links.length} link(s)`);
        const info = { kind: key, subject: item.label, title: item.label, date: item.date, due: item.due };
        for (const [i, img] of images.entries()) {
          if (!DRY) await tg.sendImage(img, { ...info, part: images.length > 1 ? `${i + 1}/${images.length}` : '' });
        }
        for (const [i, link] of links.entries()) {
          const pdf = path.join(OUT, `${base}_link${i + 1}.pdf`);
          const how = await linkToPdf(browser, link, pdf);
          console.log(`  link ${link} -> ${path.basename(pdf)} (${how})`);
          const name = `${short(item.label).replace(/[\\/:*?"<>|]/g, '')} ${item.date}${links.length > 1 ? ` (${i + 1})` : ''}.pdf`;
          if (!DRY) await tg.sendDocument(pdf, name, { ...info, link });
        }
        if (!DRY && !manual) {
          sent[item.date].add(stateKey(item));
          // Keep today's and yesterday's entries; save after each item so a later failure doesn't cause re-sends.
          fs.writeFileSync(STATE, JSON.stringify({ [yesterday]: [...sent[yesterday]], [date]: [...sent[date]] }, null, 2) + '\n');
        }
      }
    }

    // Remember both days on every run (even if nothing was sent), so tomorrow's catch-up knows what yesterday had.
    if (!DRY && !manual) {
      fs.writeFileSync(STATE, JSON.stringify({ [yesterday]: [...sent[yesterday]], [date]: [...sent[date]] }, null, 2) + '\n');
    }

    // Messages:
    //  - manual check: always a summary
    //  - 2-7 PM checks: only when something new was sent (silent otherwise, to avoid a false "nothing today")
    //  - final check (8 PM or later on weekdays, the 10 PM weekend check): always a summary
    //  - items posted after yesterday's final check are sent at the next check, marked as late
    const hw = found.homework, ci = found.circular;
    const hwList = l => l.map(r => r.label).join(', ');
    const ciList = l => l.map(r => short(r.label)).join('; ');
    const dayList = () => [
      hw.todays.length ? `Homework (${hw.todays.length}): ${hwList(hw.todays)}.` : 'No homework.',
      ci.todays.length ? `Circulars (${ci.todays.length}): ${ciList(ci.todays)}.` : 'No circulars.',
    ].join(' ');
    const lateList = () => [
      hw.late.length ? `homework ${hwList(hw.late)}` : '',
      ci.late.length ? `circulars ${ciList(ci.late)}` : '',
    ].filter(Boolean).join('; ');
    const lateNote = () => (hw.late.length + ci.late.length ? ` Posted late on ${yesterday} (after the final check): ${lateList()}.` : '');
    const newList = () => [
      hw.pending.length ? `Homework: ${hwList(hw.pending)}.` : '',
      ci.pending.length ? `Circulars: ${ciList(ci.pending)}.` : '',
    ].filter(Boolean).join(' ') + lateNote();
    const anyNew = hw.pending.length + ci.pending.length + hw.late.length + ci.late.length > 0;
    let status = null;
    if (manual) {
      status = `📅 Manual check for ${weekdayOf(date)} ${date}: ` + dayList();
    } else if (isFinalCheck()) {
      status = `✅ Final check, ${nowLabelIST()} (${date}): ${dayList()}${lateNote()}`;
    } else if (anyNew) {
      status = `📚 ${nowLabelIST()}: New above - ${newList()}`;
    }
    console.log(status || `${nowLabelIST()}: nothing new - staying quiet until the final check.`);
    if (status && !DRY) {
      await tg.sendText(status.slice(0, 900));
      // Safety net: WhatsApp can quietly drop a message after accepting it (e.g. marketing limits),
      // so the daily final summary is always copied to Telegram too - unless it already went there.
      if (!manual && isFinalCheck() && tg.lastVia === 'whatsapp' && process.env.TG_BOT_TOKEN) {
        await require('./telegram').sendText(`${status.slice(0, 3900)} (copy - also sent on WhatsApp)`)
          .catch(e => console.log(`Telegram copy of the summary failed: ${e.message}`));
      }
    }
  } finally {
    // Log out like a person closing the session, so sessions don't pile up on the server.
    if (page) await page.goto(`${BASE}/site/logout`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await browser.close();
  }
}

// Try twice (1 minute apart) so a briefly slow school site doesn't cause a false alarm.
// Already-sent items are remembered after each send, so a retry never sends them twice.
async function run() {
  try {
    await main();
  } catch (err) {
    console.error(`Attempt 1 failed: ${String(err.message || err).split('\n')[0]} - retrying in 1 minute`);
    await new Promise(r => setTimeout(r, 60000));
    await main();
  }
}

run().catch(async err => {
  console.error(err);
  // Report failures to Telegram so a missing message never goes unnoticed.
  if (!DRY && process.env.TG_BOT_TOKEN) {
    await require('./telegram').sendText(`⚠️ Homework check failed (tried twice): ${String(err.message || err).split('\n')[0].slice(0, 300)}`).catch(() => {});
  }
  process.exit(1);
});
