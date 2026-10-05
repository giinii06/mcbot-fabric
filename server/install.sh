#!/usr/bin/env bash
# =============================================================================
# install.sh - idempotent installer / updater for the Minecraft cross-play server
#
#   ./install.sh            설정 (재설정) + 서버 기동
#   ./install.sh --no-start 설정만 수행 (서버 기동 생략)
#
# 이 디렉터리(server/)만 다른 호스트에 복사해도 그대로 기동됩니다.
# 전체 스택(봇+서버) 이전은 리포 루트 README.md의 "새 호스트로 통째로 옮기기" 절 참조.
#
# 절대 하지 않는 것: 월드/플러그인/Floodgate key/ops/whitelist 삭제,
#                    server.properties 전체 초기화, 기존 컨테이너·포트 회수
# =============================================================================
set -Eeuo pipefail

MC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "${MC_DIR}"

COMPOSE_FILE="${MC_DIR}/compose.yaml"
ENV_FILE="${MC_DIR}/.env"
ENV_EXAMPLE="${MC_DIR}/.env.example"
SECRET_DIR="${MC_DIR}/secrets"
RCON_SECRET="${SECRET_DIR}/rcon_password"
DATA_DIR="${MC_DIR}/data"
BACKUP_DIR="${MC_DIR}/backups"

START=true
for arg in "$@"; do
  case "$arg" in
    --no-start) START=false ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install] WARN:\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[install] ERROR:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# .env 기본 템플릿 (기존 .env 를 덮어쓰지 않음)
# NOTE: 이 함수와 .env.example 은 같은 값을 유지해야 합니다.
default_env() {
  cat <<'ENV'
# =============================================================================
# Minecraft cross-play server environment  (managed by install.sh)
# NO SECRETS ARE STORED IN THIS FILE. RCON password lives in ./secrets/rcon_password
# First install: cp .env.example .env  (install.sh가 없으면 자동 생성)
# =============================================================================

# --- Server (pinned, never "latest") -----------------------------------------
MC_VERSION=1.21.11
LEAF_BUILD=179
LEAF_JAR_URL=https://api.leafmc.one/v2/projects/leaf/versions/1.21.11/builds/179/downloads/leaf-1.21.11-179.jar
LEAF_SHA256=5da79782215c1a25edcd7c73b3523b7ecb7f4b86dc8a5846a176ed69bc2cd020

# --- Plugins (official APIs only, pinned; refresh with ./mc.sh update-plugins) -
GEYSER_URL=https://download.geysermc.org/v2/projects/geyser/versions/2.11.3/builds/1247/downloads/spigot
GEYSER_SHA256=6fed2d9711e2db3c365508ec10db36d06a0199abd226159d23d57f82662fd7a6
FLOODGATE_URL=https://download.geysermc.org/v2/projects/floodgate/versions/2.2.5/builds/141/downloads/spigot
FLOODGATE_SHA256=21570aff9ce17d6983928e8552777760e1ede5050026b04c686b0ae112e6fd7e
VIAVERSION_URL=https://hangarcdn.papermc.io/plugins/ViaVersion/ViaVersion/versions/5.12.0/PAPER/ViaVersion-5.12.0.jar
VIAVERSION_SHA256=c4d512fa9760fa41d17abaedde12aa1f4c9bde920d0a992fe0fc016962f126be
CHUNKY_URL=https://hangarcdn.papermc.io/plugins/pop4959/Chunky/versions/1.4.40/PAPER/Chunky-Bukkit-1.4.40.jar
CHUNKY_SHA256=2a5477fc80f71012e15ade1ce34dbeb836e17623b28db112492c0f1443c09721

# --- JVM (heap) ---------------------------------------------------------------
# 2 OCPU급 소형 서버 기준: Xms 1G / Xmx 4G (Aikar/MeowIce 플래그 미사용).
# 메모리가 넉넉해도 CPU가 병목이므로 Xmx를 무작정 올리지 마세요.
JVM_INIT_MEMORY=1G
JVM_MAX_MEMORY=4G

# --- Host user mapping ---------------------------------------------------------
# ./data 파일 소유권을 호스트 유저와 맞추기 위한 값. 첫 설치 시 install.sh가
# 현재 유저의 id -u / id -g 로 자동 채웁니다. 수동 설정 예: MC_UID=1000
MC_UID=1001
MC_GID=1001

# --- Timezone -----------------------------------------------------------------
TZ=Asia/Seoul

# --- Ports --------------------------------------------------------------------
JAVA_PORT=25565
BEDROCK_PORT=19132

# --- Backup -------------------------------------------------------------------
BACKUP_INTERVAL=6h
BACKUP_RETENTION_DAYS=7
BACKUP_COMPRESS_ARGS="-3 -T1"
BACKUP_EXCLUDES="*.jar,cache,.cache,logs,*.tmp,versions,libraries,*.rcon-cli.yaml,*.rcon-cli.env"
ENV
}

