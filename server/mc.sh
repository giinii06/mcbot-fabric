#!/usr/bin/env bash
# Paper Java hosting: ./mc.sh help
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
dc() { docker compose "$@"; }
die() { echo "$*" >&2; exit 1; }
env_get() { sed -n "s/^$1=//p" .env | head -1; }
rcon() { docker exec -e HOME=/data minecraft rcon-cli "$@"; }
running() { [[ "$(docker inspect -f '{{.State.Running}}' minecraft 2>/dev/null || true)" == true ]]; }

download() {
  local url="$1" hash="$2" target="$3" tmp
  [[ "$url" == https://* && "$hash" =~ ^[a-f0-9]{64}$ ]] || die 'Pinned HTTPS URL and SHA256 required'
  if [[ -f "$target" ]]; then
    echo "$hash  $target" | sha256sum -c - || die 'Existing JAR differs; preserve it and review the update manually'
    return
  fi
  tmp="$(mktemp)"
  if ! curl --fail --location --proto '=https' --proto-redir '=https' "$url" -o "$tmp" ||
     ! echo "$hash  $tmp" | sha256sum -c -; then
    rm -f "$tmp"; die 'Download/hash verification failed'
  fi
  mkdir -p "$(dirname "$target")"
  chmod 644 "$tmp"
  mv "$tmp" "$target"
}

backup() {
  running || die 'Start Minecraft before an online backup'
  dc run --rm --no-deps -e BACKUP_INTERVAL=0 -e BACKUP_ON_STARTUP=true -e INITIAL_DELAY=0 minecraft-backup
}

check() {
  dc config -q
  [[ "$(docker inspect -f '{{.State.Health.Status}}' minecraft)" == healthy ]] || die 'Minecraft unhealthy'
  docker exec minecraft java -version
  docker exec minecraft sh -c 'tr "\000" " " </proc/1/cmdline'
  echo
  for property in online-mode=true white-list=true enforce-whitelist=true "max-players=$(env_get MAX_PLAYERS)" gamemode=survival difficulty=peaceful view-distance=6 simulation-distance=4; do
    grep -qx "$property" data/server.properties || die "Unexpected property: $property"
  done
  echo "$(env_get PAPER_SHA256)  data/paper-$(env_get MC_VERSION)-$(env_get PAPER_BUILD).jar" | sha256sum -c -
  [[ -z "$(docker port minecraft 25575/tcp 2>/dev/null)" ]] || die 'RCON published!'
  [[ -z "$(docker port minecraft 8765/tcp 2>/dev/null)" ]] || die 'Bridge published!'
  rcon list
  rcon version
  rcon plugins
  if [[ -f data/plugins/MinecraftBridge-1.0.0.jar ]]; then
    docker exec minecraft sh -c 'curl -fsS http://127.0.0.1:8765/health' || die 'Bridge failed to initialize'
  fi
  docker stats --no-stream minecraft minecraft-backup
  echo 'CHECK PASSED (backup integrity: ./mc.sh verify-backup FILE; bot: http://127.0.0.1:47865/health)'
}

pregen() {
  local world="$1" radius="$2" players free_kb
  players="$(rcon list)"
  [[ "$players" == *'There are 0 of a max of '* ]] || die 'Pre-generation requires an empty server'
  free_kb="$(df -Pk data | awk 'NR==2 {print $4}')"
  (( free_kb >= 10485760 )) || die 'At least 10 GiB free required'
  rcon "chunky world $world"
  rcon 'chunky shape circle'
  rcon 'chunky center 0 0'
  rcon "chunky radius $radius"
  rcon 'chunky start'
}

case "${1:-help}" in
  start) dc up -d ;;
  stop|restart)
    dc stop minecraft-backup
    if running; then rcon 'save-all flush'; fi
    dc stop minecraft
    if [[ "$1" == restart ]]; then dc up -d; fi
    ;;
  status)
    dc ps
    docker stats --no-stream minecraft minecraft-backup
    df -h data backups
    ;;
  logs) shift; dc logs --tail 150 "$@" ;;
  command) shift; [[ $# -gt 0 ]] || die 'Command required'; rcon "$*" ;;
  players) rcon list ;;
  tps) rcon tps ;;
  mspt) rcon mspt ;;
  backup) backup ;;
  verify-backup)
    [[ -f "${2:-}" ]] || die 'Usage: ./mc.sh verify-backup backups/FILE.tar.zst'
    dc run --rm --no-deps --entrypoint tar -v "$(realpath "$2"):/verify.tar.zst:ro" minecraft-backup --zstd -tf /verify.tar.zst >/dev/null
    echo 'Backup archive verified'
    ;;
  download-paper)
    download "$(env_get PAPER_JAR_URL)" "$(env_get PAPER_SHA256)" "data/paper-$(env_get MC_VERSION)-$(env_get PAPER_BUILD).jar"
    ;;
  install-chunky)
    download "$(env_get CHUNKY_URL)" "$(env_get CHUNKY_SHA256)" data/plugins/Chunky.jar
    echo 'Restart Minecraft before using Chunky'
    ;;
  install-bedrock)
    download "$(env_get GEYSER_URL)" "$(env_get GEYSER_SHA256)" data/plugins/Geyser-Spigot.jar
    download "$(env_get FLOODGATE_URL)" "$(env_get FLOODGATE_SHA256)" data/plugins/floodgate-spigot.jar
    mkdir -p data/plugins/Geyser-Spigot data/plugins/floodgate
    [[ -f data/plugins/Geyser-Spigot/config.yml ]] || cp bedrock/geyser.yml data/plugins/Geyser-Spigot/config.yml
    [[ -f data/plugins/floodgate/config.yml ]] || cp bedrock/floodgate.yml data/plugins/floodgate/config.yml
    echo 'Restart Minecraft before using Bedrock; allow TCP and UDP 19132 in the cloud firewall'
    ;;
  check) check ;;
  pregen-overworld) pregen world 2000 ;;
  pregen-nether) pregen world_nether 1000 ;;
  pregen-status) rcon 'chunky progress' ;;
  pregen-pause) rcon 'chunky pause' ;;
  pregen-continue) rcon 'chunky continue' ;;
  help|-h|--help)
    echo './mc.sh start|stop|restart|status|logs [-f]|check|players|tps|mspt'
    echo './mc.sh command <Minecraft command> | backup | verify-backup FILE'
    echo './mc.sh download-paper | install-chunky | install-bedrock'
    echo './mc.sh pregen-overworld|pregen-nether|pregen-status|pregen-pause|pregen-continue'
    ;;
  *) die "Unknown command: $1" ;;
esac
