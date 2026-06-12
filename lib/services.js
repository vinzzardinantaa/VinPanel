'use strict';
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

const ALLOW = [
  /^nginx$/, /^mysql$/, /^mysqld$/, /^mariadb$/,
  /^php\d+\.\d+-fpm$/, /^redis$/, /^redis-server$/, /^vincontrol$/
];
const ACTIONS = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];

const allowed = (name) => ALLOW.some((r) => r.test(name));

function status(name) {
  try { return execSync('systemctl is-active ' + name, { encoding: 'utf8' }).trim(); }
  catch (e) { return ((e.stdout || 'inactive').toString()).trim() || 'inactive'; }
}

async function control(name, action) {
  if (!allowed(name)) throw new Error('service "' + name + '" is not in the managed allowlist');
  if (!ACTIONS.includes(action)) throw new Error('invalid action');
  try {
    execFileSync('systemctl', [action, name], { stdio: 'pipe' });
  } catch (e) {
    throw new Error((e.stderr || e.message || 'systemctl failed').toString());
  }
  return { ok: true, name, action, status: status(name) };
}

async function list() {
  let candidates = ['nginx', 'mysql', 'mariadb', 'redis-server', 'redis', 'vincontrol'];
  try {
    fs.readdirSync('/etc/php').forEach((v) => { if (/^\d+\.\d+$/.test(v)) candidates.push('php' + v + '-fpm'); });
  } catch (e) { /* ignore */ }
  candidates = [...new Set(candidates)];

  const result = [];
  for (const c of candidates) {
    let exists = false;
    try {
      const o = execSync('systemctl list-unit-files ' + c + '.service 2>/dev/null', { encoding: 'utf8' });
      if (o.includes(c + '.service')) exists = true;
    } catch (e) { /* not found */ }
    if (!exists) continue;
    result.push({ name: c, status: status(c) });
  }
  return result;
}

module.exports = { control, list };
