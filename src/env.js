// Loads KEY="value" lines from .env into process.env (existing variables win).
// Works on any Node version (process.loadEnvFile only exists on Node 20.12+).
const fs = require('fs');

function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1');
    else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

module.exports = { load };
