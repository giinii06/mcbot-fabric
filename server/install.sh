#!/usr/bin/env bash
# Install pinned Fabric + Cobblemon hosting.
# Existing Paper data/ is never read, moved or modified.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

no_start=0
new_world=0
for arg in "$@"; do
  case "$arg" in
    --no-start) no_start=1 ;;
    --new-world) new_world=1 ;;
    *) echo 'Usage: ./install.sh [--no-start] [--new-world]' >&2; exit 2 ;;
  esac
done

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
for tool in jq unzip curl openssl tar zstd; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
ss -ltn '( sport = :25565 )'
command -v ufw >/dev/null && sudo -n ufw status || true

# The old Paper 26.3 world cannot be opened by Minecraft 1.21.1. Never convert
# or downgrade it silently; a new Fabric world lives in data-cobblemon.
if [[ -f data/level.dat ]]; then
  cat >&2 <<'EOF'
ERROR: server/data/ contains an existing Paper world (level.dat).

Paper 26.3 worlds are NOT compatible with Minecraft 1.21.1 / Fabric. This
installer will not move, convert or downgrade that world. It is left untouched.

The Fabric + Cobblemon server uses a separate directory: server/data-cobblemon.
To create a fresh Cobblemon world and keep the old Paper data as-is, re-run:

  ./install.sh --new-world [--no-start]

See docs/MIGRATION_FROM_PAPER.md for what can and cannot be migrated.
EOF
  [[ "$new_world" == 1 ]] || exit 1
  echo '--new-world accepted: creating data-cobblemon; data/ will not be touched.'
fi

umask 077
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s/^MC_UID=.*/MC_UID=$(id -u)/; s/^MC_GID=.*/MC_GID=$(id -g)/" .env
fi
chmod 600 .env
# Migrate an old Paper .env: the Fabric stack's core versions are fixed, so
# override stale values instead of inheriting Paper 26.3.
set_env() {
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
append_env() { grep -q "^$1=" .env || echo "$1=$2" >> .env; }
set_env MC_VERSION 1.21.1
set_env FABRIC_LOADER_VERSION 0.20.1
set_env FABRIC_INSTALLER_VERSION 1.1.2
append_env DIFFICULTY peaceful
if grep -qE '^(PAPER_|GEYSER_|FLOODGATE_|CHUNKY_)' .env; then
  echo 'NOTE: legacy Paper/Geyser entries in .env are ignored by the Fabric compose file.'
fi

mkdir -p data-cobblemon/mods data-cobblemon/config backups-cobblemon secrets
chmod 700 secrets backups-cobblemon
if [[ ! -s secrets/rcon_password ]]; then openssl rand -hex 24 > secrets/rcon_password; fi
chmod 600 secrets/rcon_password
if [[ ! -s secrets/bridge_secret ]]; then
  secret=''
  if [[ -f ../.env ]]; then secret="$(sed -n 's/^MC_BRIDGE_SECRET=//p' ../.env | head -1)"; fi
  if [[ -z "$secret" ]]; then secret="${MC_BRIDGE_SECRET:-}"; fi
  if [[ ${#secret} -ge 16 ]]; then
    printf '%s' "$secret" > secrets/bridge_secret
  else
    openssl rand -hex 32 > secrets/bridge_secret
    echo 'Generated server/secrets/bridge_secret.'
    echo 'Set the SAME value as MC_BRIDGE_SECRET in the bot .env (do not commit or print it):'
    echo '  cat server/secrets/bridge_secret'
  fi
fi
chmod 600 secrets/bridge_secret

if [[ ! -f data-cobblemon/config/minecraftbridge.json ]]; then
  cat > data-cobblemon/config/minecraftbridge.json <<'EOF'
{
  "enabled": true,
  "botBaseUrl": "http://mcbot:47865",
  "bind": "0.0.0.0",
  "port": 8765,
  "secretFile": "/run/secrets/bridge_secret",
  "secret": "",
  "timeouts": { "botConnectMs": 3000, "botRequestMs": 3000, "syncTaskMs": 4000 },
  "queue": { "capacity": 200, "workers": 2, "retry": 1 }
}
EOF
  chmod 600 data-cobblemon/config/minecraftbridge.json
fi

docker compose config -q
docker network inspect mc-discord >/dev/null 2>&1 || docker network create mc-discord
./mc.sh install-mods
./mc.sh verify-mods
docker compose pull

echo 'Public ports: TCP 25565 only. Keep 25575 (RCON), 8765 (bridge), 19132 (Bedrock) closed.'
echo 'The bridge is reachable only from the mc-discord Docker network, never from the host.'
echo 'OCI NSG/Security List: allow TCP 25565 from friends; retain SSH rules.'
if [[ "$no_start" == 0 ]]; then ./mc.sh start; fi
