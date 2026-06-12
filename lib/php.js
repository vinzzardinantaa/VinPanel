'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

function versions() {
  const found = new Set();
  try {
    fs.readdirSync('/etc/php').forEach((v) => { if (/^\d+\.\d+$/.test(v)) found.add(v); });
  } catch (e) { /* ignore */ }
  try {
    fs.readdirSync('/run/php').forEach((f) => {
      const m = f.match(/php(\d+\.\d+)-fpm\.sock/);
      if (m) found.add(m[1]);
    });
  } catch (e) { /* ignore */ }
  let cli = '';
  try { cli = execSync('php -v 2>/dev/null | head -1', { encoding: 'utf8' }).trim(); } catch (e) { /* ignore */ }
  return { versions: [...found].sort(), cli };
}

module.exports = { versions };
