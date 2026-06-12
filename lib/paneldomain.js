'use strict';
const fs = require('fs');
const dns = require('dns').promises;
const { execFileSync, execSync } = require('child_process');

const PANEL_VHOST = '/etc/nginx/conf.d/_vincontrol_panel.conf';
const PMA_SNIPPET = '/etc/nginx/snippets/vincontrol-pma.conf';
const PREFIX = 'vpanel';

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

function panelHost(domain) { return PREFIX + '.' + domain; }

function publicIp() {
  try {
    const ip = execSync(
      'curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || ' +
      'curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null',
      { encoding: 'utf8' }
    ).trim();
    if (ip) return ip;
  } catch (e) { /* fall through */ }
  try { return execSync("hostname -I | awk '{print $1}'", { encoding: 'utf8' }).trim(); }
  catch (e) { return ''; }
}

async function resolveA(host) { try { return await dns.resolve4(host); } catch (e) { return []; } }

async function dnsCheck(domain) {
  domain = (domain || '').trim().toLowerCase();
  const host = panelHost(domain);
  const ips = await resolveA(host);
  const me = publicIp();
  return { host, ips, serverIp: me, ok: me ? ips.includes(me) : ips.length > 0 };
}

function vhostConf(host, port) {
  const inc = fs.existsSync(PMA_SNIPPET) ? '    include ' + PMA_SNIPPET + ';\n\n' : '';
  return `# Managed by Vincontrol - panel access (do not hand-edit)
server {
    listen 80;
    listen [::]:80;
    server_name ${host};

${inc}    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
`;
}

function reload() {
  execSync('nginx -t', { stdio: 'pipe' });
  execSync('systemctl reload nginx');
}

function certExists(host) { try { return fs.existsSync('/etc/letsencrypt/live/' + host); } catch (e) { return false; } }

async function apply(domain, port, email) {
  domain = (domain || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) throw new Error('invalid domain (example: mydomain.com)');
  const host = panelHost(domain);

  fs.writeFileSync(PANEL_VHOST, vhostConf(host, port));
  try { reload(); }
  catch (e) { throw new Error('nginx failed: ' + (e.stderr ? e.stderr.toString() : e.message)); }

  let ssl = certExists(host);
  let sslError = null;
  if (email) {
    const chk = await dnsCheck(domain);
    if (chk.ips.length === 0) {
      sslError = 'DNS for ' + host + ' does not resolve yet - add the A record, then retry';
    } else {
      try {
        execFileSync('certbot', ['--nginx', '-d', host, '--non-interactive', '--agree-tos', '-m', email],
          { stdio: 'pipe' });
        ssl = true;
      } catch (e) {
        sslError = (e.stderr || e.stdout || e.message || 'certbot failed').toString().slice(-700);
      }
    }
  }
  return { host, ssl, sslError };
}

async function status(domain) {
  if (!domain) return { configured: false };
  const host = panelHost(domain);
  return { configured: true, domain, host, ssl: certExists(host) };
}

module.exports = { apply, status, dnsCheck, panelHost, publicIp, PMA_SNIPPET };
