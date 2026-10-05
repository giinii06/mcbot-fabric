#!/usr/bin/env bash
# =============================================================================
# mc.sh - Minecraft cross-play server control script (Leaf 1.21.11 + Bedrock)
# 위치: <repo>/server/mc.sh  (이 디렉터리 기준 상대경로로만 동작, 다른 호스트에
#         server/째로 복사해도 그대로 사용 가능)
#
#   ./mc.sh start | stop | restart | status | logs | console
#   ./mc.sh backup                 즉시 백업 (정원 백업과 동일한 방식, 성공/실패 확인)
#   ./mc.sh update-plugins [--dry-run]   공식 API 로 플러그인 최신화 + 해시 검증 + 재시작
#   ./mc.sh check                  전체 구동 검증 (필수)
#   ./mc.sh pregen-overworld|pregen-nether|pregen-end   Chunky 월드 사전 생성
#   ./mc.sh pregen-status|pregen-pause|pregen-continue|pregen-cancel
#   ./mc.sh players | tps | mspt
# =============================================================================
set -Eeuo pipefail

MC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
COMPOSE_FILE="${MC_DIR}/compose.yaml"
CONTAINER="minecraft"
SECRET_RCON="${MC_DIR}/secrets/rcon_password"
DATA_DIR="${MC_DIR}/data"
ENV_FILE="${MC_DIR}/.env"

log()  { printf '\033[1;34m[mc]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mc] WARN:\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[mc] ERROR:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

dc() { docker compose --project-directory "${MC_DIR}" -f "${COMPOSE_FILE}" "$@"; }

running() { [[ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null || echo false)" == "true" ]]; }

need_running() { running || die "서버가 실행 중이 아닙니다. ./mc.sh start"; }

# rcon-cli 는 /data/.rcon-cli.yaml (HOME=/data) 을 읽는다
rcon() { docker exec -e HOME=/data "${CONTAINER}" rcon-cli "$@"; }

rcon_quiet() { rcon "$@" 2>&1 | grep -vE '^$' || true; }

env_get() { [[ -f "${ENV_FILE}" ]] && grep -E "^$1=" "${ENV_FILE}" | head -1 | cut -d= -f2- || true; }

# -----------------------------------------------------------------------------
usage() { awk 'NR>1 && /^set -Eeuo/{exit} NR>1{print}' "$0"; }

wait_ready() {
  local deadline=$(( $(date +%s) + ${1:-600} ))
  local since="${2:-0}"
  local lg
  while (( $(date +%s) < deadline )); do
    lg="$(docker logs --since "${since}" "${CONTAINER}" 2>&1 || true)"
    if printf '%s\n' "${lg}" | grep -cE 'Done \([0-9.]+s\)!' | grep -qv '^0$'; then return 0; fi
    running || return 1
    sleep 3
  done
  return 1
}

# -----------------------------------------------------------------------------
cmd_start() {
  if running; then log "이미 실행 중"; return 0; fi
  log "서버 기동"
  local t0; t0="$(date +%s)"
  dc up -d
  log "첫 부팅 대기 중..."
  wait_ready 900 "${t0}" || die "부팅 완료 신호 미수신 (./mc.sh logs)"
  log "부팅 완료"
  rcon_quiet list || true
}

cmd_stop() {
  running || { log "이미 정지됨"; return 0; }
  log "안전 종료 (save-all → 종료, grace 60s)"
  rcon_quiet save-all flush || warn "RCON save-all 실패 (이미 종료 중일 수 있음)"
  dc stop
  log "정지 완료"
}

cmd_restart() {
  if running; then cmd_stop; fi
  cmd_start
}

cmd_status() {
  echo "== compose =="
  dc ps
  echo
  echo "== 포트 =="
  ss -ltn 2>/dev/null | awk 'NR==1 || $4 ~ /:25565$/' || true
  ss -lun 2>/dev/null | awk 'NR==1 || $4 ~ /:19132$/' || true
  echo
  echo "== 리소스 =="
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' \
    "${CONTAINER}" minecraft-backup 2>/dev/null || true
  free -h | sed -n '1,3p'
  echo
  echo "== 백업 (최근 5건) =="
  ls -1t "${MC_DIR}/backups" 2>/dev/null | head -5 || echo "(없음)"
  echo
  if running; then
    echo "== 게임 서버 =="
    echo "   Leaf: $(docker logs "${CONTAINER}" 2>&1 | grep -m1 -E 'Starting minecraft server version|Leaf')"
    echo "   players: $(rcon_quiet list | tr -d '\r' | head -1)"
    echo "   view/sim: $(rcon_quiet 'list' >/dev/null 2>&1; grep -E '^(view-distance|simulation-distance)=' "${DATA_DIR}/server.properties" 2>/dev/null | tr '\n' ' ')"
  else
    echo "서버 정지 상태"
  fi
}

cmd_logs() {
  local follow=false n=150 a
  for a in "$@"; do
    case "$a" in
      -f|--follow) follow=true ;;
      ''|[0-9]*) n="${a:-$n}" ;;
      *) die "사용: ./mc.sh logs [줄수] [-f]" ;;
    esac
  done
  if [[ "${follow}" == true ]]; then
    docker logs -f --tail "${n}" "${CONTAINER}" 2>&1 || true
  else
    docker logs --tail "${n}" "${CONTAINER}" 2>&1 | tr -d '\r' || true
  fi
}

