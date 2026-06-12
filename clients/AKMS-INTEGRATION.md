# Panduan Integrasi Lisensi AKMS

Dokumen ini menjelaskan cara menambahkan **lisensi AKMS** ke aplikasi apa pun
milikmu, dengan benar, **aman**, dan dengan **validasi yang lancar** (tidak
mengunci pengguna sah hanya karena internet sempat putus).

Taruh file ini di project mana pun yang akan memakai AKMS. Saat memintaku
mengerjakannya, cukup bilang **"pakai AKMS KeyManagement"** dan sertakan file ini.

---

## Daftar isi
1. [Cara kerja & model keamanan](#1-cara-kerja--model-keamanan)
2. [Yang kamu butuhkan dulu](#2-yang-kamu-butuhkan-dulu)
3. [Aturan keamanan — WAJIB dibaca](#3-aturan-keamanan--wajib-dibaca)
4. [Pasang SDK klien](#4-pasang-sdk-klien)
5. [Alur integrasi (aktivasi → validasi → refresh)](#5-alur-integrasi)
6. [Contoh implementasi lengkap](#6-contoh-implementasi-lengkap)
7. [Strategi validasi: lancar tapi aman](#7-strategi-validasi-lancar-tapi-aman)
8. [Menerbitkan lisensi (panel & API)](#8-menerbitkan-lisensi)
9. [Referensi API & klaim token](#9-referensi-api--klaim-token)
10. [Checklist keamanan sebelum produksi](#10-checklist-keamanan-sebelum-produksi)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Cara kerja & model keamanan

AKMS memakai **kriptografi kunci publik (RSA-2048)** + **token JWT (RS256)** dengan
model **hybrid online/offline**:

```
                ┌────────────────────────── AKMS server (key-server.vinzz.dev) ──────────────┐
                │  • Menyimpan PRIVATE KEY (rahasia, tidak pernah keluar)                     │
                │  • DB lisensi: status, expiry, scope, batas device                          │
                └────────────────────────────────────────────────────────────────────────────┘
   (1) activate(serial, machine_id)            ▲                         │  (2) token JWT ber-tanda tangan
        ───────────────────────────────────────┘                         ▼
   ┌──────────────────────── Aplikasimu (klien) ──────────────────────────────────────────────┐
   │  • Hanya pegang PUBLIC KEY (ditanam di kode)                                               │
   │  • Verifikasi tanda tangan token secara OFFLINE → tahu lisensi asli & belum diubah         │
   │  • Refresh ONLINE berkala → menangkap pencabutan / habis langganan                          │
   └───────────────────────────────────────────────────────────────────────────────────────────┘
```

Alurnya:
1. Pengguna memasukkan serial (mis. `VINZ-XXXX-XXXX-XXXX-XXXX`). App memanggil
   `activate` ke server **sekali**, mengirim serial + *fingerprint* perangkat.
2. Server memvalidasi (aktif? belum kedaluwarsa? device belum melebihi batas?),
   mencatat aktivasi, lalu mengembalikan **token JWT** yang ditandatangani dengan
   private key dan **terikat ke perangkat itu**.
3. App memverifikasi tanda tangan token memakai **public key** — tanpa internet —
   setiap kali dibuka, sampai token kedaluwarsa (*offline grace*).
4. Secara berkala app **refresh** online untuk memperbarui token dan menangkap
   pencabutan (revoke) atau langganan yang habis.

### Apa yang membuat ini aman

- **Tidak bisa dipalsukan.** Hanya pemegang *private key* (server kamu) yang bisa
  membuat token yang tanda tangannya cocok dengan *public key* yang kamu tanam.
  Tanpa private key, tidak ada yang bisa membuat lisensi palsu yang lolos.
- **Anti-ubah.** Mengubah isi token (misalnya memperpanjang `lic_exp` atau ganti
  `scope`) langsung merusak tanda tangannya → ditolak saat verifikasi.
- **Terikat perangkat.** Token memuat `mid = sha256(machine_id)`. Menyalin token
  ke mesin lain akan gagal verifikasi offline karena `mid`-nya tidak cocok.
- **Bisa dicabut.** Revoke/expiry tertangkap pada refresh online berikutnya
  (dalam rentang `grace_days`). Mau pencabutan lebih cepat? Kecilkan `grace_days`.

### Batasan yang harus kamu sadari (jujur)

Tanda tangan kriptografis mencegah **pemalsuan lisensi**, **bukan** mencegah orang
mengedit aplikasimu untuk **melewati pengecekan**. Ini berlaku untuk *semua*
proteksi sisi-klien — seseorang yang membongkar/patch binari atau kode app bisa
saja menghapus panggilan `isLicensed()`.

Mitigasi:
- Untuk app biasa, AKMS sudah menaikkan palang jauh lebih tinggi dari sekadar
  "cek string serial".
- Untuk **fitur bernilai tinggi**, jangan hanya mengandalkan cek di klien — taruh
  logika/aset penting **di sisi server** dan layani hanya setelah AKMS memvalidasi.
  Dengan begitu, membongkar klien tidak otomatis membuka nilainya.
- Obfuscation/minify menambah hambatan, tapi bukan jaminan.

---

## 2. Yang kamu butuhkan dulu

Sebelum integrasi, siapkan dari panel admin AKMS:

| Item | Dari mana | Wajib? |
|---|---|---|
| **Server URL** | URL instalasi AKMS-mu, mis. `https://key-server.vinzz.dev` | Ya |
| **Public key (PEM)** | Menu **Signing key** (atau `GET /api.php?action=pubkey`) | Ya |
| **App slug** | Menu **Apps** → daftarkan app (mis. `my-app`) | Hanya jika pakai lisensi *per-app* |
| **API key** | Menu **API keys** → buat key | Hanya jika mau terbitkan lisensi dari kode |

> Lisensi **universal** berlaku di semua app dan **tidak butuh** app slug. Lisensi
> **per-app** terkunci ke satu slug — app harus mengirim slug yang sama.

---

## 3. Aturan keamanan — WAJIB dibaca

1. **JANGAN PERNAH** menaruh *private key* di aplikasi klien. Klien hanya butuh
   *public key*. Private key hanya ada di server AKMS.
2. **Tanam (pin) public key sebagai konstanta** di kode app. Jangan mengambilnya
   dari server saat runtime tanpa pinning — kalau diambil mentah dari jaringan,
   penyerang bisa MITM dan menukar kunci. Menanamnya = mengunci kunci tepercaya.
3. **Selalu HTTPS** untuk semua panggilan ke AKMS. Token dan API key setara
   kredensial; jangan lewat HTTP polos.
4. **Jangan percaya status yang dilaporkan klien.** Sumber kebenaran adalah
   **tanda tangan token** (diverifikasi dengan public key), bukan flag yang dikirim
   balik oleh klien.
5. **Simpan token & `machine_id` lokal** (file/penyimpanan app). Ini bukan rahasia
   tinggi, tapi token terikat ke `machine_id`; jangan menyalinnya antar mesin.
6. **API key = rahasia server.** Jangan pernah menaruh API key di aplikasi klien,
   HTML, atau JS front-end. API key hanya untuk **backend ke backend** (mis. server
   pembayaranmu memanggil `admin-api.php`). Simpan di environment variable.
7. **Fitur sensitif → validasi di server**, bukan hanya di klien (lihat §1 batasan).

---

## 4. Pasang SDK klien

Salin SDK dari folder `clients/` paket AKMS:

- **JavaScript** (browser / Electron / Node 18+): `akms-client.js` — ES module,
  verifikasi offline pakai Web Crypto, tanpa dependensi.
- **PHP**: `akms-client.php` — verifikasi offline pakai ekstensi `openssl`,
  aktivasi via cURL.

Keduanya butuh tiga hal: **server URL**, **public key (PEM)**, dan (untuk lisensi
per-app) **app slug**.

> Catatan: untuk bahasa lain (Python, C#, Go, dst.), token adalah **JWT RS256
> standar** — verifikasi dengan library JWT apa pun memakai public key, lalu
> periksa klaim `iss`, `exp`, `lic_exp`, `scope`/`app`, dan `mid` (lihat §9).

---

## 5. Alur integrasi

### 5a. Aktivasi (sekali, saat pengguna memasukkan serial)
Kirim serial + fingerprint perangkat ke server. Kalau valid, SDK menyimpan token.

### 5b. Pengecekan saat app dibuka
Panggil `isLicensed()`. SDK akan:
1. **Verifikasi token offline** (cek tanda tangan + `exp`/`lic_exp`/`scope`/`mid`).
   Kalau token masih dalam masa *offline grace* → **true** tanpa internet.
2. Kalau token tidak ada / masa grace habis → coba **refresh online**. Kalau server
   bilang valid → true; kalau dicabut/kedaluwarsa → false.

### 5c. Refresh berkala (opsional, untuk pencabutan lebih cepat)
Panggil `validateOnline()` (mis. sekali per hari, atau saat start). Ini memperbarui
token (memperpanjang offline grace) dan menangkap revoke/expiry lebih awal.

### 5d. Deaktivasi (saat pengguna pindah perangkat)
Panggil `deactivate()` untuk membebaskan slot aktivasi dan menghapus token lokal.

---

## 6. Contoh implementasi lengkap

### JavaScript

```js
import { AKMSClient } from './akms-client.js';

// --- Konfigurasi (tanam public key sebagai konstanta) ---
const akms = new AKMSClient({
  serverUrl: 'https://key-server.vinzz.dev',
  appSlug:   'my-app',          // hilangkan/ null untuk universal-only
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
... tempel dari menu Signing key ...
-----END PUBLIC KEY-----`,
});

// --- Saat app dibuka ---
async function boot() {
  if (await akms.isLicensed()) {
    startApp();                 // verifikasi offline dulu, refresh online bila perlu
  } else {
    showActivationScreen();     // minta pengguna memasukkan serial
  }
}

// --- Saat pengguna submit serial ---
async function onActivate(serial) {
  const res = await akms.activate(serial.trim());
  if (res.valid) {
    startApp();
  } else {
    // tampilkan pesan sesuai error (lihat §7 untuk daftar kode)
    showError(res.message || 'Lisensi tidak valid.');
  }
}

// --- (opsional) refresh harian untuk menangkap revoke lebih cepat ---
async function dailyCheck() {
  const res = await akms.validateOnline();
  if (res.valid === false && ['revoked', 'expired'].includes(res.error)) {
    lockApp(res.message);       // langganan habis / dicabut
  }
}

// --- saat pengguna mau pindah perangkat ---
async function onDeactivate() {
  await akms.deactivate();
  showActivationScreen();
}
```

### PHP

```php
require __DIR__ . '/akms-client.php';

$akms = new AKMSClient([
  'serverUrl'    => 'https://key-server.vinzz.dev',
  'appSlug'      => 'my-app',                 // null untuk universal-only
  'publicKeyPem' => "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  // 'statePath' => __DIR__ . '/akms-state.json',  // tempat token di-cache
]);

// Saat app dibuka:
if (!$akms->isLicensed()) {
    // Belum teraktivasi → minta serial dari pengguna, lalu:
    $res = $akms->activate($_POST['serial'] ?? '');
    if (empty($res['valid'])) {
        exit('Lisensi tidak valid: ' . ($res['message'] ?? 'unknown'));
    }
}

// ... lanjut jalankan app ...
```

---

## 7. Strategi validasi: lancar tapi aman

Tujuannya: **jangan mengunci pengguna sah** hanya karena internet putus, tapi tetap
menangkap pencabutan/kedaluwarsa.

### Bagaimana SDK menyeimbangkannya
- `isLicensed()` **mendahulukan verifikasi offline**. Selama token masih dalam masa
  `grace_days`, app jalan **tanpa internet**. Internet putus sebentar → tidak
  mengganggu.
- Online hanya dibutuhkan saat masa grace **habis** (token `exp` lewat). Saat itu
  SDK mencoba refresh; kalau gagal jaringan, `isLicensed()` mengembalikan `false`
  (perilaku default = **fail-closed** setelah grace habis).

### Atur `grace_days` sesuai kebutuhan (saat menerbitkan lisensi)
- **Langganan bulanan**: default 7 hari. Artinya app boleh offline ≤7 hari; setelah
  itu wajib menyapa server (untuk memastikan langganan belum dibatalkan).
- **Permanen**: default 3650 hari (≈ offline selamanya, tapi tetap bisa dicabut saat
  sesekali online). Kecilkan kalau ingin kontrol pencabutan lebih ketat.
- **Trade-off**: `grace_days` besar = lebih ramah offline, tapi pencabutan butuh
  lebih lama sampai berlaku. `grace_days` kecil = pencabutan cepat, tapi lebih
  sering butuh internet.

### Pola "fail-open lunak" (opsional, kalau mau lebih ramah)
Kalau setelah grace habis refresh gagal karena **jaringan** (bukan revoke pasti),
kamu bisa memberi toleransi tambahan singkat. SDK membedakannya:
- `validateOnline()` saat jaringan mati → `{ valid:false, error:'network' }`.
- `validateOnline()` saat dicabut → `{ valid:false, error:'revoked' }` (token lokal
  dihapus).

Jadi kamu bisa: **lock hanya jika `error` ∈ {revoked, expired, invalid_license}**,
dan untuk `error === 'network'` beri pengguna masa tenggang ekstra (mis. tampilkan
peringatan "tidak bisa memverifikasi, harap online dalam X hari").

### Kapan memanggil online (jangan berlebihan)
- **Saat start app**: `isLicensed()` (otomatis refresh kalau grace lewat).
- **Sekali per hari** (opsional): `validateOnline()` untuk revoke lebih cepat.
- **Jangan** memanggil tiap aksi/klik — boros dan tidak perlu.

### Tangani tiap kode error `activate`/`validate`
| `error` | Arti | Saran pesan ke pengguna |
|---|---|---|
| `invalid_license` | Serial tidak ditemukan | "Serial tidak ditemukan. Periksa kembali." |
| `revoked` | Lisensi dicabut | "Lisensi ini telah dinonaktifkan." |
| `expired` | Langganan habis | "Langganan sudah berakhir. Perpanjang untuk lanjut." |
| `app_mismatch` | Serial untuk app lain | "Serial ini bukan untuk aplikasi ini." |
| `app_unavailable` | App lisensi sudah dihapus | "Lisensi tidak berlaku lagi. Hubungi penjual." |
| `activation_limit` | Batas perangkat tercapai | "Batas perangkat tercapai. Lepas perangkat lama dulu." |
| `not_activated` | `validate` di perangkat yang belum aktivasi | Jalankan `activate` dulu. |
| `bad_request` | Parameter kurang | Kesalahan integrasi — cek `license_key`/`machine_id`. |
| `network` (SDK) | Tidak bisa menghubungi server | Cek koneksi; pakai pola fail-open lunak di atas. |

---

## 8. Menerbitkan lisensi

### A. Dari panel admin (manual)
Menu **Issue license** → pilih tipe (Permanent/Monthly), scope (Universal/App),
batas perangkat, dan offline grace → sistem membuat serial unik. Bagikan ke
pelanggan.

### B. Dari kode (otomatis, mis. saat pembayaran) — Management API
Pakai **API key** (header `Authorization: Bearer ...`). **Hanya dari backend.**

```bash
curl -X POST "https://key-server.vinzz.dev/admin-api.php?action=licenses.create" \
  -H "Authorization: Bearer akms_sk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
        "type": "monthly",
        "scope": "app",
        "app": "my-app",
        "months": 12,
        "max_activations": 1,
        "customer_email": "buyer@example.com",
        "notes": "order #1234"
      }'
```

Respons memuat serial siap kirim:
```json
{ "ok": true, "data": { "license": {
    "key": "VINZ-XXXX-XXXX-XXXX-XXXX", "type": "monthly", "scope": "app",
    "app": "my-app", "status": "active", "expires_at": "2027-06-12T..", "max_activations": 1
}}}
```

Contoh integrasi: di webhook pembayaranmu (server), setelah pembayaran sukses,
panggil endpoint di atas lalu email-kan `data.license.key` ke pembeli.

---

## 9. Referensi API & klaim token

### API publik (`/api.php`) — dipakai aplikasi klien
Semua **POST JSON**, balasan **JSON**. Sukses ditandai `"valid": true`.

| Action | Body | Keterangan |
|---|---|---|
| `activate` | `{app, license_key, machine_id, machine_name?}` | Aktivasi pertama sebuah perangkat. |
| `validate` | `{app, license_key, machine_id}` | Heartbeat/refresh; perangkat harus sudah aktivasi. |
| `deactivate` | `{license_key, machine_id}` | Lepas slot aktivasi perangkat. |
| `pubkey` (GET) | — | Ambil public key + fingerprint. |
| `ping` (GET) | — | Cek server hidup. |

Sukses `activate`/`validate`:
```json
{
  "valid": true,
  "token": "<JWT>",
  "token_expires_at": "2026-06-19T..",
  "license": { "key": "...", "type": "monthly", "scope": "app",
               "app": "my-app", "status": "active", "expires_at": "..", "customer": ".." }
}
```

### Klaim di dalam token (JWT RS256)
Kalau memverifikasi sendiri (bahasa lain), periksa klaim ini:

| Klaim | Arti | Cara cek |
|---|---|---|
| `iss` | Penerbit, selalu `"AKMS"` | harus `== "AKMS"` |
| `sub` | Serial lisensi | (info) |
| `scope` | `"universal"` / `"app"` | jika `"app"`, `app` harus = slug-mu |
| `app` | Slug app (null jika universal) | lihat di atas |
| `type` | `"permanent"` / `"monthly"` | (info) |
| `lic_exp` | Expiry kalender lisensi (unix) / null | jika ada, tolak kalau `now >= lic_exp` |
| `mid` | `sha256(machine_id)` / null | jika ada, harus = `sha256(machine_id perangkat ini)` |
| `iat` | Waktu terbit (unix) | (info) |
| `exp` | Expiry token / offline grace (unix) | tolak kalau `now >= exp` → perlu refresh |
| `jti` | ID acak token | (info) |

Verifikasi yang benar = **tanda tangan valid** (pakai public key) **DAN** semua cek
di atas lolos.

### Management API (`/admin-api.php`) — butuh API key
`whoami`, `apps.list`, `apps.create`, `licenses.create`, `licenses.list`,
`licenses.get`, `licenses.revoke`, `licenses.activate`, `licenses.extend`,
`licenses.delete`. Format: `{ "ok": true, "data": {...} }`.

---

## 10. Checklist keamanan sebelum produksi

- [ ] AKMS diakses lewat **HTTPS** (AutoSSL/Let's Encrypt aktif).
- [ ] **Public key ditanam** sebagai konstanta di app (pinning), bukan diambil mentah saat runtime.
- [ ] **Private key tetap di server** — tidak pernah masuk ke app/klien.
- [ ] **API key hanya di backend** (environment variable), tidak pernah di front-end/HTML/JS klien.
- [ ] `grace_days` disetel sesuai kebutuhan (bulanan pendek, permanen panjang).
- [ ] Aplikasi menangani semua kode error (lihat §7) dengan pesan yang jelas.
- [ ] Pola offline yang ramah: tidak mengunci saat internet putus selama masih dalam grace.
- [ ] Fitur bernilai tinggi **divalidasi di server**, bukan hanya cek klien.
- [ ] Tidak memanggil server online berlebihan (start + maksimal harian).
- [ ] `machine_id` disimpan stabil; pengguna diberi cara **deaktivasi** untuk pindah perangkat.

---

## 11. Troubleshooting

- **`bad_request`** saat aktivasi → pastikan `license_key` dan `machine_id` terkirim.
- **`app_mismatch`** padahal serial benar → `appSlug` di klien tidak sama dengan slug
  lisensi (atau lisensi di-scope ke app lain). Samakan slug, atau terbitkan lisensi
  *universal*.
- **`activation_limit`** → batas perangkat tercapai. Naikkan `max_activations`, atau
  hapus perangkat lama di detail lisensi / panggil `deactivate()` di perangkat lama.
- **`isLicensed()` selalu false padahal sudah aktivasi** → cek bahwa **public key di
  klien** benar-benar pasangan dari private key server (lihat fingerprint di menu
  Signing key), dan `appSlug` sesuai. Token yang ditandatangani kunci berbeda akan
  ditolak.
- **Token "tiba-tiba" tidak valid setelah pindah komputer** → wajar: token terikat
  `machine_id`. Jalankan `activate()` lagi di perangkat baru (atau `deactivate()` di
  yang lama dulu bila batas perangkat = 1).
- **Pengguna ke-lock saat offline lama** → `grace_days` terlalu kecil untuk pola
  pemakaian mereka. Terbitkan/perpanjang dengan `grace_days` lebih besar.

---

© VinzSecuritySystems — AKMS KeyManagement. Dokumen integrasi.
