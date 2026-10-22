#!/usr/bin/env bash
# IP certificates last six days; run twice daily through mcbot-bedrock-tls.timer.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ "$(id -u)" == 0 ]] || { echo 'Run as root to protect the ACME account and private key' >&2; exit 1; }
umask 077
mkdir -p secrets/letsencrypt
exec 9>secrets/bedrock-tls.lock
flock -n 9 || exit 0

ip=140.245.73.42
docker run --rm -p 80:80 -v "$PWD/secrets/letsencrypt:/etc/letsencrypt" \
  certbot/certbot@sha256:c23159d30afdd9c97960578aa4654f5901de6cae394958f894074dedd55e599d \
  certonly --standalone --preferred-profile shortlived --ip-address "$ip" \
  --cert-name minecraft-bedrock --non-interactive --agree-tos \
  --register-unsafely-without-email --keep-until-expiring

source_dir=secrets/letsencrypt/live/minecraft-bedrock
target_dir=data/plugins/Geyser-Spigot/https
openssl verify -verify_ip "$ip" -untrusted "$source_dir/fullchain.pem" "$source_dir/fullchain.pem"
openssl x509 -in "$source_dir/fullchain.pem" -noout -checkend 3600
[[ "$(openssl x509 -in "$source_dir/fullchain.pem" -pubkey -noout)" == \
   "$(openssl pkey -in "$source_dir/privkey.pem" -pubout)" ]] || { echo 'Certificate/key mismatch' >&2; exit 1; }
if [[ ! -f secrets/bedrock-tls-reload-pending ]] && \
   cmp -s "$source_dir/fullchain.pem" "$target_dir/fullchain.pem" && \
   cmp -s "$source_dir/privkey.pem" "$target_dir/privkey.pem"; then
  echo 'Certificate unchanged; no reload needed'
  exit 0
fi
touch secrets/bedrock-tls-reload-pending
uid="$(stat -c %u data)"
gid="$(stat -c %g data)"
install -d -m 700 -o "$uid" -g "$gid" "$target_dir"
install -m 600 -o "$uid" -g "$gid" "$source_dir/fullchain.pem" "$target_dir/fullchain.pem"
install -m 600 -o "$uid" -g "$gid" "$source_dir/privkey.pem" "$target_dir/privkey.pem"
# Reload failures remain visible to systemd and are retried without renewing again.
docker exec minecraft rcon-cli 'geyser reload'
curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
  --retry 5 --retry-all-errors --retry-delay 1 --retry-max-time 20 "https://$ip:19132/v1/join" >/dev/null
rm secrets/bedrock-tls-reload-pending
echo 'Geyser TLS certificate installed and reloaded'
