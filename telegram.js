// Telegram Bot API sender (free, no templates needed).
const fs = require('fs');
const path = require('path');

function cfg() {
  const token = process.env.TG_BOT_TOKEN;
  const chats = (process.env.TG_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || !chats.length) throw new Error('TG_BOT_TOKEN and TG_CHAT_ID must be set');
  return { token, chats };
}

async function call(c, method, fields, fileField, filePath, fileName) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append(fileField, new Blob([fs.readFileSync(filePath)]), fileName || path.basename(filePath));
  const res = await fetch(`https://api.telegram.org/bot${c.token}/${method}`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram ${method} failed (${res.status}): ${body.description || 'unknown error'}`);
  return body;
}

// Captions are limited to 1024 characters.
const cap = s => s.slice(0, 1024);

async function sendImage(imagePath, { kind, subject, title, date, due, part, digest, count }) {
  const c = cfg();
  const p = part ? ` (part ${part})` : '';
  const caption = cap(kind === 'circular'
    ? (digest ? `📢 ${count} new circular${count > 1 ? 's' : ''} (${date})${p}: ${title}` : `📢 Circular${p}: ${title}\nPublished: ${date}`)
    : `📚 ${subject} homework for ${date}${p}\nDue: ${due}`);
  for (const chat_id of c.chats) await call(c, 'sendPhoto', { chat_id, caption }, 'photo', imagePath);
}

async function sendDocument(pdfPath, filename, { kind, subject, title, date, link }) {
  const c = cfg();
  const caption = cap(kind === 'circular'
    ? `📎 Attachment for circular "${title}" (${date})\n${link}`
    : `📎 Attachment for ${subject} homework (${date})\n${link}`);
  for (const chat_id of c.chats) await call(c, 'sendDocument', { chat_id, caption }, 'document', pdfPath, filename);
}

async function sendText(text) {
  const c = cfg();
  for (const chat_id of c.chats) {
    const res = await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: text.slice(0, 4000) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Telegram sendMessage failed: ${body.description || res.status}`);
  }
}

module.exports = { sendImage, sendDocument, sendText };