cmd_console() {
  need_running
  if [[ ! -t 0 ]]; then
    die "콘솔은 터미널(TTY)이 필요합니다. 직접 실행하세요: ./mc.sh console"
  fi
  log "콘솔 진입: 명령 입력. 나가려면 Ctrl-P Ctrl-Q (Ctrl-C 는 서버를 종료합니다)"
  docker attach --sig-proxy=false "${CONTAINER}"
}

# -----------------------------------------------------------------------------
cmd_backup() {
  need_running
  local out tmp
  tmp="$(mktemp)"
  log "즉시 백업 실행 (docker compose run --rm minecraft-backup)"
  if dc run --rm --no-deps \
      -e BACKUP_INTERVAL=0 -e BACKUP_ON_STARTUP=true -e INITIAL_DELAY=0 \
      minecraft-backup 2>&1 | tee "${tmp}"; then
    log "백업 컨테이너 정상 종료"
  else
    err "백업 실패"
    grep -E 'ERROR|error|failed|Failed' "${tmp}" | tail -20 || true
    rm -f "${tmp}"
    exit 1
  fi
  rm -f "${tmp}"
  echo
  log "최근 백업 파일:"
  ls -lhtr "${MC_DIR}/backups" | tail -6
}

# -----------------------------------------------------------------------------
cmd_update_plugins() {
  local dry=false a
  for a in "$@"; do
    case "$a" in
      --dry-run) dry=true ;;
      -h|--help) echo "usage: ./mc.sh update-plugins [--dry-run]"; return 0 ;;
      *) die "알 수 없는 옵션: $a (사용: ./mc.sh update-plugins [--dry-run])" ;;
    esac
  done

  command -v python3 >/dev/null || die "python3 필요"
  if [[ "${dry}" == false ]]; then
    log "백업 먼저 (실패 시 중단)"
    cmd_backup
  else
    log "dry-run: 백업/재시작 없음 (조회+다운로드+검증만 수행)"
  fi

  local tmp plan
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" EXIT

  MC_VERSION="$(env_get MC_VERSION)" python3 - "${tmp}" <<'PYUPDATE'
import hashlib, json, os, sys, urllib.request, urllib.parse

tmp = sys.argv[1]
MC_VERSION = os.environ.get("MC_VERSION") or "1.21.11"

def get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "mc.sh-update/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def get_json(url):
    return json.loads(get(url))

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

plugins = {}

# Geyser / Floodgate: 공식 geysermc download API
for name in ("geyser", "floodgate"):
    meta = get_json(f"https://download.geysermc.org/v2/projects/{name}/versions/latest/builds/latest")
    plugins[name] = {
        "version": f"{meta['version']}/b{meta['build']}",
        "url": f"https://download.geysermc.org/v2/projects/{name}/versions/{meta['version']}/builds/{meta['build']}/downloads/spigot",
        "sha256": meta["downloads"]["spigot"]["sha256"],
        "compat": "공식 API 최신 빌드",
    }

