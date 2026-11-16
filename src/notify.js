// Fetches homework and circulars from the school ERP and sends anything new to WhatsApp
// (both numbers; anything that fails also goes to Telegram). WHEN it runs is decided by the
// GitHub schedule (.github/workflows/notifier.yml), which passes what to check:
//
//   node src/notify.js --homework                 new homework only
//   node src/notify.js --homework --circulars     homework + circulars
//   node src/notify.js --summary                  + the daily summary line (also checks homework)
//   node src/notify.js                            everything + summary
//
// Each homework and each circular is sent once, individually (screenshot + linked documents as PDF).
// Items posted after the previous day's last check are caught the next run, marked "posted late".
//
// Manual checks of another day (send everything for that day; the memory is not changed):
//   node src/notify.js friday | yesterday | 06-11-2026
// Options: --test (save files to ./out, send nothing), --to=98XXXXXXXX (WhatsApp to that number only)
//
// Settings come from .env (on GitHub: the ENV_FILE secret):
//   SCHOOL_USER, SCHOOL_PASS, SENDER=whatsapp, WA_TOKEN, WA_PHONE_NUMBER_ID, WA_TO, TG_BOT_TOKEN, TG_CHAT_ID
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
// --to=98XXXXXXXX : send this run's WhatsApp messages only to these number(s) (for testing).
const TO_ARG = ARGS.find(a => a.startsWith('--to='));
if (TO_ARG) process.env.WA_TO = TO_ARG.slice(5);
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

