/*!
 * AKMS KeyManagement - JavaScript client (ES module)
 * ---------------------------------------------------
 * Works in modern browsers and Node 18+ (uses globalThis.fetch and
 * globalThis.crypto.subtle). No dependencies. Import it as a module
 * (browser: <script type="module">; Node: .mjs or "type":"module").
 *
 *   import { AKMSClient } from './akms-client.js';
 *
 *   const akms = new AKMSClient({
 *     serverUrl: 'https://keys.example.com',
 *     appSlug:   'my-app',          // omit for universal-only apps
 *     publicKeyPem: `-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----`,
 *   });
 *
 *   await akms.activate('VINZ-XXXX-XXXX-XXXX-XXXX');
 *   if (await akms.isLicensed()) { /* unlock the app *\/ }
 */

const ISSUER = 'AKMS';

/* ----------------------------- storage ----------------------------- */
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k),
      };
    }
  } catch (_) { /* fall through */ }
  const mem = new Map();
  return {
    get: (k) => (mem.has(k) ? mem.get(k) : null),
    set: (k, v) => { mem.set(k, v); },
    remove: (k) => { mem.delete(k); },
  };
}

/* --------------------------- base64 / hex -------------------------- */
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = (typeof atob === 'function')
    ? atob(s)
    : Buffer.from(s, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return b64urlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
}

function bytesToHex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

/* ------------------------------ client ----------------------------- */
export class AKMSClient {
  constructor(opts = {}) {
    if (!opts.serverUrl) throw new Error('AKMSClient: serverUrl is required.');
    if (!opts.publicKeyPem) throw new Error('AKMSClient: publicKeyPem is required.');
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.appSlug = opts.appSlug || null;
    this.publicKeyPem = opts.publicKeyPem;
    this.storage = opts.storage || defaultStorage();
    this.ns = opts.namespace || 'akms';
    this._cryptoKey = null;
  }

  _k(name) { return this.ns + '_' + name; }

  /** A stable per-device identifier (persisted locally). */
  getMachineId() {
    let id = this.storage.get(this._k('mid'));
    if (!id) {
      id = (globalThis.crypto && globalThis.crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : 'mid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.storage.set(this._k('mid'), id);
    }
    return id;
  }

  getLicenseKey() { return this.storage.get(this._k('key')); }
  getToken() { return this.storage.get(this._k('token')); }

  async _api(action, body) {
    const res = await globalThis.fetch(this.serverUrl + '/api.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }
    return data;
  }

  /** Activate a license key on this device. Returns the server response. */
  async activate(licenseKey, machineName) {
    const key = (licenseKey || '').trim();
    if (!key) throw new Error('A license key is required.');
    const data = await this._api('activate', {
      app: this.appSlug,
      license_key: key,
      machine_id: this.getMachineId(),
      machine_name: machineName || null,
    });
    if (data && data.valid && data.token) {
      this.storage.set(this._k('key'), key);
      this.storage.set(this._k('token'), data.token);
    }
    return data;
  }

  /** Online heartbeat: refreshes the token, catches revocation/expiry. */
  async validateOnline() {
    const key = this.getLicenseKey();
    if (!key) return { valid: false, error: 'no_license' };
    const data = await this._api('validate', {
      app: this.appSlug,
      license_key: key,
      machine_id: this.getMachineId(),
    });
    if (data && data.valid && data.token) {
      this.storage.set(this._k('token'), data.token);
    } else if (data && data.valid === false &&
      ['revoked', 'expired', 'invalid_license', 'not_activated'].includes(data.error)) {
      // Token is no longer trustworthy.
      this.storage.remove(this._k('token'));
    }
    return data;
  }

  async _importKey() {
    if (this._cryptoKey) return this._cryptoKey;
    const der = pemToDer(this.publicKeyPem);
    this._cryptoKey = await globalThis.crypto.subtle.importKey(
      'spki',
      der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return this._cryptoKey;
  }

  /**
   * Verify the cached token offline using only the public key.
   * Checks signature, issuer, token expiry, license expiry, app scope and
   * machine binding. Returns the claims object if valid, otherwise null.
   */
  async verifyOffline() {
    const token = this.getToken();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const key = await this._importKey();
    const sig = b64urlToBytes(parts[2]);
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const ok = await globalThis.crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
    if (!ok) return null;

    let claims;
    try { claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); }
    catch (_) { return null; }

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== ISSUER) return null;
    if (claims.exp && now >= claims.exp) return null;            // offline grace lapsed
    if (claims.lic_exp && now >= claims.lic_exp) return null;    // subscription ended
    if (claims.scope === 'app' && this.appSlug &&
      String(claims.app).toLowerCase() !== String(this.appSlug).toLowerCase()) return null;

    if (claims.mid) {
      const expect = await sha256Hex(this.getMachineId());
      if (expect !== claims.mid) return null;                   // bound to another device
    }
    return claims;
  }

  /**
   * Is this device licensed right now?
   * Tries a fast offline check first; if the token is missing or its offline
   * grace has lapsed, falls back to an online refresh.
   */
  async isLicensed() {
    const offline = await this.verifyOffline().catch(() => null);
    if (offline) return true;
    if (!this.getLicenseKey()) return false;
    const online = await this.validateOnline().catch(() => null);
    return !!(online && online.valid);
  }

  /** Release this device's activation slot and clear local state. */
  async deactivate() {
    const key = this.getLicenseKey();
    let data = { ok: true };
    if (key) {
      data = await this._api('deactivate', {
        app: this.appSlug,
        license_key: key,
        machine_id: this.getMachineId(),
      });
    }
    this.storage.remove(this._k('key'));
    this.storage.remove(this._k('token'));
    return data;
  }
}

export default AKMSClient;