# ViaVersion: Hangar 공식 API + 서버 버전 호환 판정
v = get_json("https://hangar.papermc.io/api/v1/projects/ViaVersion/versions?limit=1&channel=Release")["result"][0]["name"]
det = get_json("https://hangar.papermc.io/api/v1/projects/ViaVersion/versions/" + urllib.parse.quote(v))
dl = det["downloads"]["PAPER"]
compat = det.get("platformDependencies", {}).get("PAPER") or [g["name"] for g in det.get("gameVersions", [])]
if compat and MC_VERSION not in compat:
    raise SystemExit(f"viaversion {v}: {MC_VERSION} 호환 목록에 없음 -> 업데이트 중단")
plugins["viaversion"] = {"version": v, "url": dl["downloadUrl"],
                         "sha256": dl["fileInfo"]["sha256Hash"],
                         "compat": "PAPER 호환 목록에 " + MC_VERSION + " 포함"}

# Chunky: Modrinth 에서 1.21.11 호환 최신 버전 판정 -> Hangar 에서 다운로드/해시
mod = get_json("https://api.modrinth.com/v2/project/chunky/version?loaders=%5B%22bukkit%22,%22spigot%22,%22paper%22%5D")
cands = [x for x in mod if MC_VERSION in x.get("game_versions", [])]
if not cands:
    raise SystemExit(f"chunky: {MC_VERSION} 호환 버전을 Modrinth 에서 찾지 못함 -> 업데이트 중단")
cands.sort(key=lambda x: x.get("date_published", ""), reverse=True)
pick = cands[0]["version_number"]
det = get_json("https://hangar.papermc.io/api/v1/projects/pop4959/Chunky/versions/" + urllib.parse.quote(pick))
dl = det["downloads"]["PAPER"]
ccompat = det.get("platformDependencies", {}).get("PAPER") or [g["name"] for g in det.get("gameVersions", [])]
if ccompat and MC_VERSION not in ccompat:
    raise SystemExit(f"chunky {pick}: Hangar 호환 목록에 {MC_VERSION} 없음 -> 업데이트 중단")
plugins["chunky"] = {"version": pick, "url": dl["downloadUrl"],
                     "sha256": dl["fileInfo"]["sha256Hash"],
                     "compat": "Modrinth/Hangar 호환 목록에 " + MC_VERSION + " 포함"}

# 다운로드 + sha256 + plugin.jar 검증
import zipfile
for name, info in plugins.items():
    path = os.path.join(tmp, name + ".jar")
    data = get(info["url"])
    open(path, "wb").write(data)
    got = sha256(path)
    want = (info["sha256"] or "").lower()
    if want and got != want:
        raise SystemExit(f"{name}: sha256 불일치 (api={want} local={got})")
    with zipfile.ZipFile(path) as z:
        if not any(n.endswith(("plugin.yml", "paper-plugin.yml")) for n in z.namelist()):
            raise SystemExit(f"{name}: plugin.yml 없는 jar -> 플러그인 아님")
    print(f"  OK {name:11s} v{info['version']:<10s} sha256={got[:16]}... {len(data):,} bytes | {info['compat']}")

json.dump(plugins, open(os.path.join(tmp, "result.json"), "w"), indent=2)
PYUPDATE

  # .env 비교 (dry-run 이면 기록만)
  python3 - "${tmp}/result.json" "${ENV_FILE}" "${tmp}" "${dry}" <<'PYENV'
import json, re, sys
result, env_path, tmp, dry = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
plugins = json.load(open(result))
keymap = {"geyser": "GEYSER", "floodgate": "FLOODGATE", "viaversion": "VIAVERSION", "chunky": "CHUNKY"}
text = open(env_path).read()
changes = []
for name, info in plugins.items():
    pre = keymap[name]
    for suffix, value in (("URL", info["url"]), ("SHA256", info["sha256"])):
        key = f"{pre}_{suffix}"
        m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
        cur = m.group(1) if m else None
        if cur != value:
            changes.append(f"    {key}: {cur or '(없음)'}  ->  {value}")
            if not dry:
                line = f"{key}={value}"
                if m:
                    text = re.sub(rf"^{re.escape(key)}=.*$", line, text, flags=re.M)
                else:
                    text = text.rstrip("\n") + "\n" + line + "\n"
if not changes:
    print("  .env 변경 없음 (모두 최신)")
