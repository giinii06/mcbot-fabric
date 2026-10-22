#!/usr/bin/env bash
# Install pinned Paper hosting; existing worlds and secrets are preserved.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "${1:-}" in
  ''|--no-start) ;;
  *) echo 'Usage: ./install.sh [--no-start]' >&2; exit 2 ;;
esac
echo '== Host =='
cat /etc/os-release
uname -srmo
nproc
free -h
df -hT .
ps -eo comm,%cpu,%mem --sort=-%cpu | head -8
if command -v java >/dev/null; then java -version; fi
command -v docker >/dev/null || { echo 'Install Docker Engine + Compose from https://docs.docker.com/engine/install/'; exit 1; }
docker compose version
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
ss -ltn '( sport = :25565 )'
command -v ufw >/dev/null && sudo -n ufw status || true
umask 077
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s/^MC_UID=.*/MC_UID=$(id -u)/; s/^MC_GID=.*/MC_GID=$(id -g)/" .env
fi
chmod 600 .env
if grep -q '^LEAF_' .env; then
  echo 'Legacy Leaf configuration found. Back up first and migrate .env using README.md.' >&2
  exit 1
fi
mkdir -p data backups secrets
chmod 700 secrets backups
if [[ ! -s secrets/rcon_password ]]; then openssl rand -hex 24 > secrets/rcon_password; fi
chmod 600 secrets/rcon_password
docker compose config -q
# Never upgrade an existing world implicitly, including install --no-start.
if [[ -f data/server.properties ]]; then
  echo 'Existing data preserved. Use ./mc.sh backup before an explicit update.'
  exit 0
fi
docker network inspect mc-discord >/dev/null 2>&1 || docker network create mc-discord
./mc.sh download-paper
./mc.sh install-bedrock
docker compose pull
echo 'OCI NSG/Security List: allow TCP 25565 and TCP/UDP 19132 from friends; retain SSH rules. Do not publish RCON/8765.'
echo 'Host firewall rules are unchanged; verify Docker forwarding as well as UFW/firewalld.'
if [[ "${1:-}" != --no-start ]]; then ./mc.sh start; fi
