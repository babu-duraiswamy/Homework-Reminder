// Self-check: finds why messages aren't arriving.  Run in the folder:  node src/doctor.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ok = m => console.log(`  ✅ ${m}`);
const bad = (m, fix) => { console.log(`  ❌ ${m}`); if (fix) console.log(`     → ${fix}`); process.exitCode = 1; };

async function main() {
  console.log('\n=== Homework notifier self-check ===\n');

  console.log('1. Node.js');
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 18) return bad(`Node ${process.version} is too old`, 'Install the LTS version from https://nodejs.org, then run the setup again.');
  ok(`Node ${process.version}`);

  console.log('2. Settings file (.env)');
  const envFile = path.join(ROOT, '.env');
  if (!require('./env').load(envFile)) return bad(`No .env file in ${ROOT}`, 'Run:  node src/setup.js');
  const missing = ['SCHOOL_USER', 'SCHOOL_PASS', 'TG_BOT_TOKEN', 'TG_CHAT_ID'].filter(k => !process.env[k]);
  if (missing.length) return bad(`Missing in .env: ${missing.join(', ')}`, 'Run:  node src/setup.js');
  ok(`Found ${envFile}`);

  console.log('3. Installed packages');
  try { require('playwright'); ok('Playwright installed'); } catch { return bad('Playwright not installed', 'Run:  npm install   then   npx playwright install chromium'); }

  console.log('4. Telegram bot token');
  const token = process.env.TG_BOT_TOKEN;
  let r;
  try {
    r = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
  } catch (e) {
    return bad(`Cannot reach Telegram (${e.message})`, 'Check the internet connection; some office/school Wi-Fi blocks Telegram.');
  }
  if (!r.ok) return bad(`Telegram rejected the token: ${r.description}`, 'If you revoked the token, run  node src/setup.js  and paste the NEW token.');
  ok(`Bot is @${r.result.username}`);

  console.log('5. Sending a test message');
  for (const chat_id of process.env.TG_CHAT_ID.split(',').map(s => s.trim())) {
    const s = await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: '🔧 Test message from the homework notifier self-check.' }),
    })).json();
    if (s.ok) ok(`Sent to chat ${chat_id} - check Telegram now`);
    else bad(`Could not send to chat ${chat_id}: ${s.description}`,
      /chat not found|blocked|bot can't initiate/i.test(s.description || '')
        ? `Open @${r.result.username} in Telegram, press Start, then run  node src/setup.js  again.`
        : 'Run  node src/setup.js  again.');
  }

  if (process.env.SENDER === 'whatsapp') {
    console.log('5b. WhatsApp (homework goes here; Telegram is for errors)');
    const { API } = require('./whatsapp');
    const g = async url => (await fetch(`${API}/${url}`, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } })).json();
    const p = await g(`${process.env.WA_PHONE_NUMBER_ID}?fields=display_phone_number`);
    if (p.error) bad(`WhatsApp token/phone ID not accepted: ${p.error.message}`, 'Run:  node src/setup-whatsapp.js');
    else {
      ok(`Sending number ${p.display_phone_number}, recipients ${process.env.WA_TO}`);
      for (const line of await require('./whatsapp').checkTemplates()) {
        if (line.startsWith('❌')) bad(line.slice(2), 'Fix it in WhatsApp Manager > Message templates (see WHATSAPP-SETUP.md).');
        else console.log(`  ${line}`);
      }
      try { await require('./whatsapp').sendText('Test message from the homework notifier self-check.'); ok('WhatsApp test message accepted - check your phone'); }
      catch (e) { bad(e.message, 'If the template is approved, check your number is verified in the "To" list on API Setup.'); }
    }
  }

  console.log('6. Scheduled runs');
  console.log('  They run on GitHub: Actions tab -> School notifier. A red cross = open it -> check -> "Check the school app".');

  console.log(process.exitCode ? '\nFix the ❌ item above and run this again.\n' : '\nAll good. Now run a real check:  node src/notify.js\n');
}

main().catch(e => { console.error('Self-check crashed:', e); process.exit(1); });