elif dry:
    print("  [dry-run] 적용될 변경:")
    print("\n".join(changes))
else:
    open(env_path, "w").write(text)
    print("  .env 갱신됨:")
    print("\n".join(changes))
json.dump({"changes": len(changes)}, open(f"{tmp}/plan.json", "w"))
PYENV

  plan="$(python3 -c "import json;print(json.load(open('${tmp}/plan.json'))['changes'])")"

  if [[ "${dry}" == true ]]; then
    if [[ "${plan}" == "0" ]]; then
      log "dry-run 완료: 이미 최신 상태 -> 재시작 불필요"
    else
      log "dry-run 완료: 변경 ${plan} 건 -> 실제 적용은 ./mc.sh update-plugins"
    fi
    return 0
  fi

  if [[ "${plan}" == "0" ]]; then
    log "이미 최신 -> 재시작하지 않음"
    return 0
  fi

  log "재시작하여 새 플러그인 적용"
  cmd_stop
  cmd_start
  sleep 5
  docker logs "${CONTAINER}" 2>&1 | grep -aE 'Geyser|floodgate|ViaVersion|Chunky|ERROR' | tail -25 || true
  log "update-plugins 완료"
}

# -----------------------------------------------------------------------------
cmd_pregen() {
  local world="$1" shape="$2" radius="$3"
  need_running
  log "Chunky pregen 시작: world=${world} shape=${shape} radius=${radius}"
  warn "CPU/IO 를 계속 점유합니다. 실행 중에는 다른 무거운 작업을 피하세요."
  rcon_quiet "chunky quiet 300" >/dev/null || true
  rcon_quiet "chunky world ${world}" >/dev/null
  rcon_quiet "chunky shape ${shape}" >/dev/null
  rcon_quiet "chunky radius ${radius}" >/dev/null
  rcon_quiet "chunky start" || die "chunky start 실패"
  rcon_quiet "chunky progress" || true
  log "진행 확인: ./mc.sh pregen-status"
}

cmd_pregen_status() { need_running; rcon_quiet "chunky progress"; }
cmd_pregen_cancel()  {
  need_running
  log "Chunky 작업 취소 (confirm 필요)"
  rcon_quiet "chunky cancel"
  rcon_quiet "chunky confirm" >/dev/null 2>&1 || true
  rcon_quiet "chunky progress"
}

cmd_pregen_pause()   { need_running; rcon_quiet "chunky pause"; rcon_quiet "chunky progress"; }
cmd_pregen_continue(){ need_running; rcon_quiet "chunky continue"; rcon_quiet "chunky progress"; }

cmd_players() {
  need_running
  rcon_quiet list | tr -d '\r'
  echo "-- op --"
  grep -E '^[^#].*' "${DATA_DIR}/ops.json" 2>/dev/null || echo "(없음)"
}

# Leaf 는 /tps, /mspt 를 기본 제공 (spark 도 번들 내장, 별도 설치 금지)
cmd_tps() {
  need_running
  local out
  out="$(rcon_quiet tps | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^$')"
  if [[ -z "${out}" ]]; then out="$(rcon_quiet "spark tps" | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^$')"; fi
  printf '%s\n' "${out:-TPS 조회 실패}"
}

cmd_mspt() {
  need_running
  local out
  out="$(rcon_quiet mspt | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^$')"
  if [[ -z "${out}" ]]; then
    out="$(rcon_quiet "spark tps" | sed 's/\x1b\[[0-9;]*m//g' | grep -A1 'Tick durations')"
  fi
  printf '%s\n' "${out:-MSPT 조회 실패}"
}

