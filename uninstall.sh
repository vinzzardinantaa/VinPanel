#!/usr/bin/env bash
# Vincontrol uninstaller
set -euo pipefail
APP_DIR="/opt/vincontrol"
SVC="vincontrol"
red='\033[31m'; teal='\033[38;5;43m'; gold='\033[38;5;179m'; off='\033[0m'

[ "$(id -u)" -eq 0 ] || { echo -e "${red}run as root (sudo bash uninstall.sh)${off}"; exit 1; }

echo -e "${gold}This removes the Vincontrol service, CLI, panel nginx config, and $APP_DIR.${off}"
echo -e "Your websites, databases and phpMyAdmin are NOT touched."
read -rp "Continue? [y/N] " a
[ "${a:-n}" = "y" ] || [ "${a:-n}" = "Y" ] || { echo "aborted"; exit 0; }

systemctl stop "$SVC" 2>/dev/null || true
systemctl disable "$SVC" 2>/dev/null || true
rm -f /etc/systemd/system/$SVC.service
systemctl daemon-reload
rm -f /usr/local/bin/vincontrol

# panel-only nginx bits (leave user sites + phpmyadmin files alone)
rm -f /etc/nginx/conf.d/_vincontrol_panel.conf /etc/nginx/conf.d/_vincontrol_pma.conf
nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true

read -rp "Also delete panel config (port/password/domain)? [y/N] " b
if [ "${b:-n}" = "y" ] || [ "${b:-n}" = "Y" ]; then
  rm -rf "$APP_DIR"
  echo -e "${teal}removed $APP_DIR completely${off}"
else
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name config -exec rm -rf {} + 2>/dev/null || true
  echo -e "${teal}removed panel, kept $APP_DIR/config${off}"
fi
echo "done."
