'use strict';
const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const multer = require('multer');
const { exec } = require('child_process');

const system = require('./lib/system');
const sites = require('./lib/sites');
const db = require('./lib/databases');
const php = require('./lib/php');
const ssl = require('./lib/ssl');
const files = require('./lib/files');
const services = require('./lib/services');
const paneldomain = require('./lib/paneldomain');
const akms = require('./lib/akms');

const CONFIG_PATH = path.join(__dirname, 'config', 'config.json');
function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function saveConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('config/config.json not found. Run install.sh first.');
  process.exit(1);
}
let config = loadConfig();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

const sessionMiddleware = session({
  secret: config.session_secret || 'change-me',
  name: 'vincontrol.sid',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

function auth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res))
  .catch((e) => res.status(400).json({ error: e.message || String(e) }));

// ---------- static (public assets only) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- setup / license gate ----------
// Setup is incomplete when there's no admin password OR no active license.
function setupIncomplete() { return akms.needsPassword(config) || !akms.licensedNow(); }

// Endpoints reachable without an active license (setup, auth, license status).
const LICENSE_OPEN = new Set([
  '/api/login', '/api/logout',
  '/api/setup/status', '/api/setup/password', '/api/setup/activate',
  '/api/license', '/api/license/activate', '/api/license/refresh', '/api/license/deactivate',
]);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (LICENSE_OPEN.has(req.path)) return next();
  if (akms.licensedNow()) return next();
  return res.status(402).json({ error: 'license_required', message: 'Aktivasi lisensi diperlukan untuk memakai Vincontrol.' });
});

// ---------- pages ----------
app.get('/setup', (req, res) => {
  if (!setupIncomplete()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'views', 'setup.html'));
});
app.get('/login', (req, res) => {
  if (setupIncomplete()) return res.redirect('/setup');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});
app.get('/', (req, res) => {
  if (setupIncomplete()) return res.redirect('/setup');
  if (!req.session.authed) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// ---------- first-run setup ----------
app.get('/api/setup/status', (req, res) => {
  res.json({
    needsPassword: akms.needsPassword(config),
    needsLicense: !akms.licensedNow(),
    pubkeyConfigured: akms.isConfigured(),
    appSlug: akms.appSlug(),
    machineId: akms.machineIdShort(),
  });
});
app.post('/api/setup/password', (req, res) => {
  if (config.password_hash) return res.status(403).json({ error: 'password already set; change it from Settings' });
  const pw = (req.body && req.body.password) || '';
  if (pw.length < 6) return res.status(400).json({ error: 'password too short (min 6)' });
  config.password_hash = bcrypt.hashSync(pw, 10);
  saveConfig(config);
  res.json({ ok: true });
});
app.post('/api/setup/activate', wrap(async (req, res) => {
  const key = ((req.body && req.body.licenseKey) || '').trim();
  if (!key) throw new Error('license key required');
  res.json(await akms.activate(key));
}));

// ---------- license (authenticated) ----------
app.get('/api/license', (req, res) => res.json(akms.status()));
app.post('/api/license/activate', auth, wrap(async (req, res) => {
  const key = ((req.body && req.body.licenseKey) || '').trim();
  if (!key) throw new Error('license key required');
  res.json(await akms.activate(key));
}));
app.post('/api/license/refresh', auth, wrap(async (req, res) => {
  await akms.refreshOnline().catch(() => {});
  res.json(akms.status());
}));
app.post('/api/license/deactivate', auth, wrap(async (req, res) => res.json(await akms.deactivate())));

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  if (!akms.licensedNow()) return res.status(402).json({ error: 'license_required', message: 'Selesaikan setup & aktivasi lisensi dulu.' });
  const password = (req.body && req.body.password) || '';
  if (!config.password_hash) return res.status(403).json({ error: 'setup required' });
  if (bcrypt.compareSync(password, config.password_hash)) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong password' });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => res.json({ ok: true }));

// ---------- system ----------
app.get('/api/system', auth, wrap(async (req, res) => res.json(await system.stats())));
app.get('/api/system/overview', auth, wrap(async (req, res) => {
  const o = system.overview();
  o.domain = config.domain || '';
  o.panelHost = config.domain ? paneldomain.panelHost(config.domain) : '';
  res.json(o);
}));

// ---------- sites ----------
app.get('/api/sites', auth, wrap((req, res) => res.json(sites.list())));
app.post('/api/sites', auth, wrap(async (req, res) => res.json(await sites.create(req.body, config))));
app.delete('/api/sites/:domain', auth, wrap(async (req, res) =>
  res.json(await sites.remove(req.params.domain, req.query.purge === '1', config))));
app.post('/api/sites/:domain/toggle', auth, wrap(async (req, res) =>
  res.json(await sites.toggle(req.params.domain, config))));

// ---------- php ----------
app.get('/api/php', auth, wrap((req, res) => res.json(php.versions())));

// ---------- databases ----------
app.get('/api/databases', auth, wrap(async (req, res) => res.json(await db.list(config))));
app.post('/api/databases', auth, wrap(async (req, res) => res.json(await db.create(req.body, config))));
app.delete('/api/databases/:name', auth, wrap(async (req, res) => res.json(await db.drop(req.params.name, config))));

// ---------- ssl ----------
app.post('/api/ssl', auth, wrap(async (req, res) => res.json(await ssl.issue(req.body, config))));

// ---------- services ----------
app.get('/api/services', auth, wrap(async (req, res) => res.json(await services.list())));
app.post('/api/services/:name/:action', auth, wrap(async (req, res) =>
  res.json(await services.control(req.params.name, req.params.action))));

// ---------- files ----------
app.get('/api/files', auth, wrap(async (req, res) => res.json(await files.list(req.query.path || config.www_root))));
app.get('/api/files/read', auth, wrap(async (req, res) => res.json(await files.read(req.query.path))));
app.post('/api/files/write', auth, wrap(async (req, res) => res.json(await files.write(req.body.path, req.body.content))));
app.post('/api/files/mkdir', auth, wrap(async (req, res) => res.json(await files.mkdir(req.body.path))));
app.post('/api/files/rename', auth, wrap(async (req, res) => res.json(await files.rename(req.body.from, req.body.to))));
app.delete('/api/files', auth, wrap(async (req, res) => res.json(await files.remove(req.query.path))));

const upload = multer({ dest: '/tmp/vincontrol-uploads' });
app.post('/api/files/upload', auth, upload.single('file'), wrap(async (req, res) =>
  res.json(await files.saveUpload(req.file, req.body.path))));

// ---------- command runner ----------
app.post('/api/exec', auth, (req, res) => {
  const cmd = ((req.body && req.body.cmd) || '').trim();
  if (!cmd) return res.status(400).json({ error: 'empty command' });
  const cwd = (req.body && req.body.cwd) || config.www_root || '/root';
  exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 * 10, cwd }, (err, stdout, stderr) => {
    res.json({ stdout, stderr, code: err ? (err.code || 1) : 0 });
  });
});

