'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STORE = path.join(__dirname, '..', 'config', 'sites.json');
function load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return []; } }
function save(d) { fs.writeFileSync(STORE, JSON.stringify(d, null, 2)); }

function list() { return load(); }

function confPath(cfg, domain) { return path.join(cfg.nginx_conf_dir, domain + '.conf'); }
function disabledPath(cfg, domain) { return path.join(cfg.nginx_conf_dir, domain + '.conf.disabled'); }

function template(o) {
  const phpBlock = o.phpVersion ? `
    location ~ \\.php$ {
        fastcgi_pass unix:/run/php/php${o.phpVersion}-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
` : '';
  return `# Managed by Vincontrol - do not hand-edit unless you know what you're doing
server {
    listen 80;
    listen [::]:80;
    server_name ${o.domain};
    root ${o.root};
    index index.php index.html index.htm;

    access_log /var/log/nginx/${o.domain}.access.log;
    error_log  /var/log/nginx/${o.domain}.error.log;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
${phpBlock}
    location ~ /\\.(?!well-known) {
        deny all;
    }
}
`;
}

function reloadNginx() {
  try {
    execSync('nginx -t', { stdio: 'pipe' });
  } catch (e) {
    throw new Error('nginx config test failed: ' + (e.stderr ? e.stderr.toString() : e.message));
  }
  execSync('systemctl reload nginx');
}

async function create(body, cfg) {
  const domain = (body.domain || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) throw new Error('invalid domain name');
  const all = load();
  if (all.find((s) => s.domain === domain)) throw new Error('site already exists');

  const root = (body.root && body.root.trim()) || path.join(cfg.www_root, domain);
  const phpVersion = body.phpVersion || '';

  fs.mkdirSync(root, { recursive: true });
  const idx = path.join(root, 'index.html');
  if (!fs.existsSync(idx) && !fs.existsSync(path.join(root, 'index.php'))) {
    fs.writeFileSync(idx,
      `<!doctype html><html><head><meta charset="utf-8"><title>${domain}</title></head>` +
      `<body style="font-family:system-ui;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0">` +
      `<div style="text-align:center"><h1 style="color:#34d3c0;margin:0">${domain}</h1>` +
      `<p style="color:#7d8896">Provisioned by Vincontrol &#10022; VinzzApps</p></div></body></html>`);
  }
  try { execSync('chown -R www-data:www-data ' + JSON.stringify(root)); } catch (e) { /* non-fatal */ }

  fs.writeFileSync(confPath(cfg, domain), template({ domain, root, phpVersion }));
  reloadNginx();

  const rec = { domain, root, phpVersion, ssl: false, enabled: true, created: Date.now() };
  all.push(rec);
  save(all);
  return rec;
}

async function remove(domain, purge, cfg) {
  const all = load();
  const rec = all.find((s) => s.domain === domain);
  for (const p of [confPath(cfg, domain), disabledPath(cfg, domain)]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  reloadNginx();
  save(all.filter((s) => s.domain !== domain));
  if (purge && rec && rec.root && rec.root.startsWith(cfg.www_root)) {
    try { execSync('rm -rf ' + JSON.stringify(rec.root)); } catch (e) { /* ignore */ }
  }
  return { ok: true };
}

async function toggle(domain, cfg) {
  const all = load();
  const rec = all.find((s) => s.domain === domain);
  if (!rec) throw new Error('site not found');
  const enabled = confPath(cfg, domain);
  const disabled = disabledPath(cfg, domain);
  if (rec.enabled) {
    if (fs.existsSync(enabled)) fs.renameSync(enabled, disabled);
    rec.enabled = false;
  } else {
    if (fs.existsSync(disabled)) fs.renameSync(disabled, enabled);
    rec.enabled = true;
  }
  reloadNginx();
  save(all);
  return rec;
}

module.exports = { list, create, remove, toggle };
