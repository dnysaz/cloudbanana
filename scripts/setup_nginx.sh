#!/bin/bash
set -e

DOMAIN="${1:-localhost}"
PORT="${2:-8080}"

echo "[CloudBanana] Configuring Nginx for $DOMAIN on port $PORT..."

cat > /etc/nginx/sites-available/cloudbanana <<EOF
server {
    listen $PORT;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    client_max_body_size 100m;
}
EOF

ln -sf /etc/nginx/sites-available/cloudbanana /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "[CloudBanana] Nginx configuration applied."
