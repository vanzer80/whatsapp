#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_SHA="59ea523eec75de8da72dc5fcfe253f92a7f4617b"
APP_BRANCH="feat/write-operations-vps"
APP_REPO="https://github.com/vanzer80/whatsapp.git"
PUBLIC_HOST="143-198-33-61.sslip.io"
PUBLIC_BASE="https://${PUBLIC_HOST}"
DATA_DIR="/var/lib/whatsapp-manutencao"
RELEASE_DIR="/opt/whatsapp-manutencao/releases/${APP_SHA}"
STAGE_DIR="/opt/wa-image"
LOG_FILE="/var/log/wa-firstboot.log"

exec > >(tee -a "$LOG_FILE") 2>&1
trap 'rc=$?; echo "FIRSTBOOT_FAILED rc=$rc line=$LINENO"; mkdir -p /var/lib/whatsapp-manutencao; printf "{\"ok\":false,\"rc\":%s,\"line\":%s,\"time\":\"%s\"}\n" "$rc" "$LINENO" "$(date -u +%FT%TZ)" > /var/lib/whatsapp-manutencao/deploy-status.json; exit $rc' ERR

echo "=== WhatsApp Manutencao first boot $(date -u +%FT%TZ) ==="
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https ufw jq wget

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get install -y nodejs caddy
node --version
npm --version
caddy version

curl -fsSLo /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y /tmp/google-chrome-stable_current_amd64.deb
rm -f /tmp/google-chrome-stable_current_amd64.deb
google-chrome --version

if ! id whatsapp-maint >/dev/null 2>&1; then
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin whatsapp-maint
fi
install -d -o whatsapp-maint -g whatsapp-maint -m 0700 "$DATA_DIR"
install -d -o root -g root -m 0755 /opt/whatsapp-manutencao/releases /etc/whatsapp-manutencao /usr/local/lib/whatsapp-bootstrap

install -o root -g root -m 0644 "$STAGE_DIR/bootstrap-public-key.pem" /etc/whatsapp-manutencao/bootstrap-public-key.pem
install -o root -g root -m 0644 "$STAGE_DIR/bootstrap-server.mjs" /usr/local/lib/whatsapp-bootstrap/bootstrap-server.mjs

if [ ! -d "$RELEASE_DIR/.git" ]; then
  git clone --branch "$APP_BRANCH" --single-branch "$APP_REPO" "$RELEASE_DIR"
fi
git -C "$RELEASE_DIR" checkout --detach "$APP_SHA"
cd "$RELEASE_DIR"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev
chown -R root:root "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" /opt/whatsapp-manutencao/current

cat > /etc/whatsapp-manutencao/env <<EOF
WA_DATA_DIRECTORY=${DATA_DIR}
WA_PORT=8787
WA_PUBLIC_BASE_URL=${PUBLIC_BASE}
NODE_ENV=production
PUPPETEER_SKIP_DOWNLOAD=1
EOF
chown root:root /etc/whatsapp-manutencao/env
chmod 0600 /etc/whatsapp-manutencao/env

cd /opt/whatsapp-manutencao/current
npm run preflight:vps:static
runuser -u whatsapp-maint -- env HOME="$DATA_DIR" WA_DATA_DIRECTORY="$DATA_DIR" WA_PORT=8787 WA_PUBLIC_BASE_URL="$PUBLIC_BASE" NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=1 npm run preflight:vps

install -o root -g root -m 0644 deploy/systemd/whatsapp-manutencao.service /etc/systemd/system/whatsapp-manutencao.service
cat > /etc/systemd/system/whatsapp-bootstrap.service <<'EOF'
[Unit]
Description=WhatsApp Manutencao signed bootstrap proxy
After=whatsapp-manutencao.service network-online.target
Requires=whatsapp-manutencao.service

[Service]
Type=simple
User=whatsapp-maint
Group=whatsapp-maint
Environment=WA_DATA_DIRECTORY=/var/lib/whatsapp-manutencao
Environment=WA_BOOTSTRAP_PUBLIC_KEY=/etc/whatsapp-manutencao/bootstrap-public-key.pem
Environment=WA_BOOTSTRAP_PORT=8788
Environment=WA_APP_ORIGIN=http://127.0.0.1:8787
ExecStart=/usr/bin/node /usr/local/lib/whatsapp-bootstrap/bootstrap-server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=/var/lib/whatsapp-manutencao

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${PUBLIC_HOST} {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        X-Frame-Options DENY
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    route {
        @core path /health /gpt/*
        reverse_proxy @core 127.0.0.1:8787
        @bootstrap path /bootstrap /bootstrap/*
        reverse_proxy @bootstrap 127.0.0.1:8788
        respond 404
    }
}
EOF
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemd-analyze verify /etc/systemd/system/whatsapp-manutencao.service /etc/systemd/system/whatsapp-bootstrap.service

if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable whatsapp-manutencao.service whatsapp-bootstrap.service caddy.service
systemctl restart caddy.service
systemctl restart whatsapp-manutencao.service
systemctl restart whatsapp-bootstrap.service

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8787/health >/tmp/wa-health.json; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8788/bootstrap/healthz

cat > "$DATA_DIR/deploy-status.json" <<EOF
{"ok":true,"app_sha":"${APP_SHA}","public_base":"${PUBLIC_BASE}","installed_at":"$(date -u +%FT%TZ)"}
EOF
chown whatsapp-maint:whatsapp-maint "$DATA_DIR/deploy-status.json"
chmod 0600 "$DATA_DIR/deploy-status.json"
touch "$DATA_DIR/.firstboot-complete"
chown whatsapp-maint:whatsapp-maint "$DATA_DIR/.firstboot-complete"
chmod 0600 "$DATA_DIR/.firstboot-complete"

echo "=== FIRSTBOOT_COMPLETE ${PUBLIC_BASE} $(date -u +%FT%TZ) ==="
