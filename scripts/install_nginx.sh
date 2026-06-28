#!/bin/bash
set -e
echo "[CloudBanana] Installing Nginx..."
apt-get update -qq
apt-get install -y -qq nginx
systemctl enable nginx
systemctl start nginx
echo "[CloudBanana] Nginx installation complete."
