#!/usr/bin/env bash
# ops/rdpgw/prepare-host.sh - stage S3: put the built gateway on the host, WITHOUT starting it. Run as root:
#   sudo bash ops/rdpgw/prepare-host.sh
# Idempotent. Creates the rdpgw system user, /opt/rdpgw/releases/<sha12>/rdpgw (+ the `current` symlink),
# /etc/rdpgw/{rdpgw.yaml,default.rdp,secrets.env} and /etc/systemd/system/rdpgw.service, then reloads systemd.
# It does NOT enable or start the service, touch nginx, DNS, the firewall, xrdp or the application.
# secrets.env is generated only if it does not exist yet, and no secret value is ever printed.
# Rollback: systemctl disable --now rdpgw; rm -rf /opt/rdpgw /etc/rdpgw /etc/systemd/system/rdpgw.service;
#           systemctl daemon-reload; userdel rdpgw
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)

# 1. the binary is exactly the reviewed build
( cd "$HERE" && sha256sum --check --quiet BINARY_SHA256 )
SHA12=$(cut -c1-12 "$HERE/BINARY_SHA256")

# 2. user and directories
getent passwd rdpgw >/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin rdpgw
install -d -m 0755 -o root -g root /opt/rdpgw /opt/rdpgw/releases
install -D -m 0755 -o root -g root "$HERE/build/rdpgw" "/opt/rdpgw/releases/$SHA12/rdpgw"
ln -sfn "releases/$SHA12" /opt/rdpgw/current
install -d -m 0750 -o root -g rdpgw /etc/rdpgw

# 3. configuration (no secrets in it)
install -m 0644 -o root -g root "$HERE/rdpgw.yaml" /etc/rdpgw/rdpgw.yaml
install -m 0644 -o root -g root "$HERE/default.rdp" /etc/rdpgw/default.rdp

# 4. secrets: 4 gateway keys of exactly 32 chars, 3 shared secrets of 64 chars. Never overwritten, never printed.
if [ -e /etc/rdpgw/secrets.env ]; then
  echo "secrets.env exists, left untouched"
else
  TMP=$(mktemp /etc/rdpgw/.secrets.XXXXXX)
  ( umask 077
    for k in SERVER__SESSIONKEY SERVER__SESSIONENCRYPTIONKEY SECURITY__PAATOKENSIGNINGKEY SECURITY__PAATOKENENCRYPTIONKEY; do
      printf 'RDPGW_%s=%s\n' "$k" "$(openssl rand -hex 16)"
    done
    for k in SECURITY__GRANTCHECKTOKEN SECURITY__ADMINTOKEN HEADER__SECRET; do
      printf 'RDPGW_%s=%s\n' "$k" "$(openssl rand -hex 32)"
    done ) > "$TMP"
  chown root:rdpgw "$TMP"; chmod 0640 "$TMP"; mv "$TMP" /etc/rdpgw/secrets.env
  echo "secrets.env generated"
fi

# 5. systemd unit, loaded but not enabled or started
install -m 0644 -o root -g root "$HERE/rdpgw.service" /etc/systemd/system/rdpgw.service
systemctl daemon-reload

echo "--- result (names and permissions only)"
stat -c '%a %U:%G %n' /opt/rdpgw/current /opt/rdpgw/releases/"$SHA12"/rdpgw /etc/rdpgw /etc/rdpgw/* /etc/systemd/system/rdpgw.service
echo "secrets.env variables: $(sed 's/=.*//' /etc/rdpgw/secrets.env | tr '\n' ' ')"
systemctl is-enabled rdpgw 2>&1 || true
systemctl is-active rdpgw 2>&1 || true
systemd-analyze verify /etc/systemd/system/rdpgw.service
echo "prepared. NOT enabled, NOT started."