# -----------------------------------------------------------------------------
log "1/10 환경 점검"
ARCH="$(uname -m)"
echo "  uname -m      : ${ARCH}"
echo "  CPU           : $(lscpu 2>/dev/null | awk -F: '/Model name/{gsub(/^ +/,"",$2);print $2;exit}') / $(nproc) cores"
echo "  memory        : $(free -h | awk '/^Mem:/{print $2" total, "$7" available"}')"
echo "  disk (/)      : $(df -h / | awk 'NR==2{print $4" free"}')"
echo "  docker        : $(docker --version 2>/dev/null || echo 'NOT FOUND')"
echo "  docker compose: $(docker compose version 2>/dev/null || echo 'NOT FOUND')"

case "${ARCH}" in
  aarch64|arm64|x86_64|amd64) log "아키텍처 ${ARCH} (지원)" ;;
  *) die "지원하지 않는 아키텍처입니다 (${ARCH}). aarch64/arm64/x86_64 필요." ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker가 없습니다. Ubuntu 공식 설치 스크립트를 실행합니다."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$(id -un)" || true
  die "Docker 설치 완료. 로그아웃/재로그인 후 다시 실행하세요."
fi
docker compose version >/dev/null 2>&1 || die "docker compose 플러그인이 없습니다."

echo "  실행 중 컨테이너:"
docker ps --format '    - {{.Names}} ({{.Image}}) {{.Status}}' || true

tcp_use="$(ss -ltn 2>/dev/null | awk '$4 ~ /:25565$/ {print $4" "$5}')"
udp_use="$(ss -lun 2>/dev/null | awk '$4 ~ /:19132$/ {print $4" "$5}')"
if [[ -n "${tcp_use}" ]]; then
  warn "TCP 25565 사용 중: ${tcp_use}"
  if ! docker ps --format '{{.Names}}' | grep -qx 'minecraft'; then
    die "다른 프로세스가 25565/tcp 를 사용 중입니다. 기존 프로세스를 죽이지 않습니다."
  fi
fi
if [[ -n "${udp_use}" ]]; then
  warn "UDP 19132 사용 중: ${udp_use}"
  if ! docker ps --format '{{.Names}}' | grep -qx 'minecraft'; then
    die "다른 프로세스가 19132/udp 를 사용 중입니다. 기존 프로세스를 죽이지 않습니다."
  fi
fi
[[ -z "${tcp_use}" && -z "${udp_use}" ]] && log "포트 25565/tcp, 19132/udp 사용 가능"

# -----------------------------------------------------------------------------
log "2/10 전용 네트워크 (mc-discord, 봇↔플러그인)"
if docker network inspect mc-discord >/dev/null 2>&1; then
  log "mc-discord 존재 (재사용)"
else
  docker network create mc-discord >/dev/null
  log "mc-discord 생성"
fi

# -----------------------------------------------------------------------------
log "3/10 디렉터리 준비"
mkdir -p "${DATA_DIR}" "${BACKUP_DIR}" "${SECRET_DIR}"
chmod 700 "${SECRET_DIR}"