# -----------------------------------------------------------------------------
cmd_check() {
  local fail=0
  ok()   { printf '  \033[1;32mPASS\033[0m  %s\n' "$*"; }
  no()   { printf '  \033[1;31mFAIL\033[0m  %s\n' "$*"; fail=1; }
  info() { printf '  \033[1;34mINFO\033[0m  %s\n' "$*"; }

  echo "== 1. 하드웨어 / 호스트 =="
  case "$(uname -m)" in aarch64|arm64) ok "아키텍처 $(uname -m) (ARM64)";; x86_64|amd64) ok "아키텍처 $(uname -m) (x86_64)";; *) no "아키텍처 $(uname -m) (aarch64/arm64/x86_64 기대)";; esac
  local cores; cores="$(nproc)"
  (( cores >= 2 )) && ok "CPU ${cores} cores" || no "CPU ${cores} cores"
  local avail; avail="$(awk '/^Mem:/{print $7}' <(free -m))"
  info "RAM available ${avail} MB"
  local swap; swap="$(awk 'NR>1{t+=$2} END{print t+0}' <(swapon --show --bytes 2>/dev/null || true))"
  (( swap == 0 )) && info "swap 0 (Leaf 는 -XX:+ExitOnOutOfMemoryError 로 panic/종료 대응)"
  local disk; disk="$(df -Pm / | awk 'NR==2{print $4}')"
  (( disk > 2048 )) && ok "디스크 여유 ${disk} MB" || no "디스크 여유 ${disk} MB 부족"

  echo "== 2. 구성 파일 =="
  [[ -f "${MC_DIR}/compose.yaml" ]] && ok "compose.yaml" || no "compose.yaml 없음"
  [[ -f "${ENV_FILE}" ]] && ok ".env" || no ".env 없음"
  [[ -x "${MC_DIR}/mc.sh" ]] && ok "mc.sh 실행권한" || no "mc.sh 실행권한 없음"
  if [[ -f "${MC_DIR}/.gitignore" ]]; then
    local g
    for g in 'data/' 'backups/' 'secrets/' '.env'; do
      grep -qF -- "${g}" "${MC_DIR}/.gitignore" && ok ".gitignore 제외: ${g}" || no ".gitignore 제외 누락: ${g}"
    done
    if grep -qiE 'key\.pem|\*\.pem' "${MC_DIR}/.gitignore"; then ok ".gitignore 제외: key.pem"; else no ".gitignore 제외 누락: key.pem"; fi
  else
    no ".gitignore 없음"
  fi
  if docker compose --project-directory "${MC_DIR}" -f "${MC_DIR}/compose.yaml" config -q; then
    ok "compose.yaml 문법"
  else
    no "compose.yaml 문법"
  fi
  local secmode
  secmode="$(stat -c '%a' "${MC_DIR}/secrets/rcon_password" 2>/dev/null || echo none)"
  [[ "${secmode}" == "600" ]] && ok "rcon_password 권한 600" || no "rcon_password 권한 ${secmode} (600 필요)"
  local hit
  hit="$(grep -hnE '^[[:space:]]*RCON_PASSWORD[[:space:]]*:' "${MC_DIR}/compose.yaml" 2>/dev/null || true)"
  hit="${hit}$(grep -hnE '^RCON_PASSWORD=' "${MC_DIR}/.env" 2>/dev/null || true)"
  if [[ -n "${hit// /}" ]]; then
    no "compose/.env 에 RCON 비밀번호 평문 존재: $(printf '%s' "${hit}" | tr '\n' ' ')"
  else
    ok "RCON 비밀번호는 파일 마운트만 사용 (평문 없음)"
  fi

  echo "== 3. 컨테이너 =="
  if running; then ok "minecraft running"; else no "minecraft 미실행"; fi
  local rcount
  rcount="$(docker inspect -f '{{.RestartCount}}' "${CONTAINER}" 2>/dev/null || echo '?')"
  [[ "${rcount}" == "0" ]] && ok "재시작 횟수 0" || info "재시작 횟수 ${rcount}"
  local memlim; memlim="$(docker inspect -f '{{.HostConfig.Memory}}' "${CONTAINER}" 2>/dev/null || echo 0)"
  [[ "${memlim}" -eq 5368709120 ]] && ok "mem_limit 5g" || no "mem_limit ${memlim} (5368709120 기대)"
  local cpulim; cpulim="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "${CONTAINER}" 2>/dev/null || echo 0)"
  [[ "${cpulim}" -eq 1750000000 ]] && ok "cpus 1.75" || no "cpus ${cpulim}"
  docker ps --format '{{.Names}}' | grep -qx 'minecraft-backup' && ok "minecraft-backup running" || no "minecraft-backup 미실행"
  if docker ps --format '{{.Names}} {{.Image}}' | grep -v -E 'minecraft|mcbot' | grep -q .; then
    info "기타 컨테이너(미변경): $(docker ps --format '{{.Names}}' | grep -vE 'minecraft$|minecraft-backup$|^mcbot$' | tr '\n' ' ')"
  fi

  echo "== 4. 서버 프로세스 / JVM =="
  if running; then
    local jvm_max
    jvm_max="$(docker exec "${CONTAINER}" sh -c "tr '\\0' '\\n' < /proc/1/cmdline | grep -m1 -- '-Xmx'" 2>/dev/null || true)"
    [[ "${jvm_max}" == "-Xmx4G" ]] && ok "JVM ${jvm_max}" || no "JVM ${jvm_max:-(미확인)} (−Xmx4G 기대)"
    local jvm_init
    jvm_init="$(docker exec "${CONTAINER}" sh -c "tr '\\0' '\\n' < /proc/1/cmdline | grep -m1 -- '-Xms'" 2>/dev/null || true)"
    [[ "${jvm_init}" == "-Xms1G" ]] && ok "JVM ${jvm_init}" || no "JVM ${jvm_init:-(미확인)} (−Xms1G 기대)"
    info "java: $(docker exec "${CONTAINER}" java -version 2>&1 | head -1)"
  fi

  echo "== 5. 포트 =="
  ss -ltn 2>/dev/null | grep -qE ':25565\s' && ok "TCP 25565 리스닝" || no "TCP 25565 미리스닝"
  ss -lun 2>/dev/null | grep -qE ':19132\s' && ok "UDP 19132 리스닝" || no "UDP 19132 미리스닝"
  # 연결 테스트
  if (exec 3<>/dev/tcp/127.0.0.1/25565) 2>/dev/null; then
    exec 3>&- 3<&-
    ok "TCP 25565 연결 성공"
  else
    no "TCP 25565 연결 실패"
  fi

  echo "== 5b. 엔드포인트 실응답 =="
  if ! python3 - <<'PYPING'
