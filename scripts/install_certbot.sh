#!/bin/bash
set -e
echo "[CloudBanana] Installing Certbot..."
apt-get update -qq
apt-get install -y -qq snapd
snap install core; snap refresh core
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot
echo "[CloudBanana] Certbot installation complete."