if [[ -f "${DATA_DIR}/server.properties" || -d "${DATA_DIR}/world" ]]; then
  log "기존 데이터 감지 -> 보존 모드 (월드/플러그인/설정을 덮어쓰지 않음)"
  echo "    ./data 항목 수: $(find "${DATA_DIR}" -mindepth 1 -maxdepth 1 | wc -l)"
fi

# -----------------------------------------------------------------------------
log "4/10 RCON 비밀번호 (compose 에는 평문 없음)"
if [[ -f "${RCON_SECRET}" ]]; then
  log "기존 secrets/rcon_password 유지"
else
  ( umask 077; openssl rand -hex 24 > "${RCON_SECRET}" )
  log "신규 RCON 비밀번호 생성"
fi
chmod 600 "${RCON_SECRET}"
echo "    권한: $(stat -c '%a %U:%G' "${RCON_SECRET}")"

# -----------------------------------------------------------------------------
log "5/10 .env 준비 (기존 값은 유지, 누락 키만 채움)"
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    cp -a "${ENV_EXAMPLE}" "${ENV_FILE}"
    log ".env.example 으로부터 .env 생성"
  else
    default_env > "${ENV_FILE}"
    log "신규 .env 생성"
  fi
  # 첫 생성 시 호스트 유저에 맞춤 (기존 .env는 절대 손대지 않음)
  if command -v id >/dev/null 2>&1; then
    sed -i -E "s/^MC_UID=.*/MC_UID=$(id -u)/; s/^MC_GID=.*/MC_GID=$(id -g)/" "${ENV_FILE}"
    log "MC_UID/MC_GID 를 현재 유저($(id -u)/$(id -g))로 설정"
  fi