import json, socket, struct, sys, time

fail = 0

def varint(n):
    out = b''
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | 0x80]) if n else bytes([b])
        if not n:
            break
    return out

def read_varint(buf, i):
    n = 0
    sh = 0
    while True:
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << sh
        sh += 7
        if not (b & 0x80):
            return n, i

# --- Bedrock: RakNet Unconnected Ping -> Pong (Geyser) ---
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(6)
    magic = b'\x00\xff\xff\x00\xfe\xfe\xfe\xfe\xfd\xfd\xfd\xfd\x12\x34\x56\x78'
    ts = int(time.time())
    s.sendto(b'\x01' + struct.pack('>Q', ts) + magic + struct.pack('>Q', ts), ('127.0.0.1', 19132))
    data, _ = s.recvfrom(4096)
    s.close()
    assert data[0] == 0x1C, f'unexpected packet id 0x{data[0]:02x}'
    off = 1 + 8 + 8 + 16
    ln, = struct.unpack('>H', data[off:off + 2])
    status = data[off + 2:off + 2 + ln].decode('utf-8', 'replace')
    parts = status.split(';')
    assert parts[0] == 'MCPE', f'edition={parts[0]!r}'
    online, maxp = parts[4], parts[5]
    port_v4 = parts[10] if len(parts) > 10 else '?'
    assert port_v4 == '19132', f'bedrock port={port_v4}'
    print(f'  PASS  Bedrock UDP 19132 RakNet Pong (MCPE, {online}/{maxp} players, port {port_v4})')
except Exception as e:
    print(f'  FAIL  Bedrock UDP 19132 핑 실패: {e}')
    fail = 1

# --- Java: server list ping ---
try:
    host, port = '127.0.0.1', 25565
    payload = json.dumps({"version": {"name": "1.21.11", "protocol": 774},
                          "players": {"max": 100, "online": 0},
                          "description": {"text": "ping"}}).encode()
    hs = varint(0) + varint(774) + varint(len(host)) + host.encode() + struct.pack('>H', port) + varint(1)
    st = varint(0)
    s = socket.create_connection((host, port), timeout=6)
    s.settimeout(6)
    s.sendall(varint(len(hs)) + hs + varint(len(st)) + st)
    buf = b''
    while len(buf) < 3:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    s.close()
    n, i = read_varint(buf, 0)
    body = buf[i:i + n]
    assert body[0] == 0x00, f'packet id {body[0]}'
    jlen, j = read_varint(body, 1)
    info = json.loads(body[j:j + jlen].decode('utf-8'))
    ver = info.get('version', {})
    assert ver.get('protocol') == 774, f'protocol={ver.get("protocol")}'
    assert 'Leaf' in ver.get('name', ''), f'name={ver.get("name")!r}'
    pl = info.get('players', {})
    print(f'  PASS  Java TCP 25565 status ping ({ver.get("name")}, protocol {ver.get("protocol")}, {pl.get("online")}/{pl.get("max")} players)')
