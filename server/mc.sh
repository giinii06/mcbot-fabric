#!/usr/bin/env bash
# Fabric + Cobblemon 1.21.1 hosting: ./mc.sh help
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
dc() { docker compose "$@"; }
die() { echo "$*" >&2; exit 1; }
env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | head -1; }
env_get_default() { local value; value="$(env_get "$1")"; printf '%s' "${value:-$2}"; }
rcon() { docker exec -e HOME=/data minecraft rcon-cli "$@"; }
running() { [[ "$(docker inspect -f '{{.State.Running}}' minecraft 2>/dev/null || true)" == true ]]; }
mods_dir() { printf '%s' data-cobblemon/mods; }
bridge_jar() {
  find ../minecraft-bridge/build/libs -maxdepth 1 -type f -name 'MinecraftBridge-*.jar' \
    ! -name '*-sources.jar' ! -name '*-dev.jar' -printf '%T@ %p\n' 2>/dev/null |
    sort -nr | head -1 | cut -d' ' -f2-
}

download_mod() {
  local name="$1" url="$2" sha256="$3" sha512="$4" size="$5" target="$6" tmp
  [[ "$url" == https://* ]] || die "Mod URL must be HTTPS: $name"
  [[ "$sha256" =~ ^[a-f0-9]{64}$ ]] || die "Invalid SHA256 for $name"
  [[ "$sha512" =~ ^[a-f0-9]{128}$ ]] || die "Invalid SHA512 for $name"
  [[ "$size" =~ ^[0-9]+$ ]] || die "Invalid size for $name"
  mkdir -p "$(dirname "$target")"
  tmp="$(mktemp "$(dirname "$target")/.download.XXXXXX")"
  if ! curl --fail --location --proto '=https' --proto-redir '=https' "$url" -o "$tmp"; then
    rm -f "$tmp"; die "Download failed: $name"
  fi
  if [[ "$(stat -c %s "$tmp")" != "$size" ]] ||
     ! echo "$sha256  $tmp" | sha256sum --status -c - ||
     ! echo "$sha512  $tmp" | sha512sum --status -c -; then
    rm -f "$tmp"; die "Hash/size verification failed: $name"
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$target"
  echo "installed $name -> $target"
}

verify_mod_file() {
  local name="$1" target="$2" sha256="$3" sha512="$4" size="$5"
  [[ -f "$target" ]] || die "Missing mod: $target (run ./mc.sh install-mods)"
  [[ "$(stat -c %s "$target")" == "$size" ]] || die "Wrong size: $target"
  echo "$sha256  $target" | sha256sum --status -c - || die "SHA256 mismatch: $target"
  echo "$sha512  $target" | sha512sum --status -c - || die "SHA512 mismatch: $target"
  echo "verified $name ($(basename "$target"))"
}

install_bridge() {
  local jar target
  jar="$(bridge_jar)"
  if [[ -z "$jar" ]]; then
    command -v java >/dev/null || die 'Bridge jar missing and no Java runtime to build it. Build minecraft-bridge/build.sh on a machine with JDK 21 and copy the jar.'
    echo 'Bridge jar missing; building minecraft-bridge...'
    (cd ../minecraft-bridge && ./gradlew --no-daemon --console=plain build)
    jar="$(bridge_jar)"
  fi
  [[ -n "$jar" && -f "$jar" ]] || die 'Bridge build did not produce a jar'
  mkdir -p "$(mods_dir)"
  target="$(mods_dir)/$(basename "$jar")"
  install -m 644 "$jar" "$target"
  find "$(mods_dir)" -maxdepth 1 -type f -name 'MinecraftBridge-*.jar' ! -name "$(basename "$jar")" -delete
  echo "installed bridge -> $target"
}

install_mods() {
  command -v jq >/dev/null || die 'jq is required for mods.lock.json'
  [[ -f mods.lock.json ]] || die 'mods.lock.json missing'
  local file url sha256 sha512 size target
  while IFS=$'\t' read -r file url sha256 sha512 size; do
    target="$(mods_dir)/$file"
    if [[ -f "$target" ]] &&
       [[ "$(stat -c %s "$target")" == "$size" ]] &&
       echo "$sha256  $target" | sha256sum --status -c - &&
       echo "$sha512  $target" | sha512sum --status -c -; then
      echo "already installed $file"
      continue
    fi
    download_mod "$file" "$url" "$sha256" "$sha512" "$size" "$target"
  done < <(jq -r '.mods[] | [.file, .url, .sha256, .sha512, (.size|tostring)] | @tsv' mods.lock.json)
  install_bridge
  echo 'Restart Minecraft to load new mods: ./mc.sh restart'
}

verify_mods() {
  command -v jq >/dev/null || die 'jq is required for mods.lock.json'
  [[ -f mods.lock.json ]] || die 'mods.lock.json missing'
  local file url sha256 sha512 size target got_id got_version expected_id expected_version
  while IFS=$'\t' read -r file url sha256 sha512 size expected_id expected_version; do
    target="$(mods_dir)/$file"
    verify_mod_file "$expected_id" "$target" "$sha256" "$sha512" "$size"
    got_id="$(unzip -p "$target" fabric.mod.json 2>/dev/null | jq -r '.id // empty')"
    [[ "$got_id" == "$expected_id" ]] || die "fabric.mod.json id mismatch in $target: $got_id != $expected_id"
    got_version="$(unzip -p "$target" fabric.mod.json 2>/dev/null | jq -r '.version // empty')"
    [[ "$got_version" == "$expected_version" ]] || die "fabric.mod.json version mismatch in $target: $got_version != $expected_version"
  done < <(jq -r '.mods[] | [.file, .url, .sha256, .sha512, (.size|tostring), .id, .version] | @tsv' mods.lock.json)

  local bridge
  bridge="$(bridge_jar)"
  [[ -n "$bridge" ]] || die 'MinecraftBridge jar missing (build minecraft-bridge)'
  [[ -f "$(mods_dir)/$(basename "$bridge")" ]] || die "Bridge mod not installed: $(mods_dir)/$(basename "$bridge") (run ./mc.sh install-mods)"
  unzip -p "$(mods_dir)/$(basename "$bridge")" fabric.mod.json | jq -e '.id == "minecraftbridge"' >/dev/null ||
    die 'Installed bridge jar is not the Fabric mod'
  echo "verified bridge ($(basename "$bridge"))"

  local known unknown
  known="$(jq -r '.mods[].file' mods.lock.json; basename "$bridge")"
  unknown=""
  while IFS= read -r jar; do
    [[ -n "$jar" ]] || continue
    if ! grep -qxF "$(basename "$jar")" <<<"$known"; then unknown+="$(basename "$jar") "; fi
  done < <(find "$(mods_dir)" -maxdepth 1 -type f -name '*.jar' | sort)
  if [[ -n "$unknown" ]]; then
    echo "WARNING: unmanaged mod jars present (kept, not verified): $unknown"
  fi
  echo 'All pinned mods verified'
}

verify_backup() {
  local archive="${1:-}"
  [[ -n "$archive" ]] || die 'Usage: ./mc.sh verify-backup backups-cobblemon/FILE.tar.zst'
  [[ -f "$archive" ]] || die "Backup not found: $archive"
  tar --zstd -tf "$archive" >/dev/null || die "Backup archive is unreadable: $archive"
  echo "Backup archive verified: $archive"
}

verify_latest_backup() {
  local latest=''
  for archive in backups-cobblemon/*.tar.zst; do
    if [[ -f "$archive" && ( -z "$latest" || "$archive" -nt "$latest" ) ]]; then latest="$archive"; fi
  done
  [[ -n "$latest" ]] || { echo 'WARNING: no backup archive yet'; return 0; }
  verify_backup "$latest"
}

backup() {
  running || die 'Start Minecraft before an online backup'
  dc run --rm --no-deps -e BACKUP_INTERVAL=0 -e BACKUP_ON_STARTUP=true -e INITIAL_DELAY=0 minecraft-backup
  verify_latest_backup
}

restore() {
  local archive="${1:-}" work old
  [[ -n "$archive" ]] || die 'Usage: ./mc.sh restore backups-cobblemon/FILE.tar.zst'
  verify_backup "$archive" >/dev/null
  running && die 'Stop the server first: ./mc.sh stop'
  [[ -d data-cobblemon ]] || die 'data-cobblemon does not exist'
  work="$(mktemp -d ./data-cobblemon.restore.XXXXXX)"
  if ! tar --zstd -xf "$archive" -C "$work"; then
    rm -rf "$work"
    die 'Restore extraction failed; existing data was not touched'
  fi
  if [[ ! -f "$work/level.dat" && ! -f "$work/world/level.dat" ]]; then
    rm -rf "$work"
    die 'Archive does not look like a Minecraft data directory; existing data was not touched'
  fi
  old="data-cobblemon.before-restore-$(date +%Y%m%d-%H%M%S)"
  mv data-cobblemon "$old"
  mv "$work" data-cobblemon
  # Mod jars are excluded from backups; keep the ones from the protective copy.
  mkdir -p "$(mods_dir)"
  if [[ -d "$old/mods" ]]; then
    find "$old/mods" -maxdepth 1 -type f -name '*.jar' -exec cp --update=none {} "$(mods_dir)/" \;
  fi
  echo "Restored $archive"
  echo "Protective copy: $old (remove it only after verifying the restore)"
  echo 'Run ./mc.sh start and ./mc.sh check'
}

check() {
  dc config -q
  [[ -d data-cobblemon ]] || die 'data-cobblemon missing'
  [[ "$(docker inspect -f '{{.State.Health.Status}}' minecraft 2>/dev/null || true)" == healthy ]] || die 'Minecraft unhealthy'
  docker exec minecraft java -version 2>&1 | grep -c 'version "21' >/dev/null || die 'Java 21 not running'
  docker exec minecraft sh -c 'tr "\000" " " </proc/1/cmdline' | grep -ci 'fabric' >/dev/null || die 'Fabric loader not in the server process'

  local difficulty max_players
  difficulty="$(env_get_default DIFFICULTY easy)"
  max_players="$(env_get_default MAX_PLAYERS 1000)"
  for property in online-mode=true white-list=true enforce-whitelist=true "max-players=$max_players" \
    gamemode=survival "difficulty=$difficulty" "view-distance=$(env_get_default VIEW_DISTANCE 6)" \
    "simulation-distance=$(env_get_default SIMULATION_DISTANCE 4)"; do
    grep -qx "$property" data-cobblemon/server.properties || die "Unexpected property: $property"
  done

  verify_mods
  [[ ! -d data-cobblemon/plugins ]] || [[ -z "$(find data-cobblemon/plugins -name '*.jar' -print -quit)" ]] ||
    die 'Bukkit/Paper plugin jars found in data-cobblemon/plugins'

  rcon list
  [[ "$(docker exec minecraft printenv VERSION)" == "1.21.1" ]] || die 'Server is not 1.21.1'
  docker logs minecraft 2>&1 | grep -c 'Starting minecraft server version 1.21.1' >/dev/null || die 'Server did not start 1.21.1'
  rcon 'gamerule keepInventory' | grep -q 'true' || die 'keepInventory is not true'
  rcon difficulty | grep -qi "$difficulty" || die "Difficulty is not $difficulty"
  docker exec minecraft curl -fsS http://127.0.0.1:8765/health | grep -q '"ok":true' || die 'Bridge health failed'
  docker exec minecraft curl -fsS http://127.0.0.1:8765/health | grep -q '"minecraft":true' || die 'Bridge is not attached to the server'

  local port
  for port in 25575/tcp 8765/tcp 19132/tcp 19132/udp; do
    [[ -z "$(docker port minecraft "$port" 2>/dev/null)" ]] || die "Port published unexpectedly: $port"
  done
  [[ -n "$(docker port minecraft 25565/tcp 2>/dev/null)" ]] || die 'Java port 25565 is not published'

  verify_latest_backup
  docker stats --no-stream minecraft minecraft-backup
  df -h data-cobblemon backups-cobblemon
  echo 'CHECK PASSED (bot: http://127.0.0.1:47865/health)'
}

case "${1:-help}" in
  start) dc up -d ;;
  stop|restart)
    dc stop minecraft-backup 2>/dev/null || true
    if running; then rcon 'save-all flush' || true; fi
    dc stop minecraft
    if [[ "$1" == restart ]]; then dc up -d; fi
    ;;
  status)
    dc ps
    docker stats --no-stream minecraft minecraft-backup
    df -h data-cobblemon backups-cobblemon
    ;;
  logs) shift; dc logs --tail 150 "$@" ;;
  command) shift; [[ $# -gt 0 ]] || die 'Command required'; rcon "$*" ;;
  players) rcon list ;;
  backup) backup ;;
  restore) restore "${2:-}" ;;
  verify-backup) verify_backup "${2:-}" ;;
  install-mods) install_mods ;;
  verify-mods) verify_mods ;;
  check) check ;;
  help|-h|--help)
    echo './mc.sh start|stop|restart|status|logs [-f]|check|players'
    echo './mc.sh command <Minecraft command>'
    echo './mc.sh install-mods | verify-mods'
    echo './mc.sh backup | verify-backup backups-cobblemon/FILE.tar.zst | restore backups-cobblemon/FILE.tar.zst'
    ;;
  *) die "Unknown command: $1" ;;
esac
