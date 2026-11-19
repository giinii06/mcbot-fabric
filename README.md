# mcbot — Fabric + Cobblemon 서버와 Discord 연동

Java Edition 전용 Minecraft 서버와 Discord 봇입니다. 서버는 **Fabric 1.21.1 + Cobblemon
1.8.4**로 고정되어 있고, 봇은 Bun/TypeScript + SQLite로 동작합니다. 기존 Bukkit/Paper
`MinecraftBridge` 플러그인은 같은 HTTP 계약을 유지하는 Fabric 모드로 이식되었습니다.

- 서버 호스팅: `server/` (Docker Compose)
- 브릿지 모드: `minecraft-bridge/` (Fabric, Java 21)
- Discord 봇: 리포 루트 (Bun)
- Bedrock/Geyser/Floodgate: **지원 종료**. 기존 DB 기록은 보존되며 Discord 명령은 안내만 반환합니다.

## 1. 현재 구성

| 항목 | 값 |
|---|---|
| Minecraft | `1.21.1` (Fabric) |
| Fabric Loader / Installer | `0.20.1` / `1.1.2` |
| Cobblemon | `1.8.4+1.21.1` (Modrinth `PdOzYHKU`) |
| Fabric API | `0.116.18+1.21.1` (Modrinth `5SwzqWUu`) |
| Java | 21 |
| 서버 이미지 | `itzg/minecraft-server:2026.11.0-java21` (digest 고정) |
| 백업 이미지 | `itzg/mc-backup:2026.11.0` (digest 고정) |
| 메모리 | JVM Xms 2G / Xmx 6G, 게임 컨테이너 8G |
| CPU | 게임 2.0, 백업 0.25 (낮은 shares) |
| 게임 규칙 | `keepInventory=true` (세 차원), difficulty 기본 `easy` |
| 공개 포트 | **TCP 25565만** |
| 비공개 | RCON 25575, 브릿지 8765, Bedrock 19132 |

모드 버전·URL·SHA256·SHA512는 [`server/mods.lock.json`](server/mods.lock.json)에 고정되어
있습니다. `latest` 태그, 자동 업데이트, Modrinth 자동 설치 기능은 사용하지 않습니다.

### Paper에서 바뀐 점

- 서버 타입: Paper 26.3 / Java 25 → Fabric 1.21.1 / Java 21
- 데이터 디렉터리: `server/data/` → **`server/data-cobblemon/`** (기존 `server/data/`는
  읽지도 수정하지도 않음)
- 플러그인 → 모드: `MinecraftBridge`를 Fabric 모드로 이식
- Bedrock: Geyser·Floodgate·19132 포트 제거, Discord 등록 명령 비활성화
- 백업: `server/backups-cobblemon/`, zstd, 24시간 주기, 7일 보존, RCON save 동기화
- `keepInventory`: 시작 시 RCON으로 세 차원에 적용

Paper 26.3 월드는 1.21.1 서버에서 열 수 없습니다. 자동 변환·다운그레이드는 지원하지
않으며, 기존 월드는 그대로 보존하고 새 Cobblemon 월드를 `data-cobblemon/`에 만듭니다.
자세한 내용은 [MIGRATION_FROM_PAPER.md](docs/MIGRATION_FROM_PAPER.md)를 보세요.

## 2. 구조와 통신

```
Discord ── slash command / 로그 채널
   │
   ▼
mcbot (Bun, :47865)  ── POST /ops ───────────────▶  minecraft (Fabric, :8765)
   │                  ◀─ POST /bridge/events ────     MinecraftBridge 모드
   └─ SQLite: data/mcbot.sqlite                       └─ 월드/모드 데이터: data-cobblemon/
```

- 두 컨테이너는 외부 Docker 네트워크 `mc-discord`로만 통신합니다.
- 브릿지 API는 기존과 동일합니다.
  - `GET /health`
  - `POST /ops` (Bearer 또는 `X-Bridge-Secret`)
  - `POST /bridge/events` (봇이 수신)
- Ops: `whitelistAddJava`, `whitelistRemoveJava`, `getWhitelist`, `getPlaytime`,
  `getOnlinePlayers`, `getStatus`. 임의 명령 실행 API는 없습니다.
