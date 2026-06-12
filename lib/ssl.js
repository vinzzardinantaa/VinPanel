'use strict';
const { execFileSync } = require('child_process');

async function issue(body, cfg) {
  const domain = (body.domain || '').trim().toLowerCase();
  const email = (body.email || (cfg && cfg.ssl_email) || '').trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) throw new Error('invalid domain');
  if (!email) throw new Error('an email is required for Let\'s Encrypt registration');

  const args = ['--nginx', '-d', domain, '--non-interactive', '--agree-tos', '-m', email, '--redirect'];
  try {
    const out = execFileSync('certbot', args, { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output: out.slice(-2000) };
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || 'certbot failed').toString();
    throw new Error(msg.slice(-2000));
  }
}

module.exports = { issue };
