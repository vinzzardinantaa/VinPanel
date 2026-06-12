#!/usr/bin/env bash
# ============================================================
#  Vincontrol installer  -  VinzzApps
#  Usage:  sudo bash install.sh
#
#  By default the panel boots into a one-time WEB SETUP where you set the admin
#  password and activate your AKMS license. To pre-seed non-interactively:
#    ADMIN_PASS=...       set admin password now (skips the password step)
#    LICENSE_KEY=VINZ-..  activate this AKMS license now (skips the license step)
#    PORT=7800            panel port
#    DOMAIN=example.com   panel served at vpanel.example.com + SSL
#    SSL_EMAIL=you@x.com  Let's Encrypt email
#    PHP_VERSIONS="8.1 8.2 8.3"
#
#  NOTE: paste your AKMS public key into lib/akms.config.js (or set AKMS_PUBLIC_KEY)
#  before licenses can be activated. See clients/AKMS-INTEGRATION.md.
# ============================================================
set -euo pipefail

APP_DIR="/opt/vincontrol"
SVC="vincontrol"
PORT="${PORT:-7800}"
WWW_ROOT="/www/wwwroot"
PHP_VERSIONS="${PHP_VERSIONS:-8.1 8.2 8.3}"
PMA_VER="5.2.2"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

teal='\033[38;5;43m'; gold='\033[38;5;179m'; dim='\033[2m'; red='\033[31m'; grn='\033[32m'; off='\033[0m'
say(){ echo -e "${teal}::${off} $*"; }
ok(){ echo -e "  ${grn}ok${off} $*"; }
warn(){ echo -e "  ${gold}!!${off} $*"; }
die(){ echo -e "${red}error:${off} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "please run as root (sudo bash install.sh)"
command -v apt-get >/dev/null 2>&1 || die "this installer targets Debian/Ubuntu (apt)."

pubip(){
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I | awk '{print $1}'
}

echo -e "${gold}"
echo "  __     ___        ____            _             _ "
echo "  \ \   / (_)_ __  / ___|___  _ __ | |_ _ __ ___ | |"
echo "   \ \ / /| | '_ \| |   / _ \| '_ \| __| '__/ _ \| |"
echo "    \ V / | | | | | |__| (_) | | | | |_| | | (_) | |"
echo "     \_/  |_|_| |_|\____\___/|_| |_|\__|_|  \___/|_|"
echo -e "${dim}  self-hosted server control panel  -  VinzzApps${off}\n"

export DEBIAN_FRONTEND=noninteractive

# ---------- ask about a domain up front (interactive only) ----------
DOMAIN="${DOMAIN:-}"
SSL_EMAIL="${SSL_EMAIL:-}"
if [ -z "$DOMAIN" ] && [ -t 0 ]; then
  read -rp "$(echo -e "${teal}::${off}") Do you have a domain to reach the panel over HTTPS? [y/N] " hd
  if [ "${hd:-n}" = "y" ] || [ "${hd:-n}" = "Y" ]; then
    read -rp "   Your domain (e.g. example.com): " DOMAIN
    DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's/^https\?:\/\///;s/\/.*$//')"
    [ -z "$SSL_EMAIL" ] && read -rp "   Email for SSL (Let's Encrypt): " SSL_EMAIL
  fi
fi

# ---------- base packages ----------
say "Updating package index"
apt-get update -qq || warn "apt update had warnings"
for p in curl ca-certificates gnupg ufw lsb-release; do
  dpkg -s "$p" >/dev/null 2>&1 || apt-get install -y -qq "$p" >/dev/null 2>&1 || true
done

# ---------- Node.js >=18 ----------
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$MAJ" -ge 18 ] 2>/dev/null && NODE_OK=1
fi
if [ "$NODE_OK" -eq 1 ]; then ok "Node.js $(node -v)"; else
  say "Installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || warn "NodeSource setup failed"
  apt-get install -y -qq nodejs >/dev/null 2>&1 || die "could not install Node.js"
  ok "Node.js $(node -v)"
fi

# ---------- nginx ----------
if command -v nginx >/dev/null 2>&1; then ok "nginx present"; else
  say "Installing nginx"; apt-get install -y -qq nginx >/dev/null 2>&1 && ok "nginx installed" || warn "nginx install failed"
fi

# ---------- MariaDB ----------
if command -v mysql >/dev/null 2>&1; then ok "mysql client present"; else
  say "Installing MariaDB server"
  apt-get install -y -qq mariadb-server >/dev/null 2>&1 && ok "mariadb installed" || warn "mariadb install failed"