else
  while IFS= read -r line; do
    key="${line%%=*}"
    [[ -z "${key}" || "${key}" == \#* ]] && continue
    grep -qE "^${key}=" "${ENV_FILE}" || { printf '%s\n' "${line}" >> "${ENV_FILE}"; warn "누락 키 ${key} 추가"; }
  done < <(default_env)
fi
chmod 600 "${ENV_FILE}"

log "6/10 compose.yaml / mc.sh 검증"
[[ -f "${COMPOSE_FILE}" ]] || die "compose.yaml 이 없습니다 (같은 폴더에 있어야 합니다)"
[[ -x "${MC_DIR}/mc.sh" ]] || warn "mc.sh 가 없거나 실행 권한이 없습니다 (chmod +x mc.sh)"
[[ -f "${MC_DIR}/.gitignore" ]] || warn ".gitignore 이 없습니다 (data/ backups/ secrets/ .env 유출 주의)"

docker compose --project-directory "${MC_DIR}" -f "${COMPOSE_FILE}" config -q \
  || die "compose.yaml 문법 검증 실패"

# -----------------------------------------------------------------------------
log "7/10 Leaf 1.21.11 Build #179 준비"
leaf_url="$(grep -E '^LEAF_JAR_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
leaf_sha="$(grep -E '^LEAF_SHA256=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
[[ "${leaf_url}" == *"/1.21.11/builds/179/"* ]] || warn "LEAF_JAR_URL 이 1.21.11 build179 가 아닙니다: ${leaf_url}"
jar_name="$(basename "${leaf_url}")"
if [[ -f "${DATA_DIR}/${jar_name}" ]]; then
  got="$(sha256sum "${DATA_DIR}/${jar_name}" | awk '{print $1}')"
  if [[ -n "${leaf_sha}" && "${got}" != "${leaf_sha}" ]]; then
    warn "기존 Leaf JAR sha256 불일치 -> 재다운로드용 삭제"
    rm -f "${DATA_DIR}/${jar_name}"
  else
    log "Leaf #179 JAR 준비됨 (${jar_name})"
  fi
fi

log "8/10 이미지 확인"
docker compose --project-directory "${MC_DIR}" -f "${COMPOSE_FILE}" pull --quiet \
  || docker compose --project-directory "${MC_DIR}" -f "${COMPOSE_FILE}" pull

# -----------------------------------------------------------------------------
log "9/10 방화벽 (활성 상태일 때만 규칙 추가)"
if command -v ufw >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null && sudo ufw status 2>/dev/null | grep -q "^Status: active"; then
    sudo ufw allow 25565/tcp comment 'minecraft java' || true
    sudo ufw allow 19132/udp comment 'minecraft bedrock' || true
    log "UFW 규칙 추가됨"
  else
    log "UFW 비활성 (또는 sudo 불가) -> Minecraft 때문에 활성화하지 않음"
    log "클라우드 방화벽(OCI Security List/NSG, AWS SG 등)에서 TCP 25565 + UDP 19132 ingress를 직접 여세요"
  fi
else
  log "ufw 미설치 -> 비활성 간주, 활성화하지 않음"
  log "클라우드 방화벽에서 TCP 25565 + UDP 19132 ingress를 직접 여세요"
fi

# -----------------------------------------------------------------------------
if [[ "${START}" != true ]]; then
  log "10/10 --no-start 지정 -> 기동 생략"
  exit 0
fi

log "10/10 서버 기동"
BOOT_T0="$(date +%s)"
PREV_START="$(docker inspect -f '{{.State.StartedAt}}' minecraft 2>/dev/null || echo none)"
docker compose --project-directory "${MC_DIR}" -f "${COMPOSE_FILE}" up -d
NEW_START="$(docker inspect -f '{{.State.StartedAt}}' minecraft 2>/dev/null || echo none)"

if [[ "${PREV_START}" == "${NEW_START}" && "${PREV_START}" != "none" ]]; then
  log "이미 실행 중이고 재시작이 없음 -> 부팅 대기 생략 (멱등 재실행)"
  docker ps --filter name=minecraft --format "    {{.Names}} {{.Status}}"
  cat <<EOF2

---------------------------------------------------------------------------
설치 경로 : ${MC_DIR}
검증     : ./mc.sh check
---------------------------------------------------------------------------
EOF2
  exit 0
fi

log "첫 부팅 대기 (Leaf JAR 다운로드/월드 생성 소요 가능)"
deadline=$(( BOOT_T0 + 900 ))
ready=false
while (( $(date +%s) < deadline )); do
  state="$(docker inspect -f '{{.State.Status}}' minecraft 2>/dev/null || echo missing)"
  if [[ "${state}" != "running" ]]; then
    err "컨테이너가 ${state} 상태입니다. 로그:"
    docker logs --tail 60 minecraft 2>&1 || true
    exit 1
  fi
  if docker logs --since "${BOOT_T0}" minecraft 2>&1 > /tmp/.mc_boot.log || true; [[ -s /tmp/.mc_boot.log ]] && grep -qE 'Done \([0-9.]+s\)!' /tmp/.mc_boot.log; then
    ready=true
    break
  fi
  printf '.'
  sleep 5
done
echo

if [[ "${ready}" == true ]]; then
  log "서버 부팅 완료"
  docker logs minecraft 2>&1 | grep -E 'Leaf|Done \(|Geyser|Floodgate|ViaVersion|Chunky' | tail -n 20 || true
else
  warn "900초 내 완료 신호 미수신. ./mc.sh logs 로 확인하세요"
fi

cat <<EOF

---------------------------------------------------------------------------
설치 경로 : ${MC_DIR}
검증     : ./mc.sh check
방화벽   : 클라우드 콘솔에서 TCP 25565 ingress + UDP 19132 ingress 추가 필요
           (UFW가 active일 때만 install.sh가 자동 추가, 비활성이면 건드리지 않음)
브릿지   : Discord 봇 연동은 리포 루트 README "봇+서버 함께 올리기" 참조
           (plugins/MinecraftBridge/config.yml 시크릿 일치 + mc-discord 네트워크)
---------------------------------------------------------------------------
EOF
