// WhatsApp Cloud API (Meta) sender.
// Messages the business starts must use Meta-approved templates. Create these three
// (Category: Utility, Language: English) - exact wording in README:
//   homework_image     IMAGE header,    body with {{1}} subject, {{2}} posted date, {{3}} due date
//   homework_document  DOCUMENT header, body with {{1}} subject, {{2}} posted date, {{3}} link
//   homework_status    no header,       body with {{1}} status text
//   circular_image     IMAGE header,    body with {{1}} circular title, {{2}} publish date
//   circular_document  DOCUMENT header, body with {{1}} circular title, {{2}} publish date, {{3}} link
const fs = require('fs');
const path = require('path');

const API = `https://graph.facebook.com/${process.env.WA_API_VERSION || 'v23.0'}`;

function cfg() {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  const to = (process.env.WA_TO || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  if (!token || !phoneId || !to.length) throw new Error('WA_TOKEN, WA_PHONE_NUMBER_ID and WA_TO must be set (run: node src/setup-whatsapp.js)');
  return { token, phoneId, to, lang: process.env.WA_TEMPLATE_LANG || 'en' };
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new Error(`WhatsApp: ${e.message || res.status}${e.error_data?.details ? ` - ${e.error_data.details}` : ''}`);
  }
  return body;
}

async function upload(c, filePath, mime) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
  return (await api(`${API}/${c.phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}` }, body: form })).id;
}

// Template values can't contain newlines/tabs or more than 4 spaces in a row.
const clean = s => (String(s ?? '').replace(/[\n\t\r]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-').slice(0, 900);

async function sendTemplate(name, header, params) {
  const c = cfg();
  const components = [];
  if (header) components.push({ type: 'header', parameters: [header] });
  components.push({ type: 'body', parameters: params.map(t => ({ type: 'text', text: clean(t) })) });
  for (const to of c.to) {
    await api(`${API}/${c.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: c.lang }, components } }),
    });
  }
}

async function sendImage(imagePath, { kind, subject, title, date, due, part }) {
  const id = await upload(cfg(), imagePath, 'image/png');
  const header = { type: 'image', image: { id } };
  if (kind === 'circular') await sendTemplate('circular_image', header, [part ? `${title} (part ${part})` : title, date]);
  else await sendTemplate('homework_image', header, [part ? `${subject} (part ${part})` : subject, date, due]);
}

async function sendDocument(pdfPath, filename, { kind, subject, title, date, link }) {
  const id = await upload(cfg(), pdfPath, 'application/pdf');
  const header = { type: 'document', document: { id, filename } };
  if (kind === 'circular') await sendTemplate('circular_document', header, [title, date, link]);
  else await sendTemplate('homework_document', header, [subject, date, link]);
}

async function sendText(text) {
  await sendTemplate('homework_status', null, [text]);
}

// What each template must look like for this program to use it.
const EXPECTED = {
  homework_image: { header: 'IMAGE', vars: 3 },
  homework_document: { header: 'DOCUMENT', vars: 3 },
  homework_status: { header: null, vars: 1 },
  circular_image: { header: 'IMAGE', vars: 2 },
  circular_document: { header: 'DOCUMENT', vars: 3 },
};

// Reads the templates from Meta and explains, in plain words, anything that doesn't match.
async function checkTemplates() {
  const { token } = cfg();
  const waba = process.env.WA_WABA_ID;
  if (!waba) return ['(No WA_WABA_ID saved - run node src/setup-whatsapp.js)'];
  const res = await fetch(`${API}/${waba}/message_templates?fields=name,status,language,components&limit=100`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (body.error) return [`(Could not read templates: ${body.error.message})`];
  const lines = [];
  for (const [name, exp] of Object.entries(EXPECTED)) {
    const t = (body.data || []).find(x => x.name === name);
    if (!t) { lines.push(`❌ ${name}: not created yet`); continue; }
    const header = (t.components || []).find(c => c.type === 'HEADER');
    const text = ((t.components || []).find(c => c.type === 'BODY') || {}).text || '';
    const vars = new Set(text.match(/\{\{\s*\d+\s*\}\}/g) || []).size;
    const problems = [];
    if (vars !== exp.vars) problems.push(`body has ${vars} variable(s) but needs ${exp.vars} ({{1}}${exp.vars > 1 ? `..{{${exp.vars}}}` : ''})`);
    const hf = header ? header.format : null;
    if ((exp.header || null) !== (hf || null)) {
      problems.push(exp.header ? `header must be ${exp.header === 'IMAGE' ? 'an Image' : 'a Document'} (it is ${hf ? hf.toLowerCase() : 'none'})` : `header must be none (it is ${hf.toLowerCase()})`);
    }
    const status = t.status === 'APPROVED' ? 'approved' : t.status.toLowerCase().replace(/_/g, ' ');
    if (problems.length) lines.push(`❌ ${name} (${status}): ${problems.join('; ')}\n     Body now reads: "${text}"`);
    else lines.push(`${t.status === 'APPROVED' ? '✅' : '⏳'} ${name}: ${status}, set up correctly`);
  }
  return lines;
}

module.exports = { sendImage, sendDocument, sendText, checkTemplates, API };
