#!/bin/bash
set -e
echo "[CloudBanana] Installing PHP..."
apt-get update -qq
apt-get install -y -qq php php-cli php-fpm php-mysql php-xml php-mbstring php-curl php-zip php-gd php-bcmath
echo "[CloudBanana] PHP installation complete."