- 이벤트: `player.join`, `player.quit`, `player.chat`, `player.death`,
  `player.advancement`, `server.status`.
- 게임 상태 변경은 서버 스레드에서 실행되고 4초 타임아웃이 적용됩니다.
- 화이트리스트는 서버의 공식 `Whitelist` API로 추가/제거한 뒤 `save()`합니다.
  외부에서 `whitelist.json`을 덮어쓰지 않습니다.

## 3. 요구사항

호스트: Ubuntu ARM64, Docker Engine + Compose, `jq`, `unzip`, `curl`, `openssl`,
`tar`, `zstd`. 브릿지를 호스트에서 빌드하려면 JDK 21과 Gradle wrapper(리포 포함)가
필요합니다. 봇 빌드에는 Bun 1.3+가 필요합니다.

OCI에서는 NSG/Security List ingress를 **TCP 25565**만 열고 SSH 규칙을 유지하세요.
25575, 8765, 19132는 열지 않습니다.

### 게임 클라이언트 (접속하는 사람)

#### Windows와 macOS에서 설치하기

1. 공식 Minecraft Launcher에서 Java Edition에 로그인한 뒤 런처를 닫으세요.
2. [GitHub Releases](https://github.com/giinii06/mcbot-fabric/releases)에서 운영체제에 맞는 설치기를 받으세요.
   - **Windows x64**에서는 `MCBot-Cobblemon-Setup.exe`를 실행하세요.
   - **macOS 11 이상**에서는 `MCBot-Cobblemon-Setup-macOS.zip`을 풀고 `Cobblemon Setup.app`을 더블클릭하세요. Apple Silicon과 Intel을 모두 지원합니다.
3. 런처를 다시 열고 **Java Edition → 설치 설정 → Cobblemon Server**에서 실행하세요.
4. 게임의 **멀티플레이**에서 저장된 **Cobblemon Server**에 접속하세요.

설치기는 서버와 같은 Fabric Loader, Fabric API, Cobblemon을 전용 게임 폴더에 설정합니다. 저장소가 비공개이므로 GitHub 다운로드에는 접근 권한이 필요합니다. 서버의 화이트리스트는 그대로 적용됩니다.

macOS 앱은 Apple 공증을 받지 않았습니다. macOS가 첫 실행을 막으면 [Apple의 앱 열기 안내](https://support.apple.com/ko-kr/102445)를 참고하세요.

새 설치기를 배포하려면 저장소 변수 `MINECRAFT_SERVER_ADDRESS`에 공개 Java 접속 주소를 `호스트:포트` 형식으로 설정한 뒤 `client-v*` 태그를 푸시하세요. 같은 모드 목록으로 다시 설치하면 기존 서버 목록을 유지합니다.

#### 수동으로 설치하기

Cobblemon은 서버 전용 모드가 **아닙니다**. 들어가는 사람도 같은 버전을 설치해야 합니다.

1. **Minecraft Java Edition 1.21.1** (공식 런처, Microsoft 계정)
2. **Fabric Loader for 1.21.1** — https://fabricmc.net/use/installer/
3. 클라이언트 `.minecraft/mods/`에 서버와 **동일한 버전** 넣기:
   - [Fabric API `0.116.18+1.21.1`](https://modrinth.com/mod/fabric-api/version/0.116.18+1.21.1)
   - [Cobblemon `1.8.4F` (1.21.1 Fabric)](https://modrinth.com/mod/cobblemon/version/1.8.4F)
4. Fabric 1.21.1 프로필로 실행 → 멀티플레이 → `공인IP:25565`

바닐라 1.21.1 클라이언트는 접속은 시도할 수 있어도 파티·PC·포켓몬 모델 등
Cobblemon의 클라이언트 UI/에셋을 사용할 수 없어 지원되지 않습니다. 클라이언트와
서버의 Cobblemon 버전이 다르면 충돌·문제가 발생할 수 있으니 반드시 같은 버전을
사용하세요. 리소스 팩은 선택 사항입니다. Discord 봇/브릿지 모드는 클라이언트에
필요 없습니다.

## 4. 신규 설치

```bash
git clone <repo> mcbot && cd mcbot

# 1) 브릿지 모드 빌드 (JDK 21)
bun run minecraft:build-plugin

# 2) 서버 파일 준비 — 게임은 아직 시작하지 않음
cd server
cp .env.example .env
# .env에서 TZ, MC_UID/GID, DIFFICULTY 등을 확인
./install.sh --no-start

# 3) 봇 환경변수
cd ..
cp .env.example .env
# DISCORD_TOKEN, DISCORD_APPLICATION_ID 입력
# MC_BRIDGE_SECRET은 server/secrets/bridge_secret와 같은 값이어야 함
cat server/secrets/bridge_secret   # 값을 복사해 .env에 넣고 출력/커밋 금지

# 4) 실행
docker compose up -d --build
cd server && ./mc.sh start && ./mc.sh check
```

`install.sh`는 다음을 수행합니다.

1. 호스트·Docker·필수 도구 확인
2. 기존 `data/level.dat`(Paper 월드) 감지 시 중단하고 안내
3. `.env` 생성/보완, RCON·브릿지 시크릿 생성
4. `data-cobblemon/`, `backups-cobblemon/` 생성
5. `mods.lock.json`의 모드와 브릿지 jar 설치·해시 검증
6. 이미지 pull, `mc-discord` 네트워크 생성

기존 Paper 월드가 있어도 새 월드 생성을 명시적으로 허용하려면:

```bash
cd server
./install.sh --new-world --no-start
```

이 경우에도 `server/data/`는 이동·삭제·수정되지 않습니다.

## 5. 설정

### 루트 `.env` (봇)

| 변수 | 설명 |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` | Discord 봇 자격 증명 |
| `MC_BRIDGE_SECRET` | `server/secrets/bridge_secret`와 동일한 공유 시크릿 |
| `MC_BRIDGE_BASE_URL` | 기본 `http://minecraft:8765` |
| `MC_BOT_PORT` | 기본 `47865` |
| `SQLITE_PATH` | 기본 `data/mcbot.sqlite` |

### `server/.env` (게임/백업)

| 변수 | 기본값 |
|---|---|
| `MC_VERSION` | `1.21.1` (고정) |
| `FABRIC_LOADER_VERSION` | `0.20.1` (고정) |
| `FABRIC_INSTALLER_VERSION` | `1.1.2` (고정) |
| `DIFFICULTY` | `easy` |
| `JVM_INIT_MEMORY` / `JVM_MAX_MEMORY` | `2G` / `6G` |
| `MAX_PLAYERS` | `1000` |
| `VIEW_DISTANCE` / `SIMULATION_DISTANCE` | `6` / `4` |
| `BACKUP_INTERVAL` / `BACKUP_RETENTION_DAYS` | `24h` / `7` |

브릿지 설정은 `server/data-cobblemon/config/minecraftbridge.json`에 생성됩니다.
시크릿은 파일(`/run/secrets/bridge_secret`)에서 읽으며 설정 파일에 평문으로 저장하지
않는 것을 권장합니다.

## 6. Discord 명령어

| 명령 | 동작 |
|---|---|
| `/유저등록 <마크아이디>` | Java 계정 조회 → 화이트리스트 추가 → DB 저장 |
| `/유저등록베드락` | 지원 종료 안내만 반환 (DB/브릿지 변경 없음) |
| `/유저해제 [유저]` | 본인/관리자 등록 해제 |
| `/유저강제해제 <유저>` | 관리자 강제 해제 |
| `/유저조회 <유저>` | 등록 정보·플레이타임·접속 상태 |
| `/유저목록` | 등록 계정 목록 (관리자) |
| `/화이트리스트동기-sync` | 서버 화이트리스트와 DB 동기화 (관리자) |
| `/마크리더보드` | 플레이타임 리더보드 |
| `/마크로그설치` | 이벤트 로그 채널 설정 (관리자) |

Bedrock 등록 기록은 삭제하지 않습니다. `/유저해제`로 기존 Bedrock 연결을 데이터에서
정리할 수는 있지만, 새 Bedrock 등록이나 화이트리스트 변경은 이루어지지 않습니다.

## 7. 운영 명령

```bash
cd server

./mc.sh start | stop | restart | status
./mc.sh logs -f
./mc.sh check
./mc.sh players
./mc.sh command <Minecraft command>

./mc.sh install-mods
./mc.sh verify-mods

./mc.sh backup
./mc.sh verify-backup backups-cobblemon/FILE.tar.zst
./mc.sh restore backups-cobblemon/FILE.tar.zst
```

`check`는 다음을 검증합니다: Compose 구문, 컨테이너 health, Java 21, Fabric 프로세스,
server.properties(online-mode/whitelist/enforce/max-players/difficulty/view/simulation),
모드 해시·메타데이터, Bukkit 플러그인 부재, RCON `list`, 1.21.1 기동, `keepInventory`,
difficulty, 브릿지 `/health`, 공개 포트(25575/8765/19132 미게시, 25565 게시),
최신 백업 무결성, 자원 사용량.

## 8. 백업과 복구

- 24시간 간격, 첫 백업은 기동 3분 후, 7일 보존
- zstd 압축, 백업 전 RCON `save-off`/`save-all flush`, 후 `save-on`
- 공간 부족 시 백업 중단
- 전 세계·Cobblemon 플레이어 데이터·config 포함
- 모드 jar는 `mods.lock.json`으로 재설치 가능하므로 제외
- 복구 시 기존 `data-cobblemon/`을 `data-cobblemon.before-restore-<시각>/`으로
  보존한 뒤 새로 추출하고, 이전 모드 jar를 복사

복구 절차와 주의사항은 [RECOVERY.md](docs/RECOVERY.md)를 따르세요.

## 9. 검증 결과 (2026-11-19)

| 항목 | 결과 |
|---|---|
| `bun install --frozen-lockfile` | 통과 |
| `bun run typecheck` | 통과 |
| `bun test` | **167 pass / 0 fail** |
| Gradle `build` (JUnit) | **64 pass / 0 fail** |
| `bash -n` (install/mc/backup 스크립트) | 통과 |
| `docker compose config -q` | 통과 |
| 모드 SHA256·SHA512 검증 | Cobblemon / Fabric API 통과 |
| 실제 Fabric+Cobblemon 기동 | `Done (22.465s)!`, bridge `:8765` listen |
| `keepInventory` | 세 차원 모두 `true` |
| `/health` | `{ok:true, minecraft:true, version:1.1.0}` |
| 무인증 `/ops` | **401** |
| `getStatus` | `online:0, max:1000, whitelistEnabled:true, enforceWhitelist:true` |
| 화이트리스트 add/list/remove | `whitelist.json`에 반영·원상복구 |
| `getPlaytime` (임시 stats 123400틱) | `6170초, source:"file"` |
| Bedrock op | **501** + 명확한 오류 |
| 이벤트 수신 | `server.status` stopped/started, Bearer 인증 통과 |
| 온라인 백업 | zstd 아카이브 생성·무결성 검증 |
| 복구 | 보호 사본 생성 후 복구, 재기동 `check` 통과 |

검증하지 못한 항목:

- 실제 Java 클라이언트 접속, 채팅·사망·도전과제 이벤트의 실사용 수신
- 실제 Discord 게이트웨이/슬래시 명령 실행 (토큰 미설정)
- OCI NSG/공인 IP 외부 접속
- 장시간 부하·동시 접속·GC 정지시간

## 10. 문서

- [서버 운영](server/README.md)
- [OCI 배포](docs/DEPLOY_OCI.md)
- [Paper에서 이전](docs/MIGRATION_FROM_PAPER.md)
- [백업·복구](docs/RECOVERY.md)
- [브릿지 통합](docs/minecraft-integration.md)
- [검증 기록](server/VALIDATION.md)

## 11. 남은 수동 작업

1. Discord 애플리케이션 생성 후 루트 `.env` 입력, `bun run minecraft:commands`로
   전역 명령 등록, `bun run invite`로 봇 초대
2. `server/secrets/bridge_secret`와 루트 `.env`의 `MC_BRIDGE_SECRET` 일치 확인
3. OCI NSG에서 TCP 25565만 허용, SSH 유지
4. 실제 Java 계정으로 접속해 화이트리스트·채팅·도전과제 알림 확인
5. 기존 Paper 월드는 보관만 하고, 필요하면 별도 호스트에서 계속 운영
