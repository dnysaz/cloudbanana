#!/bin/bash
set -e
echo "[CloudBanana] Installing phpMyAdmin..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq phpmyadmin
ln -sf /usr/share/phpmyadmin /var/www/phpmyadmin 2>/dev/null || true
echo "[CloudBanana] phpMyAdmin installation complete."
