// Interactive one-time setup: asks for the details, finds your Telegram chat ID, writes .env,
// and sends a test message. Run with:  node src/setup.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV = path.join(__dirname, '..', '.env');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Don't echo what is typed (for passwords/tokens).
      rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else if (s.includes('\n')) rl.output.write('\n'); };
    }
    rl.question(question, a => { rl.close(); resolve(a.trim()); });
  });
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function main() {
  console.log('\n=== Homework notifier setup ===\n');
  const user = await ask('School ERP username: ');
  const pass = await ask('School ERP password (hidden): ', { hidden: true });

  let token, me;
  for (;;) {
    token = await ask('Telegram bot token from @BotFather (hidden): ', { hidden: true });
    me = await tg(token, 'getMe');
    if (me.ok) break;
    console.log('  That token was not accepted by Telegram, please paste it again.');
  }
  console.log(`  OK, bot is @${me.result.username}`);

  console.log(`\nNow open Telegram, find @${me.result.username} and press Start (or send "hi").`);
  console.log('To notify a group instead, add the bot to the group and send "hi" there.');
  await ask('Press Enter once you have done that... ');

  let chats = [];
  for (let i = 0; i < 3 && !chats.length; i++) {
    const up = await tg(token, 'getUpdates');
    const seen = new Map();
    for (const u of up.result || []) {
      const c = (u.message || u.my_chat_member || u.channel_post || {}).chat;
      if (c) seen.set(c.id, c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username);
    }
    chats = [...seen];
    if (!chats.length) await ask('  No message found yet. Send "hi" to the bot, then press Enter... ');
  }
  if (!chats.length) throw new Error('Could not find a chat. Send "hi" to the bot and run setup again.');

  let chatIds;
  if (chats.length === 1) {
    chatIds = String(chats[0][0]);
    console.log(`  Found chat: ${chats[0][1]}`);
  } else {
    chats.forEach(([id, name], i) => console.log(`  ${i + 1}. ${name}`));
    const pick = await ask('Which ones should get homework? (numbers, comma-separated, e.g. 1,2): ');
    chatIds = pick.split(',').map(n => chats[Number(n.trim()) - 1]).filter(Boolean).map(c => c[0]).join(',');
  }

  // Quote values so special characters in the password survive.
  const q = v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  fs.writeFileSync(ENV, [
    `SCHOOL_USER=${q(user)}`,
    `SCHOOL_PASS=${q(pass)}`,
    `TG_BOT_TOKEN=${q(token)}`,
    `TG_CHAT_ID=${q(chatIds)}`,
    '',
  ].join('\n'), { mode: 0o600 });
  console.log(`\nSaved settings to ${ENV} (only readable by your user account).`);

  for (const chat_id of chatIds.split(',')) {
    await tg(token, 'sendMessage', { chat_id, text: '✅ Homework notifier is connected. You will get today\'s homework here on school days, 2–8 PM.' });
  }
  console.log('Sent a test message to Telegram.\n');
}

main().catch(e => { console.error('\nSetup failed:', e.message); process.exit(1); });
