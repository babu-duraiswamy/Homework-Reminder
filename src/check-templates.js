// Quick check of your WhatsApp templates:  node src/check-templates.js
const path = require('path');
require('./env').load(path.join(__dirname, '..', '.env'));
require('./whatsapp').checkTemplates()
  .then(lines => { console.log('\nYour WhatsApp templates:'); for (const l of lines) console.log('  ' + l); console.log(); })
  .catch(e => { console.error('Check failed:', e.message); process.exit(1); });
