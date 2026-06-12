'use strict';
/**
 * AKMS KeyManagement — server-side license client for Vincontrol (Node).
 *
 * Mirrors the AKMS protocol (activate / validate / deactivate + offline JWT
 * RS256 verification) from akms-client.js, but built for a long-running server:
 *   • state (license key, token, machine id) persisted to config/akms-state.json (0600)
 *   • offline signature verification via node:crypto (RSA-SHA256 / PKCS1 v1.5)
 *   • machine id seeded from /etc/machine-id so it's stable across reinstalls
 *
 * License is enforced SERVER-SIDE: every /api/* data route is gated on a valid
 * token (see server.js). Tokens are signed by your AKMS private key, so they
 * cannot be forged or edited, and are bound to this machine via sha256(machine_id).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./akms.config');

const STATE_PATH = path.join(__dirname, '..', 'config', 'akms-state.json');
const ISSUER = 'AKMS';
const PLACEHOLDER = 'PASTE_YOUR_AKMS_PUBLIC_KEY_HERE';

// Resolve vendor config (env overrides the pinned constants).
const PUBLIC_KEY_PEM = process.env.AKMS_PUBLIC_KEY
  ? process.env.AKMS_PUBLIC_KEY.replace(/\\n/g, '\n')
  : cfg.PUBLIC_KEY_PEM;
const SERVER_URL = (process.env.AKMS_SERVER_URL || cfg.SERVER_URL || '').replace(/\/+$/, '');
const APP_SLUG = (process.env.AKMS_APP_SLUG !== undefined)
  ? (process.env.AKMS_APP_SLUG || null)
  : (cfg.APP_SLUG || null);

/* ------------------------------ state ------------------------------ */
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (d && typeof d === 'object') return d;
    }
  } catch (e) { /* ignore */ }
  return {};
}
function saveState(s) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
    fs.chmodSync(STATE_PATH, 0o600);
  } catch (e) { /* ignore */ }
}
let state = loadState();

/* --------------------------- helpers ------------------------------- */
function isConfigured() {
  return typeof PUBLIC_KEY_PEM === 'string'
    && PUBLIC_KEY_PEM.includes('BEGIN PUBLIC KEY')
    && !PUBLIC_KEY_PEM.includes(PLACEHOLDER);
}
function serverUrl() { return SERVER_URL; }
function appSlug() { return APP_SLUG; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function machineId() {
  if (state.mid) return state.mid;
  let raw = '';
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try { raw = fs.readFileSync(p, 'utf8').trim(); if (raw) break; } catch (e) { /* next */ }
  }
  if (!raw) raw = crypto.randomBytes(16).toString('hex');
  // namespace so the id is stable yet specific to this panel install
  state.mid = crypto.createHash('sha256').update('vincontrol:' + raw).digest('hex').slice(0, 32);
  saveState(state);
  return state.mid;
}
function machineIdShort() { const m = machineId(); return m.slice(0, 8) + '…' + m.slice(-4); }

/* ------------------------------ http ------------------------------- */
async function api(action, body) {
  if (!SERVER_URL) return { valid: false, error: 'not_configured', message: 'AKMS server URL not set' };
  try {
    const res = await fetch(SERVER_URL + '/api.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') {
      return { valid: false, error: res.ok ? 'bad_response' : 'network', message: 'server returned HTTP ' + res.status };
    }
    return data;
  } catch (e) {
    return { valid: false, error: 'network', message: e.message || 'request failed' };
  }
}

async function activate(licenseKey, machineName) {
  const key = (licenseKey || '').trim();
  if (!key) throw new Error('license key required');
  if (!isConfigured()) {
    return { valid: false, error: 'not_configured', message: 'AKMS public key not set in lib/akms.config.js' };
  }
  const data = await api('activate', {
    app: appSlug(),
    license_key: key,
    machine_id: machineId(),
    machine_name: machineName || os.hostname() || null,
  });
  if (data && data.valid && data.token) {
    state.key = key;
    state.token = data.token;
    saveState(state);
  }
  return data;
}

async function validateOnline() {
  const key = state.key;
  if (!key) return { valid: false, error: 'no_license' };
  const data = await api('validate', { app: appSlug(), license_key: key, machine_id: machineId() });
  if (data && data.valid && data.token) {
    state.token = data.token;
    saveState(state);
  } else if (data && data.valid === false &&
    ['revoked', 'expired', 'invalid_license', 'not_activated', 'app_mismatch', 'app_unavailable'].includes(data.error)) {
    delete state.token;
    saveState(state);
  }
  return data;
}

async function deactivate() {
  const key = state.key;
  let data = { ok: true };
  if (key) data = await api('deactivate', { app: appSlug(), license_key: key, machine_id: machineId() });
  delete state.key;
  delete state.token;
  saveState(state);
  return data;
}

/* --------------------------- offline JWT --------------------------- */
function verifyOffline() {
  const token = state.token;
  if (!token || !isConfigured()) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const ok = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), PUBLIC_KEY_PEM, b64urlToBuf(parts[2]));
    if (!ok) return null;
  } catch (e) { return null; }

  let claims;
  try { claims = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')); } catch (e) { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) return null;
  if (claims.exp && now >= claims.exp) return null;                 // offline grace lapsed
  if (claims.lic_exp && now >= claims.lic_exp) return null;         // subscription ended
  if (claims.scope === 'app' && appSlug() &&
    String(claims.app || '').toLowerCase() !== String(appSlug()).toLowerCase()) return null;
  if (claims.mid && claims.mid !== sha256hex(machineId())) return null; // bound to another machine
  return claims;
}
function licensedNow() { return verifyOffline() !== null; }

async function isLicensed() {
  if (licensedNow()) return true;
  if (!state.key) return false;
  const r = await validateOnline().catch(() => null);
  return !!(r && r.valid);
}

function status() {
  const claims = verifyOffline();
  return {
    licensed: !!claims,
    configured: isConfigured(),
    app: appSlug(),
    keyMasked: state.key ? (state.key.slice(0, 9) + '…' + state.key.slice(-4)) : null,
    machineId: machineIdShort(),
    scope: claims ? claims.scope : null,
    type: claims ? claims.type : null,
    licExp: claims && claims.lic_exp ? claims.lic_exp : null,
    tokenExp: claims && claims.exp ? claims.exp : null,
  };
}

function needsPassword(config) { return !config || !config.password_hash; }

module.exports = {
  activate, validateOnline, deactivate, verifyOffline, licensedNow, isLicensed,
  status, isConfigured, serverUrl, appSlug, machineId, machineIdShort, needsPassword,
  refreshOnline: validateOnline,
};