except Exception as e:
    print(f'  FAIL  Java TCP 25565 핑 실패: {e}')
    fail = 1

sys.exit(fail)
PYPING
  then
    fail=1
  fi

  echo "== 6. server.properties =="
  local sp="${DATA_DIR}/server.properties"
  if [[ -f "${sp}" ]]; then
    local k v
    for k in server-port online-mode view-distance simulation-distance \
             pause-when-empty-seconds sync-chunk-writes use-native-transport; do
      v="$(grep -E "^${k}=" "${sp}" | head -1 | cut -d= -f2- || true)"
      info "${k}=${v:-(없음)}"
    done
    grep -qE '^server-port=25565' "${sp}" && ok "server-port=25565" || no "server-port≠25565"
    grep -qE '^server-port=19132' "${sp}" && warn "server-port(Java)가 19132 로 되어 있음 (Bedrock 포트와 혼동 주의)"
    grep -qE '^online-mode=true' "${sp}" && ok "online-mode=true (오프라인 금지)" || no "online-mode 가 true 가 아님"
    grep -qE '^view-distance=' "${sp}" && ok "view-distance 지정됨" || no "view-distance 없음"
    grep -qE '^pause-when-empty-seconds=' "${sp}" && ok "pause-when-empty-seconds 지정됨" || no "pause-when-empty-seconds 없음"
  else
    no "server.properties 없음"
  fi

  echo "== 7. 서버 구현체 / 플러그인 파일 =="
  local jar
  jar="$(ls "${DATA_DIR}"/leaf-*.jar 2>/dev/null | head -1)"
  if [[ -n "${jar}" ]]; then
    local got want
    got="$(sha256sum "${jar}" | awk '{print $1}')"
    want="$(env_get LEAF_SHA256)"
    [[ -n "${want}" && "${got}" == "${want}" ]] && ok "Leaf #179 sha256 일치" || no "Leaf sha256 불일치 (${got})"
  else
    no "Leaf jar 없음"
  fi
  for f in "plugins/Geyser-Spigot.jar" "plugins/floodgate-spigot.jar" \
           "plugins/ViaVersion-5.12.0.jar" "plugins/Chunky-Bukkit-1.4.40.jar"; do
    [[ -f "${DATA_DIR}/${f}" ]] && ok "${f}" || no "${f} 없음"
  done
  [[ -f "${DATA_DIR}/plugins/floodgate/key.pem" ]] && ok "Floodgate key.pem 생성됨" || no "Floodgate key.pem 없음"
  if running; then
    local all_logs en_hits
    all_logs="$(docker logs "${CONTAINER}" 2>&1 || true)"
    en_hits="$(printf '%s\n' "${all_logs}" | grep -icE 'Enabling (Geyser|Floodgate|ViaVersion|Chunky)' || true)"
    if [[ "${en_hits}" -ge 4 ]]; then
      ok "플러그인 활성화 로그 4종 확인 (${en_hits})"
    else
      no "플러그인 활성화 로그 부족 (${en_hits}/4)"
    fi
  fi

  echo "== 8. Geyser 설정 =="
  local gcfg="${DATA_DIR}/plugins/Geyser-Spigot/config.yml"
  if [[ -f "${gcfg}" ]]; then
    python3 - "${gcfg}" <<'PY' || no "Geyser 설정 판정 실패"
import sys, yaml
cfg = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
def find(d, key, path=""):
    out = []
    if isinstance(d, dict):
        for k, v in d.items():
            p = f"{path}.{k}" if path else str(k)
            if str(k).lower() == key: out.append((p, v))
            out += find(v, key, p)
    return out