fi

# ---------- PHP (multiple versions) ----------
say "Setting up PHP repository (for multi-version support)"
if grep -qi ubuntu /etc/os-release 2>/dev/null; then
  apt-get install -y -qq software-properties-common >/dev/null 2>&1 || true
  LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php >/dev/null 2>&1 || warn "ondrej PPA add failed (will use distro PHP)"
elif grep -qi debian /etc/os-release 2>/dev/null; then
  apt-get install -y -qq apt-transport-https >/dev/null 2>&1 || true
  curl -fsSL https://packages.sury.org/php/apt.gpg -o /usr/share/keyrings/sury-php.gpg 2>/dev/null || true
  echo "deb [signed-by=/usr/share/keyrings/sury-php.gpg] https://packages.sury.org/php/ $(lsb_release -sc 2>/dev/null) main" \
    > /etc/apt/sources.list.d/sury-php.list 2>/dev/null || true
fi
apt-get update -qq || true
PHP_DONE=""
for v in $PHP_VERSIONS; do
  if apt-get install -y -qq "php${v}-fpm" "php${v}-mysql" "php${v}-cli" "php${v}-curl" \
        "php${v}-mbstring" "php${v}-xml" "php${v}-zip" "php${v}-gd" >/dev/null 2>&1; then
    systemctl enable --now "php${v}-fpm" >/dev/null 2>&1 || true
    ok "PHP ${v}"; PHP_DONE="$PHP_DONE $v"
  else
    warn "PHP ${v} not available, skipped"
  fi
done
if [ -z "$PHP_DONE" ]; then
  say "Falling back to distro default PHP-FPM"
  apt-get install -y -qq php-fpm php-mysql php-cli php-curl php-mbstring php-xml php-zip php-gd >/dev/null 2>&1 \
    && ok "PHP installed" || warn "no PHP installed"
fi

# ---------- certbot ----------
if command -v certbot >/dev/null 2>&1; then ok "certbot present"; else
  say "Installing certbot"; apt-get install -y -qq certbot python3-certbot-nginx >/dev/null 2>&1 \
    && ok "certbot installed" || warn "certbot install failed"
fi

# ---------- phpMyAdmin ----------
if command -v mysql >/dev/null 2>&1; then
  say "Installing phpMyAdmin ${PMA_VER}"
  if curl -fsSL "https://files.phpmyadmin.net/phpMyAdmin/${PMA_VER}/phpMyAdmin-${PMA_VER}-all-languages.tar.gz" -o /tmp/pma.tgz 2>/dev/null; then
    rm -rf /usr/share/phpmyadmin && mkdir -p /usr/share/phpmyadmin
    if tar xzf /tmp/pma.tgz -C /usr/share/phpmyadmin --strip-components=1 2>/dev/null; then
      cp /usr/share/phpmyadmin/config.sample.inc.php /usr/share/phpmyadmin/config.inc.php
      BF="$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
      sed -i "s|\$cfg\['blowfish_secret'\] = '';|\$cfg['blowfish_secret'] = '${BF}';|" /usr/share/phpmyadmin/config.inc.php
      mkdir -p /usr/share/phpmyadmin/tmp
      chown -R www-data:www-data /usr/share/phpmyadmin 2>/dev/null || true
      SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | sort -V | tail -1)"
      [ -z "$SOCK" ] && SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1)"
      mkdir -p /etc/nginx/snippets
      cat > /etc/nginx/snippets/vincontrol-pma.conf <<PMA
location /phpmyadmin/ {
    alias /usr/share/phpmyadmin/;
    index index.php;
    location ~ ^/phpmyadmin/(.+\.php)\$ {
        alias /usr/share/phpmyadmin/\$1;
        fastcgi_pass unix:${SOCK:-/run/php/php-fpm.sock};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$request_filename;
    }
    location ~* ^/phpmyadmin/(.+\.(?:jpg|jpeg|gif|css|png|js|ico|html|xml|txt|woff2?|svg|map))\$ {
        alias /usr/share/phpmyadmin/\$1;
    }
}
PMA
      PUBIP_NOW="$(pubip || true)"
      if [ -n "$PUBIP_NOW" ]; then
        cat > /etc/nginx/conf.d/_vincontrol_pma.conf <<PMASRV
