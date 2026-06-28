#!/bin/bash
set -e

echo "========================================"
echo "  CloudBanana - Master Installer"
echo "========================================"

# Validate environment
if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root."
    exit 1
fi

if [ ! -f /etc/os-release ]; then
    echo "Error: Unsupported OS."
    exit 1
fi

. /etc/os-release
if [ "$ID" != "ubuntu" ] || [[ "$VERSION_ID" != "22.04" && "$VERSION_ID" != "24.04" ]]; then
    echo "Error: Ubuntu 22.04 or 24.04 LTS required."
    exit 1
fi

# Install base dependencies
echo "[1/5] Installing base dependencies..."
apt-get update -qq
apt-get install -y -qq python3-pip python3-venv nginx git

# Clone project
echo "[2/5] Cloning CloudBanana..."
INSTALL_DIR="/etc/cloudbanana"
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory $INSTALL_DIR already exists. Pulling latest..."
    cd "$INSTALL_DIR" && git pull
else
    git clone https://github.com/yourusername/cloudbanana.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Setup Python virtual environment
echo "[3/5] Setting up Python environment..."
python3 -m venv venv
source venv/bin/activate
pip install -q -r backend/requirements.txt
deactivate

# Register systemd service
echo "[4/5] Registering systemd service..."
cat > /etc/systemd/system/cloudbanana.service <<EOF
[Unit]
Description=CloudBanana Core API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$INSTALL_DIR/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cloudbanana
systemctl start cloudbanana

# Configure Nginx
echo "[5/5] Configuring Nginx..."
bash "$INSTALL_DIR/scripts/setup_nginx.sh" "$(hostname)" "8080"

echo ""
echo "========================================"
echo "  CloudBanana installation complete!"
echo "  Access via: http://$(hostname -I | awk '{print $1}'):8080"
echo "========================================"