// "12-11-2026" minus n days -> "11-11-2026"
function daysBefore(date, n) {
  const [d, m, y] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - n * 864e5);
  return `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
}

// Safe file-name part: "Hindi (L2)" -> "Hindi_L2"
const slug = s => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

async function login(page) {
  const { SCHOOL_USER, SCHOOL_PASS } = process.env;
  if (!SCHOOL_USER || !SCHOOL_PASS) throw new Error('SCHOOL_USER and SCHOOL_PASS must be set');
  // Wait for the things we need (form fields, buttons, links) instead of "page fully loaded":
  // a slow file on the page (an outside script, font or logo) must not hold everything up.
  const T = { timeout: 90000 };
  await page.goto(`${BASE}/site/userlogin`, { waitUntil: 'commit', ...T });
  const form = page.locator('form').first();
  await form.locator('input[name=username]').waitFor(T);
  await form.locator('input[name=username]').fill(SCHOOL_USER);
  await form.locator('input[name=password]').fill(SCHOOL_PASS);
  await Promise.all([page.waitForURL(/\/user\//, { waitUntil: 'commit', ...T }), form.locator('button[type=submit]').click()]);
  // Next is either the "Select Class/Student" screen or the dashboard.
  await page.locator('input[name=clschg], a[href*="/user/homework"]').first().waitFor(T);
  if (page.url().includes('/choose')) {
    await page.locator('input[name=clschg]').first().check(); // the first (default) student
    await Promise.all([page.waitForURL(/dashboard/, { waitUntil: 'commit', ...T }), page.locator('input[type=submit][name=submit]').click()]);
    await page.locator('a[href*="/user/homework"]').first().waitFor(T);
  }
}

// Files from other websites (Google Fonts, cdnjs scripts, a logo) can be slow or hang - especially from
// GitHub's servers - which stalls the school pages. Give images/fonts 8 s and scripts/styles 15 s, then skip them.
async function skipSlowExtras(page) {
  await page.route(u => !u.hostname.endsWith('yuvabharathierp.org'), async route => {
    const type = route.request().resourceType();
    if (type === 'document') return route.continue(); // e.g. a Google Doc we open on purpose
    try {
      const response = await route.fetch({ timeout: ['image', 'font', 'media'].includes(type) ? 8000 : 15000 });
      await route.fulfill({ response });
    } catch {
      console.log(`  (skipped slow file: ${route.request().url().slice(0, 90)})`);
      await route.abort().catch(() => {});
    }
  });
}

// Remembers which files are still loading, so a failure can say what was stuck.
function trackRequests(page) {
  const pending = new Map();
  page.on('request', r => pending.set(r, Date.now()));
  page.on('requestfinished', r => pending.delete(r));
  page.on('requestfailed', r => pending.delete(r));
  return () => [...pending].filter(([, t]) => Date.now() - t > 5000)
    .map(([r, t]) => `${Math.round((Date.now() - t) / 1000)}s ${r.resourceType()} ${r.url().slice(0, 100)}`);
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
  await page.goto(`${BASE}${sec.url}`, { waitUntil: 'commit', timeout: 90000 });
  await page.locator('table tbody tr').first().waitFor({ timeout: 90000 });
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

// WhatsApp to all numbers; if sending to ANY of them fails (template not approved, number not verified,
// token expired, ...), the same message also goes to Telegram so nothing is lost.
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
        await telegram.sendText(`ℹ️ ${err.message.slice(0, 300)} - so this update also comes here on Telegram.`);
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

// Circulars to ignore, by title (default: the weekly food menu). Override with CIRCULAR_SKIP="menu|canteen" in .env.
const CIRCULAR_SKIP = new RegExp(process.env.CIRCULAR_SKIP || '\\bmenu\\b', 'i');

// Only document links are opened and sent as PDFs (Google Docs/Sheets/Slides/Drive files, direct PDFs).
// Everything else - app downloads, websites, videos - is left alone; it stays visible in the screenshot.
const isDocLink = u => /^https?:\/\/(docs\.google\.com\/(document|spreadsheets|presentation)\/|drive\.google\.com\/(file\/d\/|open\?)|[^?#]+\.pdf(\?|#|$))/i.test(u);

async function main() {
  const dateArg = ARGS.find(a => !a.startsWith('--'));
  const manual = Boolean(dateArg || process.env.HW_DATE);
  const date = dateArg ? parseDateArg(dateArg) : (process.env.HW_DATE || todayIST());
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });

  // What to do is decided by the caller (the GitHub schedule):
  //   --homework  --circulars  --summary   (none given = all three)
  const want = { homework: ARGS.includes('--homework'), circular: ARGS.includes('--circulars'), summary: ARGS.includes('--summary') };
  if (!want.homework && !want.circular && !want.summary) want.homework = want.circular = want.summary = true;
  if (want.summary) want.homework = true; // the summary lists today's homework, so look at it
  const sections = Object.keys(SECTIONS).filter(k => want[k]);
  console.log(`Checking ${sections.map(k => SECTIONS[k].name.toLowerCase()).join(' & ')}${want.summary ? ' + summary' : ''} for ${weekdayOf(date)} ${date}` +
    `${manual ? ' (manual)' : ''}${DRY ? ' (test - nothing sent)' : ''}`);

  // Manual checks send everything for that date and leave the memory (state/sent.json) alone.
  const state = manual ? {} : loadState();
  // Also look at yesterday: anything posted after yesterday's last check is sent now, marked "posted late".
  const yesterday = daysBefore(date, 1);
  const sent = { [date]: new Set(state[date] || []), [yesterday]: new Set(state[yesterday] || []) };
  // The daily summary goes out at most once a day, even if two timers trigger the 8 PM check.
  let summaryDay = state._summary || null;
  const saveState = () => {
    if (DRY || manual) return;
    fs.writeFileSync(STATE, JSON.stringify({ [yesterday]: [...sent[yesterday]], [date]: [...sent[date]], _summary: summaryDay }, null, 2) + '\n');
  };
  const doSummary = want.summary && (manual || summaryDay !== date);
  if (want.summary && !doSummary) console.log('(Today\'s summary was already sent - not sending it again.)');

  // WhatsApp (both numbers); anything that fails there also goes to Telegram.
  const tg = DRY ? null : makeSender();

  // Delete local screenshots/PDFs older than 7 days.
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.rmSync(p, { force: true });
  }

  const browser = await chromium.launch();
  let page, stuck = () => [];
  try {
    page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    stuck = trackRequests(page);
    await skipSlowExtras(page);
    await login(page);
    const short = t => (t.length > 70 ? t.slice(0, 67) + '...' : t);
    const found = { homework: { todays: [], pending: [], late: [] }, circular: { todays: [], pending: [], late: [] } };

    for (const key of sections) {
      const sec = SECTIONS[key];
      let rows = await readTable(page, sec);
      if (!rows.length) throw new Error(`${sec.name} table is empty - page layout may have changed`);
      if (key === 'circular') {
        const skipped = rows.filter(r => CIRCULAR_SKIP.test(r.label) && (r.date === date || r.date === yesterday));
        if (skipped.length) console.log(`Skipping ${skipped.length} circular(s): ${skipped.map(r => short(r.label)).join('; ')}`);
        rows = rows.filter(r => !CIRCULAR_SKIP.test(r.label));
      }
      const stateKey = r => (key === 'homework' ? r.id : `${key}:${r.id}`);
      const todays = rows.filter(r => r.date === date);
      const pending = todays.filter(r => !sent[date].has(stateKey(r)));
      // Only when yesterday is in the memory (avoids re-sending everything on the very first run).
      const late = manual || !(yesterday in state) ? [] : rows.filter(r => r.date === yesterday && !sent[yesterday].has(stateKey(r)));
      found[key] = { todays, pending, late };
      console.log(`${sec.name}: ${todays.length} item(s) for ${date}, ${pending.length} not yet sent` +
        (late.length ? `; ${late.length} posted late for ${yesterday}` : ''));

      // Each homework / circular is sent on its own: screenshot(s), then any linked documents as PDF.
      for (const item of [...late, ...pending]) {
        const base = `${item.date}_${key}_${slug(item.label).slice(0, 40)}_${item.id}`;
        const { images, links } = await captureDetails(page, sec, item, base);
        const docs = links.filter(isDocLink);
        const skippedLinks = links.filter(l => !isDocLink(l));
        console.log(`- ${short(item.label)}${item.due ? ` (due ${item.due})` : ''}: ${images.length} screenshot(s), ${docs.length} document(s)` +
          (skippedLinks.length ? `; not opening ${skippedLinks.join(', ')}` : ''));
        const info = { kind: key, subject: item.label, title: item.label, date: item.date, due: item.due };
        for (const [i, img] of images.entries()) {
          if (!DRY) await tg.sendImage(img, { ...info, part: images.length > 1 ? `${i + 1}/${images.length}` : '' });
        }
        for (const [i, link] of docs.entries()) {
          const pdf = path.join(OUT, `${base}_link${i + 1}.pdf`);
          const how = await linkToPdf(browser, link, pdf);
          console.log(`  ${link} -> ${path.basename(pdf)} (${how})`);
          const name = `${short(item.label).replace(/[\\/:*?"<>|]/g, '')} ${item.date}${docs.length > 1 ? ` (${i + 1})` : ''}.pdf`;
          if (!DRY) await tg.sendDocument(pdf, name, { ...info, link });
        }
        // Remember it right away, so a later failure in this run never causes a re-send.
        if (!DRY && !manual) { sent[item.date].add(stateKey(item)); saveState(); }
      }
    }
    saveState(); // remember both days even if nothing was sent (tomorrow's late-check needs it)

    // Short text lines (no "no circulars" messages):
    //  - new homework found: one line after the screenshots
    //  - --summary (8 PM / Sunday): today's homework, or "No homework today"; always sent, also copied to Telegram
    const hw = found.homework;
    const hwList = l => l.map(r => r.label).join(', ');
    const dm = d => d.slice(0, 5); // "13-11-2026" -> "13-11"
    const circToday = manual ? found.circular.todays.length : [...sent[date]].filter(k => k.startsWith('circular:')).length;
    const lateText = hw.late.length ? `posted late yesterday (${dm(yesterday)}): ${hwList(hw.late)}` : '';
    let status = null;
    if (doSummary) {
      status = `${manual ? '📅' : '✅'} ${weekdayOf(date)} ${dm(date)}${manual ? ' (manual check)' : ''}: ` +
        (hw.todays.length ? `Homework today (${hw.todays.length}) - ${hwList(hw.todays)}.` : 'No homework today.') +
        (circToday ? ` Circulars today: ${circToday}.` : '') +
        (hw.pending.length && !manual ? ' New ones are above.' : '') +
        (lateText ? ` Also ${lateText} (details above).` : '');
    } else if (hw.pending.length && hw.late.length) {
      status = `📚 New homework: ${hwList(hw.pending)}. Also ${lateText}.`;
    } else if (hw.pending.length) {
      status = `📚 New homework: ${hwList(hw.pending)} (details above).`;
    } else if (hw.late.length) {
      status = `📚 ${lateText.charAt(0).toUpperCase() + lateText.slice(1)} (details above).`;
    }
    console.log(status || 'Nothing new to report.');
    if (status && !DRY) {
      await tg.sendText(status.slice(0, 900));
      // Safety net: WhatsApp can quietly drop a message after accepting it (e.g. marketing limits),
      // so the daily summary is always copied to Telegram too - unless it already went there.
      if (doSummary && !manual && tg.lastVia === 'whatsapp' && process.env.TG_BOT_TOKEN) {
        await require('./telegram').sendText(`${status.slice(0, 3900)} (copy - also sent on WhatsApp)`)
          .catch(e => console.log(`Telegram copy of the summary failed: ${e.message}`));
      }
    }
    if (doSummary && !DRY && !manual) { summaryDay = date; saveState(); }
  } catch (err) {
    // Leave clues for the GitHub run page: where it was, what was still loading, and a screenshot.
    if (page) {
      console.log(`Failed on page: ${page.url()}`);
      const st = stuck();
      if (st.length) console.log(`Still loading when it failed:\n  ${st.join('\n  ')}`);
      await page.screenshot({ path: path.join(OUT, `failure_${Date.now()}.png`), fullPage: true }).catch(() => {});
    }
    throw err;
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
