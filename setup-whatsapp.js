// Adds WhatsApp to an existing setup (Telegram stays for error alerts).
// Run in the folder:  node src/setup-whatsapp.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV = path.join(__dirname, '..', '.env');
const API = `https://graph.facebook.com/${process.env.WA_API_VERSION || 'v23.0'}`;
const TEMPLATES = ['homework_image', 'homework_document', 'homework_status', 'circular_image', 'circular_document'];

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else if (s.includes('\n')) rl.output.write('\n'); };
    rl.question(question, a => { rl.close(); resolve(a.trim()); });
  });
}

async function graph(token, url) {
  const r = await (await fetch(`${API}/${url}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (r.error) throw new Error(r.error.message);
  return r;
}

function writeEnv(updates) {
  const q = v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  let lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(updates)) {
    lines = lines.filter(l => !l.startsWith(`${k}=`));
    lines.push(`${k}=${q(v)}`);
  }
  fs.writeFileSync(ENV, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
}

async function main() {
  console.log('\n=== Add WhatsApp ===\n');
  if (!fs.existsSync(ENV)) throw new Error('Run  node src/setup.js  first (school login + Telegram).');

  let token, phoneId, phone;
  for (;;) {
    token = await ask('Permanent access token (System user token, hidden): ', { hidden: true });
    phoneId = await ask('Phone number ID (from WhatsApp > API Setup): ');
    try {
      phone = await graph(token, `${phoneId}?fields=display_phone_number,verified_name`);
      break;
    } catch (e) {
      console.log(`  Not accepted: ${e.message}\n  Check the token and Phone number ID and try again.\n`);
    }
  }
  console.log(`  OK, sending number: ${phone.display_phone_number} (${phone.verified_name || 'test number'})`);

  const wabaId = await ask('WhatsApp Business Account ID (from API Setup, to check templates): ');
  try {
    const t = await graph(token, `${wabaId}/message_templates?fields=name,language&limit=100`);
    const lang = (t.data || []).find(x => x.name === 'homework_status')?.language;
    if (lang) writeEnv({ WA_TEMPLATE_LANG: lang });
  } catch (e) {
    console.log(`  (Could not read templates with that Business Account ID: ${e.message})`);
  }

  const to = await ask('Your WhatsApp number(s) with country code, comma-separated (e.g. 919876543210): ');
  const recipients = to.split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  if (!recipients.length) throw new Error('No WhatsApp number entered.');

  writeEnv({ SENDER: 'whatsapp', WA_TOKEN: token, WA_PHONE_NUMBER_ID: phoneId, WA_WABA_ID: wabaId, WA_TO: recipients.join(',') });
  console.log(`\nSaved to ${ENV}. Homework will now go to WhatsApp. If WhatsApp fails (e.g. templates still in review), it goes to Telegram instead; errors always go to Telegram.`);

  require('./env').load(ENV);
  console.log('\nChecking your templates:');
  for (const line of await require('./whatsapp').checkTemplates()) console.log('  ' + line);

  console.log('\nSending a WhatsApp test message...');
  try {
    await require('./whatsapp').sendText('WhatsApp is connected. You will get homework here; the daily summary comes at 8 PM.');
    console.log('  Accepted by WhatsApp - check your phone.');
    console.log('  If nothing arrives in a minute: make sure your number is in the "To" list on the API Setup page (verified).');
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    console.log('  See the template check above for what to fix. Until it works, messages automatically go to Telegram.');
  }
  console.log('\nTo go back to Telegram for everything: delete the SENDER line from .env\n');
}

main().catch(e => { console.error('\nSetup failed:', e.message); process.exit(1); });
