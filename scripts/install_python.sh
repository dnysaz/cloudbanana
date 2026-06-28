#!/bin/bash
set -e
echo "[CloudBanana] Installing Python..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv
echo "[CloudBanana] Python installation complete."
