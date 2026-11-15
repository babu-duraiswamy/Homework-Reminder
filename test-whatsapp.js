// Send ONE test message to ONE WhatsApp number and show exactly what Meta answers.
//   node src/test-whatsapp.js 98XXXXXXXX
const path = require('path');
require('./env').load(path.join(__dirname, '..', '.env'));
const { API } = require('./whatsapp');

(async () => {
  let n = (process.argv[2] || '').replace(/\D/g, '');
  if (!n) { console.log('Usage: node src/test-whatsapp.js 98XXXXXXXX'); process.exit(1); }
  if (n.length === 10) n = `91${n}`;
  const { WA_TOKEN, WA_PHONE_NUMBER_ID, WA_TEMPLATE_LANG, WA_TO } = process.env;
  const envFile = path.join(__dirname, '..', '.env');
  console.log(`\nSettings file: ${envFile} ${require('fs').existsSync(envFile) ? '(found)' : '(NOT FOUND - copy .env into this folder)'}`);
  console.log(`Numbers in your .env (WA_TO): ${WA_TO || '(none)'}`);
  if (!WA_TOKEN || WA_TOKEN.length < 50) {
    console.log(`❌ No valid WhatsApp token in the settings (${WA_TOKEN ? `only ${WA_TOKEN.length} characters` : 'missing'}).`);
    console.log('   Copy .env from your working folder, or run  node src/setup-whatsapp.js  and paste the permanent token.\n');
    process.exit(1);
  }
  if (!WA_PHONE_NUMBER_ID) { console.log('❌ No WA_PHONE_NUMBER_ID in the settings - run  node src/setup-whatsapp.js\n'); process.exit(1); }
  console.log(`Sending a test message to: +${n}\n`);
  const res = await fetch(`${API}/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: n, type: 'template',
      template: { name: 'homework_status', language: { code: WA_TEMPLATE_LANG || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Test message - please reply OK if you got this.' }] }] },
    }),
  });
  const body = await res.json();
  if (body.messages) {
    console.log(`✅ Meta ACCEPTED the message for +${body.contacts?.[0]?.wa_id || n}.`);
    console.log('   If it does not arrive within a minute, the problem is on the phone side:');
    console.log('   - search WhatsApp chats for "555" or "Test Number" (it comes from the +1 555 test number)');
    console.log('   - make sure this is the number their WhatsApp is registered on');
    console.log('   - update WhatsApp on that phone');
  } else {
    const e = body.error || {};
    console.log(`❌ Meta REJECTED it: ${e.message}${e.error_data?.details ? ` - ${e.error_data.details}` : ''} (code ${e.code})`);
    if (e.code === 131030 || /allowed list/i.test(e.message || '')) console.log('   -> This number is not in the verified recipient list on developers.facebook.com (or was added with a different number).');
    if (e.code === 132000 || e.code === 132001) console.log('   -> Template problem: run  node src/check-templates.js');
  }
  console.log();
})().catch(e => { console.error('Test failed:', e.message); process.exit(1); });
