'use strict';
/**
 * AKMS KeyManagement — vendor configuration for Vincontrol.
 *
 * Values identify YOUR AKMS server and pin the signing key. They can also be
 * supplied via environment variables (handy for systemd) which override these:
 *
 *   AKMS_SERVER_URL   e.g. https://key-server.vinzz.dev
 *   AKMS_APP_SLUG     e.g. vincontrol   (empty string = universal licenses)
 *   AKMS_PUBLIC_KEY   full PEM, with literal \n between lines
 *
 * SECURITY (see clients/AKMS-INTEGRATION.md §3):
 *   • The PUBLIC key is pinned here — never the private key (that stays on your
 *     AKMS server). A pinned public key cannot be MITM-swapped at runtime.
 *   • Refresh it from the AKMS panel → "Signing key" if you ever rotate keys, or
 *         curl -s "https://key-server.vinzz.dev/api.php?action=pubkey"
 *   • Register this app (slug "vincontrol") under AKMS → Apps for per-app
 *     licenses, or issue UNIVERSAL licenses and set APP_SLUG to null.
 */
module.exports = {
  SERVER_URL: 'https://key-server.vinzz.dev',

  // Per-app license scope. Set to null to accept universal licenses.
  APP_SLUG: 'vincontrol',

  // Pinned AKMS signing public key (pairs with your server's private key).
  PUBLIC_KEY_PEM: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr/G63HT6E7uK5icbqwk2
2HcV/F+EuxOFP3y27G1zWXyE/FCtip6Wqf9YDIsVo3J6sHBAnn7QinGCflMZqTmG
uAjq65fXNcwwfx9JzQlAzwV5zPnHG29YxqDXZVrfK8lCBJE5ujJjhbTZYZxOkHLh
ARjsE1ihZOZWQhtf0IKMs56rFx4bRJPbPhtt9AaRx+1Ldi3Io4syDcP4/yFF/POm
1WRuU0jZzfl9khT/wXm5a/tWY8IPoY1JE+vooT1yGqrkG5GCK+YDJ7DFt6KPBJwZ
+zxjk3utTrTEBF26Ig8GaaYOWWZ780nrQnTa3nBcMchW00knVMzdPYoLbV5EdHBl
sQIDAQAB
-----END PUBLIC KEY-----`,
};