// ---------- settings ----------
app.post('/api/settings/password', auth, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(current || '', config.password_hash))
    return res.status(401).json({ error: 'current password is wrong' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'new password too short (min 6)' });
  config.password_hash = bcrypt.hashSync(next, 10);
  saveConfig(config);
  res.json({ ok: true });
});
app.post('/api/settings/port', auth, (req, res) => {
  const port = parseInt((req.body || {}).port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'invalid port' });
  config.port = port;
  saveConfig(config);
  res.json({ ok: true, note: 'restart panel for the new port to take effect (vincontrol restart)' });
});

// ---------- domain / SSL ----------
app.get('/api/settings/domain', auth, wrap(async (req, res) => {
  const st = await paneldomain.status(config.domain);
  st.serverIp = paneldomain.publicIp();
  st.port = config.port;
  res.json(st);
}));
app.get('/api/settings/dns', auth, wrap(async (req, res) => {
  const domain = (req.query.domain || '').trim().toLowerCase();
  if (!domain) throw new Error('domain required');
  res.json(await paneldomain.dnsCheck(domain));
}));
app.post('/api/settings/domain', auth, wrap(async (req, res) => {
  const domain = ((req.body && req.body.domain) || '').trim().toLowerCase();
  const email = ((req.body && req.body.email) || config.ssl_email || '').trim();
  const r = await paneldomain.apply(domain, config.port, email);
  config.domain = domain;
  if (email) config.ssl_email = email;
  saveConfig(config);
  res.json(r);
}));

// ---------- live stats over socket ----------
io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.authed) { socket.disconnect(true); return; }
  if (!akms.licensedNow()) { socket.emit('locked'); socket.disconnect(true); return; }
  const timer = setInterval(async () => {
    if (!akms.licensedNow()) { socket.emit('locked'); socket.disconnect(true); return; }
    try { socket.emit('stats', await system.stats()); } catch (e) { /* ignore */ }
  }, 2000);
  socket.on('disconnect', () => clearInterval(timer));
});

server.listen(config.port, config.host || '0.0.0.0', () => {
  console.log(`Vincontrol listening on http://${config.host || '0.0.0.0'}:${config.port}`);
  if (akms.needsPassword(config)) console.log('  -> first-run setup required (open the panel to set password + license)');
  else if (!akms.licensedNow()) console.log('  -> license inactive (open the panel to activate)');

  // License heartbeat: refresh token + catch revoke/expiry. Non-blocking.
  const beat = () => { akms.refreshOnline().catch(() => {}); };
  setTimeout(beat, 4000);                 // shortly after boot
  setInterval(beat, 12 * 60 * 60 * 1000); // every 12h
});
