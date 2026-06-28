#!/bin/bash
set -e
echo "[CloudBanana] Installing Apache..."
apt-get update -qq
apt-get install -y -qq apache2
systemctl enable apache2
systemctl start apache2
echo "[CloudBanana] Apache installation complete."
