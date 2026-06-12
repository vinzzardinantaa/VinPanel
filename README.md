# Vincontrol

A lightweight, self-hosted **server control panel** for Ubuntu/Debian VPS — by **VinzzApps**.
Unzip, run one installer, complete a quick web setup, and manage your stack from a clean dark UI.

It is **not** a 1:1 aaPanel clone. It is a focused, genuinely functional panel covering the
things you touch daily: sites, databases, PHP, SSL, services, files, and a command runner —
**gated behind an AKMS software license**.

---

## Features

| Module | What it does |
|---|---|
| **License (AKMS)** | Panel is locked until a valid AKMS license is activated; cryptographically verified & machine-bound |
| **Web setup** | First-run wizard sets the admin password and activates the license |
| **Dashboard** | Live CPU / RAM / Disk gauges, load, network, uptime (Socket.IO, every 2s) |
| **Websites** | Create/delete Nginx vhosts, pick a PHP version per site, enable/disable, `nginx -t` validated |
| **Databases** | List/create/drop MySQL/MariaDB databases, auto-create a user with full grants |
| **phpMyAdmin** | Bundled & auto-configured — manage multiple DBs and DB users |
| **Multi-PHP** | Installs 8.1 / 8.2 / 8.3 side-by-side, selectable per site |
| **SSL** | Free Let's Encrypt certs via certbot |
| **Panel domain** | Reach the panel at `vpanel.<yourdomain>` over HTTP + HTTPS, with DNS check + auto-cert |
| **Services / Files / Terminal** | systemd control, in-browser file manager, one-shot command runner |

---

## Install

```bash
unzip vincontrol.zip
cd vincontrol
sudo bash install.sh
```

The installer sets everything up and leaves the panel in **first-run setup mode**. Open the printed
URL and the web wizard will:

1. **Set the admin password.**
2. **Activate your AKMS license key** (`VINZ-XXXX-XXXX-XXXX-XXXX`).

Until a valid license is active, every panel route is locked.

> [!IMPORTANT]
> Vincontrol ships with the AKMS signing **public key already pinned** in
> `lib/akms.config.js`, so activation works out of the box. Only re-pin it (or set the
> `AKMS_PUBLIC_KEY` env var) if you rotate keys on your AKMS server — get the current key from
> the AKMS panel → *Signing key*. See `clients/AKMS-INTEGRATION.md`.

### Non-interactive (pre-seed password + license)

```bash
sudo ADMIN_PASS='YourPass' \
     LICENSE_KEY='VINZ-XXXX-XXXX-XXXX-XXXX' \
     DOMAIN='example.com' SSL_EMAIL='you@example.com' \
     bash install.sh
```

| Env var | Purpose |
|---|---|
| `ADMIN_PASS` | Set the admin password now (skips the password step) |
| `LICENSE_KEY` | Activate this license now (skips the license step) |
| `PORT` | Panel port (default 7800) |
| `DOMAIN` / `SSL_EMAIL` | Serve at `vpanel.<domain>` + issue SSL |
| `PHP_VERSIONS` | PHP-FPM versions to install (default `8.1 8.2 8.3`) |
| `AKMS_SERVER_URL` / `AKMS_APP_SLUG` / `AKMS_PUBLIC_KEY` | Override AKMS vendor config |

---

## Licensing (AKMS KeyManagement)

Vincontrol gates itself behind **AKMS** — a public-key licensing system.

- **Activation** sends your license key + a machine fingerprint to your AKMS server, which returns a
  **signed token** (JWT RS256) bound to this machine.
- The panel **verifies the token offline** with the pinned public key on every request — so it works
  without internet during the offline-grace window, and **forged or edited tokens are rejected**.
- A background **heartbeat** refreshes the token periodically to catch revocation / expiry.

## CLI

```
vincontrol info                                  show URL + license + paths
vincontrol start|stop|restart|status|logs
vincontrol enable|disable                        boot autostart
vincontrol port 9000                             change port (auto-restarts)
vincontrol domain example.com you@example.com    set panel domain + issue SSL
vincontrol license | activate <KEY> | deactivate license management
vincontrol passwd                                reset the panel password
```

---

## The panel domain (`vpanel.`)

The panel always lives at **`vpanel.<yourdomain>`** — the `vpanel.` prefix is **fixed**. You set the
domain in **Settings → Panel domain & HTTPS** or via `vincontrol domain`. An nginx reverse-proxy
(with WebSocket upgrade) fronts the Node panel, and certbot adds HTTPS. Both HTTP and HTTPS stay open.

## phpMyAdmin

Served at **`<panel-url>/phpmyadmin/`** (button on the Databases page). Log in with a DB user you
create in the panel — MariaDB `root` uses unix-socket auth and has no password by default.

## Multiple PHP versions per site

The installer adds `ondrej/php` (Ubuntu) or `sury` (Debian) and installs several PHP-FPM versions.
Pick the version per website; each vhost points at the matching FPM socket.

---

## How it works

- systemd service `vincontrol.service` as **root**; installed to `/opt/vincontrol`.
- Config + license state in `/opt/vincontrol/config/` (`config.json`, `akms-state.json`, both `0600`).
- Site vhosts in `/etc/nginx/conf.d/`; web root `/www/wwwroot/`.
- Pure-JS dependencies (express, socket.io, multer, bcryptjs) + `node:crypto` for license verification.

---

## Security

> [!CAUTION]
> The panel can run commands and edit any file as root. Treat it like SSH access.

- Firewall the panel port; expose only to trusted IPs or over a VPN/SSH tunnel.
- Prefer the HTTPS domain URL.
- Keep the AKMS **private key on your AKMS server only** — Vincontrol ships just the public key.
- The license gate raises the bar against casual misuse, but any self-hosted client check can be
  patched by someone who controls the box — keep high-value logic server-side (see AKMS doc §1).

---

## Uninstall

```bash
sudo bash uninstall.sh
```

Removes the service, CLI, panel nginx config and app files. Your websites, databases and
phpMyAdmin are left untouched.

---

Made by **SUM** · VinzzApps · MIT License