server {
    listen 80;
    server_name ${PUBIP_NOW};
    include /etc/nginx/snippets/vincontrol-pma.conf;
    location / { return 302 http://${PUBIP_NOW}:${PORT}/; }
}
PMASRV
      fi
      ok "phpMyAdmin ready at /phpmyadmin/"
    else warn "phpMyAdmin extract failed"; fi
  else warn "phpMyAdmin download failed (install later)"; fi
fi

# ---------- copy app ----------
say "Installing panel to $APP_DIR"
mkdir -p "$APP_DIR" "$WWW_ROOT"
if [ "$SRC" != "$APP_DIR" ]; then cp -a "$SRC/." "$APP_DIR/"; fi
ok "files copied"

# ---------- npm install ----------
say "Installing Node dependencies (this may take a minute)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) || die "npm install failed"
ok "dependencies ready"

# ---------- config ----------
CONF="$APP_DIR/config/config.json"
SECRET="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
# Password is normally set in the web setup. Pre-seed only if ADMIN_PASS is given.
HASH=""
if [ -n "${ADMIN_PASS:-}" ]; then
  HASH="$(cd "$APP_DIR" && node -e 'console.log(require("bcryptjs").hashSync(process.argv[1],10))' "$ADMIN_PASS")"
fi

if [ -f "$CONF" ] && grep -q '"password_hash"' "$CONF" 2>/dev/null && [ -z "${ADMIN_PASS:-}" ]; then
  say "Existing config found - keeping password, updating port/domain"
  ( cd "$APP_DIR" && DOMAIN_IN="$DOMAIN" EMAIL_IN="$SSL_EMAIL" PORT_IN="$PORT" node -e '
    const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,"utf8"));
    c.port=parseInt(process.env.PORT_IN,10);
    if(process.env.DOMAIN_IN) c.domain=process.env.DOMAIN_IN;
    if(process.env.EMAIL_IN) c.ssl_email=process.env.EMAIL_IN;
    fs.writeFileSync(p,JSON.stringify(c,null,2));
  ' "$CONF" )
else
  cat > "$CONF" <<JSON
{
  "port": $PORT,
  "host": "0.0.0.0",
  "session_secret": "$SECRET",
  "password_hash": "$HASH",
  "domain": "$DOMAIN",
  "www_root": "$WWW_ROOT",
  "nginx_conf_dir": "/etc/nginx/conf.d",
  "ssl_email": "$SSL_EMAIL",
  "mysql": { "host": "localhost", "user": "", "password": "", "socket": "" }
}
JSON
fi
chmod 600 "$CONF"
ok "config written"

# ---------- systemd ----------
say "Registering systemd service"
cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=Vincontrol - server control panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now $SVC >/dev/null 2>&1
ok "service running"

# ---------- CLI ----------
chmod +x "$APP_DIR/bin/vincontrol"
ln -sf "$APP_DIR/bin/vincontrol" /usr/local/bin/vincontrol
ok "CLI installed (run: vincontrol info)"

# ---------- firewall + base services ----------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
  ufw allow "$PORT"/tcp >/dev/null 2>&1 && ok "ufw: opened port $PORT" || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi
systemctl enable --now nginx >/dev/null 2>&1 || true
nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || warn "nginx config test reported issues - check 'nginx -t'"
systemctl enable --now mariadb >/dev/null 2>&1 || systemctl enable --now mysql >/dev/null 2>&1 || true

