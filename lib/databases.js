'use strict';
const { execFileSync } = require('child_process');

function mysql(cfg, sql) {
  const m = (cfg && cfg.mysql) || {};
  const args = [];
  if (m.user) args.push('-u' + m.user);
  if (m.password) args.push('-p' + m.password);
  if (m.host && m.host !== 'localhost') { args.push('-h'); args.push(m.host); }
  if (m.socket) { args.push('-S'); args.push(m.socket); }
  args.push('-N', '-B', '-e', sql);
  try {
    return execFileSync('mysql', args, { encoding: 'utf8' });
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || 'mysql error').toString();
    throw new Error(msg.replace(/^ERROR \d+ \([^)]+\):?\s*/i, '').trim() || 'mysql error');
  }
}

const validIdent = (s) => /^[A-Za-z0-9_]+$/.test(s);

async function list(cfg) {
  const out = mysql(cfg, 'SHOW DATABASES;');
  const skip = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);
  const dbs = out.split('\n').map((s) => s.trim()).filter(Boolean).filter((d) => !skip.has(d));

  const sizes = {};
  try {
    const s = mysql(cfg, 'SELECT table_schema, ROUND(SUM(data_length+index_length)/1024/1024,2) ' +
      'FROM information_schema.tables GROUP BY table_schema;');
    s.split('\n').filter(Boolean).forEach((line) => {
      const [n, mb] = line.split('\t');
      sizes[n] = Number(mb) || 0;
    });
  } catch (e) { /* sizes optional */ }

  return dbs.map((d) => ({ name: d, sizeMB: sizes[d] || 0 }));
}

async function create(body, cfg) {
  const name = (body.name || '').trim();
  if (!validIdent(name)) throw new Error('invalid database name (letters, numbers, underscore only)');
  const user = (body.user || name).trim();
  if (!validIdent(user)) throw new Error('invalid user name');
  const pass = body.password || '';
  if (!pass) throw new Error('password is required');
  const esc = pass.replace(/'/g, "''");

  mysql(cfg, 'CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
  mysql(cfg, "CREATE USER IF NOT EXISTS '" + user + "'@'%' IDENTIFIED BY '" + esc + "';");
  mysql(cfg, "CREATE USER IF NOT EXISTS '" + user + "'@'localhost' IDENTIFIED BY '" + esc + "';");
  mysql(cfg, 'GRANT ALL PRIVILEGES ON `' + name + "`.* TO '" + user + "'@'%';");
  mysql(cfg, 'GRANT ALL PRIVILEGES ON `' + name + "`.* TO '" + user + "'@'localhost';");
  mysql(cfg, 'FLUSH PRIVILEGES;');
  return { name, user, ok: true };
}

async function drop(name, cfg) {
  if (!validIdent(name)) throw new Error('invalid name');
  mysql(cfg, 'DROP DATABASE `' + name + '`;');
  return { ok: true };
}

module.exports = { list, create, drop };
