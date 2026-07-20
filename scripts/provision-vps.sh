#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu 22.04 DigitalOcean droplet.
# Run once as root, right after the droplet is created, for BOTH the
# staging and prod droplets. See docs/DEPLOYMENT.md for the full flow.
#
# Usage: DEPLOY_USER=deploy ./provision-vps.sh
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (fresh droplet default)." >&2
  exit 1
fi

echo "==> Updating base system"
apt-get update -y
apt-get upgrade -y

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Installing git, ufw, fail2ban, unattended-upgrades"
apt-get install -y git ufw fail2ban unattended-upgrades

echo "==> Creating non-root deploy user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

# Carry over the SSH key(s) DigitalOcean installed for root at droplet
# creation, so the deploy user can log in the same way.
mkdir -p "/home/$DEPLOY_USER/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
chmod 700 "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || true

echo "==> Locking down SSH (key-only, no root login)"
sed -i \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin no/' \
  /etc/ssh/sshd_config
systemctl restart ssh

echo "==> Configuring firewall (SSH, 80, 443 only)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Enabling fail2ban (SSH brute-force protection)"
systemctl enable --now fail2ban

echo "==> Enabling unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

cat <<EOF

==> Done. Next steps (see docs/DEPLOYMENT.md):
  1. From your machine, confirm you can log in as the deploy user:
       ssh $DEPLOY_USER@<droplet-ip>
  2. As $DEPLOY_USER, clone the repo and configure .env:
       git clone https://github.com/treasurer-cwmtc/cross-way-ledger.git
       cd cross-way-ledger && cp .env.example .env && nano .env
  3. Point DNS (A record) for this box's domain at <droplet-ip>.
  4. Add this droplet's SSH details as GitHub Actions secrets so CI can deploy to it.
EOF