# ---------- domain + SSL ----------
PANEL_SSL=0; PANEL_HOST=""
if [ -n "$DOMAIN" ]; then
  PANEL_HOST="vpanel.${DOMAIN}"
  PUBIP="$(pubip || true)"
  echo
  say "Panel domain: ${gold}${PANEL_HOST}${off}"
  echo -e "   Add this DNS A record at your registrar:"
  echo -e "     ${gold}${PANEL_HOST}   A   ${PUBIP:-<this-server-ip>}${off}"
  SKIP_SSL=""
  if [ -t 0 ]; then
    while true; do
      R="$(getent hosts "$PANEL_HOST" 2>/dev/null | awk '{print $1}' | head -1)"
      if [ -n "$PUBIP" ] && [ "$R" = "$PUBIP" ]; then ok "DNS points here"; break; fi
      if [ -z "$PUBIP" ] && [ -n "$R" ]; then ok "DNS resolves (${R})"; break; fi
      echo -e "   ${gold}not linked yet${off} (resolves to: ${R:-nothing})"
      read -rp "   Press Enter to recheck, or type 's' to skip SSL for now: " a
      if [ "${a:-}" = "s" ]; then warn "skipping SSL - set it later in Settings or 'vincontrol domain'"; SKIP_SSL=1; break; fi
    done
  fi
  EMAIL_ARG="$SSL_EMAIL"; [ -n "$SKIP_SSL" ] && EMAIL_ARG=""
  say "Configuring nginx reverse-proxy${EMAIL_ARG:+ and requesting certificate}"
  RES="$( cd "$APP_DIR" && node -e '
    const pd=require("./lib/paneldomain");
    pd.apply(process.argv[1], parseInt(process.argv[2],10), process.argv[3]||"")
      .then(r=>console.log("SSL="+(r.ssl?1:0)+(r.sslError?(";ERR="+r.sslError):"")))
      .catch(e=>{console.log("FAIL="+e.message);});
  ' "$DOMAIN" "$PORT" "$EMAIL_ARG" )"
  case "$RES" in
    SSL=1*) PANEL_SSL=1; ok "HTTPS enabled for ${PANEL_HOST}";;
    SSL=0*) warn "panel reachable over HTTP; SSL pending. ${RES#SSL=0;ERR=}";;
    FAIL=*) warn "domain setup issue: ${RES#FAIL=}";;
  esac
fi

# ---------- optional license pre-activation ----------
LIC_STATE="setup"   # setup | active | failed
if [ -n "${LICENSE_KEY:-}" ]; then
  say "Activating AKMS license"
  LRES="$( cd "$APP_DIR" && node -e '
    const akms=require("./lib/akms");
    akms.activate(process.argv[1])
      .then(r=>console.log(r&&r.valid?"OK":("ERR="+((r&&(r.error||r.message))||"failed"))))
      .catch(e=>console.log("ERR="+e.message));
  ' "$LICENSE_KEY" )"
  case "$LRES" in
    OK) LIC_STATE="active"; ok "license active";;
    *)  LIC_STATE="failed"; warn "license activation failed: ${LRES#ERR=} (activate later in the web setup)";;
  esac
  systemctl restart "$SVC" >/dev/null 2>&1 || true
fi

# ---------- summary ----------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PANEL_URL="http://${IP:-<server-ip>}:${PORT}"
[ -n "$PANEL_HOST" ] && PANEL_URL="http://${PANEL_HOST}"
[ "$PANEL_SSL" = "1" ] && PANEL_URL="https://${PANEL_HOST}"
echo
echo -e "${grn}============================================================${off}"
echo -e "  ${gold}Vincontrol is installed and running${off}"
echo
if [ "$PANEL_SSL" = "1" ]; then
  echo -e "  URL        ${teal}https://${PANEL_HOST}${off}"
  echo -e "             ${dim}also http://${IP:-ip}:${PORT}${off}"
elif [ -n "$PANEL_HOST" ]; then
  echo -e "  URL        ${teal}http://${PANEL_HOST}${off}  ${dim}(SSL pending)${off}"
  echo -e "             ${dim}also http://${IP:-ip}:${PORT}${off}"
else
  echo -e "  URL        ${teal}http://${IP:-<server-ip>}:${PORT}${off}"
fi
echo
if [ -n "${ADMIN_PASS:-}" ] && [ "$LIC_STATE" = "active" ]; then
  echo -e "  Setup      ${grn}complete${off} - password set & license active. Just sign in."
else
  echo -e "  ${gold}Next step:${off} open ${teal}${PANEL_URL}${off} to finish setup:"
  [ -z "${ADMIN_PASS:-}" ] && echo -e "    ${dim}• set the admin password${off}"
  [ "$LIC_STATE" != "active" ] && echo -e "    ${dim}• enter your AKMS license key to activate${off}"
fi
echo
echo -e "  License    ${dim}AKMS - paste your public key in lib/akms.config.js if not set${off}"
echo -e "  phpMyAdmin ${dim}<panel-url>/phpmyadmin/  (log in with a DB user you create)${off}"
echo -e "  PHP        ${dim}${PHP_DONE:-default} - pick a version per site${off}"
echo -e "  Manage     ${dim}vincontrol info | license | restart | domain | logs${off}"
echo -e "  Web root   ${dim}${WWW_ROOT}${off}"
echo -e "${grn}============================================================${off}"
echo -e "${gold}Security:${off} the panel runs as root. Firewall port ${PORT} to trusted"
echo -e "IPs and prefer the HTTPS domain URL. The panel is locked until a valid"
echo -e "license is activated."
echo