at = find(cfg, "auth-type")
sc = find(cfg, "show-coordinates")
port = find(cfg, "port")
cmp_ = find(cfg, "clone-remote-port")
dbg = find(cfg, "debug-mode") or find(cfg, "debug")
def chk(name, res, expect):
    if not res: print(f"  FAIL {name} 키를 찾지 못함"); sys.exit(1)
    for p, v in res:
        ok = (v == expect)
        print(f"  {'PASS' if ok else 'FAIL'}  {p}={v!r} (기대 {expect!r})")
        if not ok: sys.exit(1)
chk("auth-type", at, "floodgate")
chk("show-coordinates", sc, True)
chk("bedrock port", port, 19132)
chk("clone-remote-port", cmp_, False)
chk("debug-mode", dbg, False)
sys.exit(0)
PY
  else
    no "Geyser config.yml 없음"
  fi

  echo "== 9. gamerule / RCON =="
  if running; then
    local giout rule
    for rule in keep_inventory keepInventory; do
      giout="$(rcon_quiet "gamerule ${rule}" 2>&1 | tr -d '\r' || true)"
      if echo "${giout}" | grep -qiE 'set to: true'; then
        ok "gamerule ${rule} = true (MC 1.21.11 키: ${rule})"
        break
      fi
      [[ "${rule}" == keepInventory ]] && no "gamerule keep_inventory/keepInventory 확인 실패: ${giout:-없음}"
    done
    rcon_quiet "list" >/dev/null 2>&1 && ok "RCON 동작" || no "RCON 동작 실패"
  else
    no "서버 미실행으로 RCON 확인 불가"
  fi

  echo "== 10. 로그 오류 스캔 (최근 500줄) =="
  if running; then
    local errs
    errs="$(docker logs --tail 500 "${CONTAINER}" 2>&1 | grep -E '\[ERROR\]|SEVERE:|Exception' \
      | grep -viE 'DO NOT REPORT|netty|Connection reset|timed out|broken pipe' | tail -10 || true)"
    if [[ -z "${errs}" ]]; then ok "오류 없음"; else no "오류 발견"; printf '%s\n' "${errs}" | sed 's/^/        /'; fi
    local cps
    cps="$(docker logs --tail 500 "${CONTAINER}" 2>&1 | grep -ci 'Can.t keep up' || true)"
    (( cps == 0 )) && ok "Can't keep up 없음" || info "Can't keep up ${cps}회 (CPU 병목 신호)"
  fi

  echo "== 11. 백업 =="
  local newest
  newest="$(ls -1t "${MC_DIR}/backups" 2>/dev/null | head -1)"
  if [[ -n "${newest}" ]]; then
    ok "백업 존재: ${newest}"
    info "용량: $(du -sh "${MC_DIR}/backups" 2>/dev/null | awk '{print $1}')"
  else
    no "백업 파일 없음 (./mc.sh backup 실행)"
  fi

  echo
  if (( fail == 0 )); then
    printf '\033[1;32mALL CHECKS PASSED\033[0m\n'
  else
    printf '\033[1;31m%s CHECK(S) FAILED\033[0m\n' "${fail}"
  fi
  return ${fail}
}

# -----------------------------------------------------------------------------
case "${1:-help}" in
  start)            cmd_start ;;
  stop)             cmd_stop ;;
  restart)          cmd_restart ;;
  status)           cmd_status ;;
  logs)             shift; cmd_logs "$@" ;;
  console|shell)    cmd_console ;;
  backup)           cmd_backup ;;
  update-plugins)   shift; cmd_update_plugins "$@" ;;
  check)            cmd_check ;;
  pregen-overworld) cmd_pregen world square 5000 ;;
  pregen-nether)    cmd_pregen world_nether square 2000 ;;
  pregen-end)       cmd_pregen world_the_end square 2000 ;;
  pregen-status)    cmd_pregen_status ;;
  pregen-pause)     cmd_pregen_pause ;;
  pregen-cancel)    cmd_pregen_cancel ;;
  pregen-continue)  cmd_pregen_continue ;;
  players)          cmd_players ;;
  tps)              cmd_tps ;;
  mspt)             cmd_mspt ;;
  help|-h|--help)   usage ;;
  *)                err "알 수 없는 명령: $1"; usage; exit 2 ;;
esac
