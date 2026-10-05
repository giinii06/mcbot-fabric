# mcbot + minecraft-server — Discord 연동 마크 서버 풀스택

Minecraft Java 1.21.11(Leaf) + Bedrock 크로스플레이 게임 서버와,
화이트리스트·플레이타임·로그 채널을 담당하는 Discord 봇을 **한 리포에서 통째로 호스팅**합니다.

다른 호스트에서 그대로 올리는 것이 목표라서, 게임 서버 필수 요소는
`server/`에 모아 두었습니다 (`server/`만 복사해도 서버 단독 기동 가능).
봇 없이 서버만 쓸 수도, 서버 없이 봇 개발만 할 수도 있습니다.

```
Discord (slash command / 로그 채널)
   ▲ │
   │ │  POST /bridge/events, GET /health   (Bearer MC_BRIDGE_SECRET)
mcbot 컨테이너 (bun, 127.0.0.1:47865)
   │ │
   │ └─ POST /ops  (8개 타입만, 동일 시크릿)
   ▼
minecraft 컨테이너 · MinecraftBridge 플러그인 (0.0.0.0:8765, 호스트 미게시)
```

상세 규약·배포·검증 기록은 [`docs/minecraft-integration.md`](docs/minecraft-integration.md),
서버 단독 가이드는 [`server/README.md`](server/README.md)를 보세요.

## 사양 요약

| 항목 | 값 |
|---|---|
| 서버 구현체 | Leaf 1.21.11 Build #179 (Paper 계열 고성능 포크), Java 21 번들 JDK, 기본 G1GC |
| 크로스플레이 | Geyser 2.11.3/b1247 + Floodgate 2.2.5/b141 (`auth-type=floodgate`, Bedrock 계정 없이 입장) |
| 호환·도구 | ViaVersion 5.12.0 (구 클라), Chunky 1.4.40 (사전 생성), Spark (Leaf 번들, 별도 설치 금지) |
| 브릿지 | 자작 `MinecraftBridge` 1.0.0 (`minecraft-bridge/`, Paper 이벤트만 사용, RCON·로그 tail 없음) |
| 포트 | TCP 25565 (Java), UDP 19132 (Bedrock). 봇 `:47865`는 loopback만, 플러그인 `:8765`는 호스트 미게시 |
| JVM·자원 | `-Xms1G -Xmx4G`, 게임 5g·1.75cpu + 백업 1g·0.5cpu (2 OCPU급 소형 서버 기준, CPU가 병목) |
| 백업 | `itzg/mc-backup` 6시간 주기, zstd, 7일 보관 (`server/backups/world_*.tar.zst`) |
| 화이트리스트 | `ENABLE_WHITELIST=true` 고정, 봇이 DB↔파일 동기화 (`WHITELIST` 환경변수 미사용) |

## 디렉터리

```
.
├── compose.yaml            봇(mcbot) 배포 — 외부 네트워크 mc-discord 공유
├── Dockerfile              봇 이미지 (oven/bun:1.3.14-slim)
├── .env.example            봇 설정 템플릿 (시크릿 없음, 복사 후 .env 작성)
├── src/                    봇 소스 (env, db, bridge, minecraft 도메인, discord, commands)
├── test/                   bun 테스트
├── minecraft-bridge/       Paper 플러그인 소스 (Gradle, JUnit)
│   ├── build.sh / test.sh  플러그인 빌드·테스트 진입점
│   ├── libs/paper-api.jar  빌드용 API (커밋됨, 컴파일 전용)
│   └── src/...             BridgeHttpServer, Ops(8종), 이벤트 리스너, 통계, 화이트리스트
├── server/                 게임 서버 필수 요소 (단독 호스팅 가능)
│   ├── compose.yaml        minecraft + minecraft-backup (잇그 이미지)
│   ├── .env.example        서버 버전·URL·자원 템플릿 (시크릿 없음)
│   ├── install.sh          설치/재설정 (멱등, 월드·설정 보존)
│   ├── mc.sh               실행·관리·검증 스크립트
│   ├── README.md           서버 단독 가이드
│   ├── .gitignore          data/ backups/ secrets/ .env 제외
│   ├── data/               (실행 후 생성, git 제외) 월드·server.properties·플러그인
│   ├── backups/            (실행 후 생성, git 제외)
│   └── secrets/            (실행 후 생성, git 제외) rcon_password (600)
├── docs/
│   └── minecraft-integration.md  브릿지 규약·배포·검증 기록 (상세)
└── data/                   (실행 후 생성, git 제외) 봇 SQLite (data/mcbot.sqlite)
```

git에 들어가지 않는 것: 양쪽 `.env`, `server/secrets/`·`server/data/`·`server/backups/`·`data/`,
`*.pem`/`key.pem`, `.mc_bridge_secret`, 빌드 산출물(`*.jar`, `build/`).
`server/.env.example`·루트 `.env.example`은 커밋되지만 시크릿을 절대 넣지 마세요.

## 요구사항

| 항목 | 값 |
|---|---|
| OS/아키텍처 | Ubuntu 22.04+ , `aarch64`/`arm64`/`x86_64` (서버 JAR는 Java라 아키 무관, 봇·플러그인도 무관) |
| CPU/RAM | 최소 2 vCPU / 4 GB 권장. 게임+백업+봇 합계 상한 약 6.4 GB·2.75 cpu |
| 디스크 | 여유 3 GB+ (`server/mc.sh check`가 2 GB 미만이면 FAIL) |
| Docker | Engine 24+ + compose v2 |
| 포트·방화벽 | TCP 25565 + UDP 19132 ingress를 클라우드 콘솔(OCI Security List/NSG, AWS SG 등)에서 직접 개방. UFW가 active일 때만 `install.sh`가 자동 추가, 비활성이면 건드리지 않음 |
| Discord | 신규 어플리케이션 1개 (기존 봇 토큰 재사용 금지). 봇 초대·명령 등록은 사람 손으로 1회 |
| 로컬 개발 | Bun 1.3+ (`bun install`, `bun test`, `tsc --noEmit`), 플러그인 빌드는 JDK 21 + Gradle wrapper 포함 |

## 빠른 시작 — 새 호스트에 풀스택 올리기

```bash
# 0) 리포 복제 + Bun 의존성 (봇 개발·명령 등록용)
git clone <this-repo> mcbot && cd mcbot
bun install

# 1) 게임 서버 — 첫 부팅은 Leaf 다운로드+월드 생성으로 수 분 소요
cd server
cp .env.example .env && chmod 600 .env
# MC_UID/MC_GID 확인: install.sh가 첫 생성 시 id -u/id -g로 자동 설정하지만,
# 직접 복사했다면 수동 확인 (id -u ; id -g)
./install.sh          # mc-discord 생성 + RCON 시크릿 + 이미지 pull + 기동
./mc.sh check         # 반드시 ALL CHECKS PASSED
cd ..

# 2) 브릿지 플러그인 빌드·배포 (서버 기동 후에도 가능, 배포 뒤 서버 재시작)
bun run minecraft:build-plugin
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
# 시크릿 3곳 일치 (어디에도 커밋·로그 금지):
#   ① openssl rand -base64 48  → ② 봇 .env의 MC_BRIDGE_SECRET
#   ③ server/data/plugins/MinecraftBridge/config.yml의 secret (600 권장)
#   (config.yml은 첫 기동 시 기본값 CHANGE_ME로 생성되므로 직접 교체 후 재시작)
cd server && ./mc.sh restart && ./mc.sh check && cd ..

# 3) 봇 설정·기동 (Discord 값 없이도 브릿지만으로 뜸)
cp .env.example .env && chmod 600 .env
# .env에 MC_BRIDGE_SECRET(위와 동일), DISCORD_TOKEN, DISCORD_APPLICATION_ID 입력
docker network inspect mc-discord >/dev/null || docker network create mc-discord
docker compose up -d --build
docker compose logs -f   # 'bridge endpoint listening' + discord ready/disabled 확인

# 4) 슬래시 명령 등록 + 초대 (Discord 어플리케이션 만든 뒤, 사람 손으로 1회)
bun run minecraft:commands              # 전역 등록 — 봇이 들어간 모든 서버에 적용, 반영 최대 1시간
# 당장 한 서버에서만 확인하고 싶으면: bun run minecraft:commands -- <guildId> (즉시 반영,
# 단 그 길드의 전역 명령을 덮어쓰므로 명령을 바꾸면 다시 실행)
bun run invite                          # 서버 수만큼 반복 (권한: 채널보기+메시지쓰기+임베드)

# 5) 종단 검증
curl -s http://127.0.0.1:47865/health              # {"ok":true,"minecraft":true} 기대
bun test                 # 봇 단위/통합 테스트
bun run typecheck        # tsc --noEmit
bun run minecraft:test   # 플러그인 JUnit
cd server && ./mc.sh check
```

Discord 값이 비어 있으면 봇은 브릿지 엔드포인트만 열고 `discord disabled` 경고를 남깁니다.
값 채운 뒤 `docker compose up -d` 재시작하면 그때 연결됩니다.

## 서버만 올리기 / 봇만 올리기

서버만 (이 리포의 `server/`째로 복사해도 동일):

```bash
cd server
cp .env.example .env && chmod 600 .env
./install.sh && ./mc.sh check
```

상세 운용 (사전 생성·복원·플러그인 업데이트· gamerule 주의·포트표)은
[`server/README.md`](server/README.md)를 보세요. 단독 운용이면 화이트리스트를
콘솔 명령(`whitelist add <name>`)으로 수동 관리하면 됩니다 — `WHITELIST` 환경변수는 건드리지 마세요.

봇만 (게임 서버 없이 개발·테스트):

```bash
bun install
cp .env.example .env   # MC_BRIDGE_SECRET만 채우면 됨 (16자 이상)
bun run dev            # --watch 실행, Discord 없이 브릿지만 뜸 (DISCORD_DISABLED=1도 가능)
bun test
```

`MC_BRIDGE_BASE_URL` 기본값 `http://minecraft:8765`는 compose 네트워크 기준이라서,
호스트에서 직접 봇만 돌리며 실서버에 붙일 때는 `http://<서버호스트>:8765`로 바꾸세요
(플러그인 포트는 호스트 미게시라 포트포워딩이 따로 필요합니다).

## 설정

### 봇 `.env` (루트, `chmod 600 .env`)

| 키 | 필수 | 예시 | 설명 |
|---|---|---|---|
| `DISCORD_TOKEN` | △ (없으면 브릿지만) | (Discord 개발자 포털) | 신규 어플리케이션 토큰. 기존 봇과 공유 금지 |
| `DISCORD_APPLICATION_ID` | △ | `1555…` (snowflake) | 어플리케이션 ID. 명령 등록·초대 URL에 사용 |
| `MC_BRIDGE_SECRET` | ○ (16자+) | `openssl rand -base64 48` | 봇↔플러그인 공유 시크릿. 플러그인 `config.yml`의 `secret`과 동일해야 함 |
| `MC_BRIDGE_BASE_URL` | ○ | `http://minecraft:8765` | 봇→플러그인 (`/ops`). compose 네트워크 기준 |
| `MC_BOT_PORT` | ○ | `47865` | 플러그인→봇 (`/bridge/events`). compose는 `127.0.0.1:47865`만 게시 |
| `SQLITE_PATH` | ○ | `data/mcbot.sqlite` | 등록 DB·로그 채널 저장 |
| `LOG_LEVEL` | ○ | `info` | `debug/info/warn/error` |
| `DISCORD_DISABLED` | – | `1` | 테스트·오프라인 검증용 게이트웨이 스킵 |
| `MCBOT_UID`/`MCBOT_GID` | – | `id -u`/`id -g` | compose `user:` 매핑 (미설정 시 1001:1001). `./data` 소유권 유지용 |

`KEY=` 빈 값은 "미설정" 취급이라 Discord 없이 뜨는 것이 정상입니다.

### 서버 `server/.env` (복사 후 작성, `chmod 600`, 시크릿 없음)

버전·URL·자원만 들어 있고 RCON 비밀번호는 `server/secrets/rcon_password`(600)에만 있습니다.
전체 항목표는 [`server/README.md`](server/README.md) 3절 + `server/.env.example` 주석 참조.
핵심만:

| 키 | 값 (고정) | 설명 |
|---|---|---|
| `MC_VERSION`/`LEAF_BUILD` | `1.21.11`/`179` | 세트로 고정, 임의 변경 금지 |
| `LEAF_JAR_URL`/`LEAF_SHA256` | (고정) | `install.sh`·`mc.sh check`가 sha256 검증 |
| `GEYSER_*`/`FLOODGATE_*`/`VIAVERSION_*`/`CHUNKY_*` | (고정) | 공식 API 기준 핀. 올릴 땐 `./mc.sh update-plugins --dry-run`부터 |
| `JVM_INIT_MEMORY`/`JVM_MAX_MEMORY` | `1G`/`4G` | `-Xms1G -Xmx4G`, 추가 GC 플래그 없음 |
| `MC_UID`/`MC_GID` | `id -u`/`id -g` | 첫 생성 시 자동 설정 |
| `JAVA_PORT`/`BEDROCK_PORT` | `25565`/`19132` | TCP/UDP 구분, 방화벽 규칙과 세트 |
| `BACKUP_*` | `6h`·`7일`·`zstd` | 정기 백업 주기·보관·제외 목록 |

### 시크릿 3곳 (반드시 같은 값, 절대 커밋 금지)

1. 봇 `.env`의 `MC_BRIDGE_SECRET`
2. `server/data/plugins/MinecraftBridge/config.yml`의 `secret` (`bot.base-url: http://mcbot:47865`와 함께, 600 권장)
3. (호스트 보관용) `.mc_bridge_secret` — 있으면 재사용, 없으면 `openssl rand -base64 48`로 신규 생성

RCON 비밀번호는 `server/secrets/rcon_password`(600) 단일 보관, compose·`.env` 평문 금지
(`mc.sh check`가 평문을 FAIL 처리합니다).

## 플러그인 빌드·배포·테스트

```bash
bun run minecraft:build-plugin   # bash minecraft-bridge/build.sh (gradlew clean jar)
bun run minecraft:test           # bash minecraft-bridge/test.sh (JUnit)
```

빌드 산출물 `minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar`를
`server/data/plugins/`에 복사한 뒤 `server/mc.sh restart`.
`plugin.yml` (`name: MinecraftBridge`, `api-version: 1.21`, `softdepend: [Floodgate, Geyser-Spigot, ViaVersion]`)
기준으로 로드되며, 로그에 아래가 찍히면 정상:

```
MinecraftBridge listening on 0.0.0.0:8765 -> http://mcbot:47865
playtime api self-check: ok
```

브릿지는 Paper 이벤트만 사용합니다. `latest.log` tail·Docker 로그·RCON 주기 실행 없음 (RCON은 백업 전용).

## 명령어

| 명령 | 권한 | 설명 |
|---|---|---|
| `/유저등록 마크아이디:` | 모든 멤버 | Java/Bedrock 계정 연결 (화이트리스트 추가 → DB 저장, 실패 시 롤백) |
| `/유저해제` | 모든 멤버 | 본인 연결 해제 (DB 삭제 → 화이트리스트 제거, 실패 시 복구) |
| `/마크리더보드` | 모든 멤버 | 누적 플레이타임 TOP (시간 → 이름 → UUID 정렬) |
| `/마크로그설치` | 관리자 | 현재 채널을 로그 채널로 지정 |
| `/유저조회 유저:` | 관리자 | 등록 정보 조회 (생략 시 본인) |
| `/유저목록` | 관리자 | 전체 등록 목록 |
| `/유저강제해제 유저:` | 관리자 | 다른 사용자 연결 해제 |
| `/화이트리스트동기-sync` | 관리자 | DB ↔ 화이트리스트 재동기화 |

## 일일 운용

```bash
# 봇
docker compose ps && docker compose logs -f        # 루트에서
curl -s http://127.0.0.1:47865/health

# 서버
cd server
./mc.sh status | ./mc.sh logs 150 | ./mc.sh players | ./mc.sh tps | ./mc.sh mspt
./mc.sh backup                                     # 즉시 백업
./mc.sh update-plugins --dry-run                   # 플러그인 호환 먼저 확인
./mc.sh update-plugins                             # 백업→.env 갱신→재시작→로드 확인
./mc.sh pregen-overworld | ./mc.sh pregen-status   # 사전 생성 (선택)
./mc.sh check                                      # 배포·복원·이전 후 필수
```

정기 백업은 `minecraft-backup` 컨테이너가 6시간 주기로 수행, 7일 초과분 자동 삭제.
서버 콘솔은 `./mc.sh console` (TTY 필요, 종료는 Ctrl-P Ctrl-Q, Ctrl-C 금지).

## 백업·복원·이사 (새 호스트로 통째로 옮기기)

백업 파일은 `/data` 기준 상대경로 tar (`world_*.tar.zst`, jar·캐시·로그 제외).
Floodgate/Geyser `key.pem`이 포함되어 Bedrock 매핑이 유지됩니다.

```bash
# 구 호스트: 최신 백업 1개 확보
cd server && ./mc.sh backup && ls -lt backups | head
# 백업 tar 1개를 신 호스트 server/backups/로 복사 (scp/rsync, 시크릿 아님이라 일반 전송 가능)
# 월드가 크면 data/world* 통째로 rsync해도 되지만, 공식 경로는 백업 tar 경유

# 신 호스트: 리포 복제 → 서버 골격 생성 → 백업 덮어쓰기 → 기동
git clone <this-repo> mcbot && cd mcbot/server
./install.sh --no-start
tar --use-compress-program=unzstd -xf backups/world-YYYYMMDD-HHMMSS.tar.zst -C data
./install.sh && ./mc.sh check

# 봇 DB도 옮기면 등록 정보 유지 (없으면 화이트리스트 재동기화로 재생성)
# 구 호스트 data/mcbot.sqlite → 신 호스트 data/mcbot.sqlite 복사 후
docker compose up -d --build
# Discord 관리자: /화이트리스트동기-sync 1회 (DB↔whitelist.json 정합)
```

시크릿 이전 (`MC_BRIDGE_SECRET`, `DISCORD_TOKEN`, `server/secrets/rcon_password`)은
암호화 채널(1Password·age·sops 등)로만 옮기고, 어떤 경우에도 git·로그·채팅 평문에 올리지 마세요.
신 호스트 `id -u/id -g`가 다르면 `server/.env`의 `MC_UID/MC_GID`와 루트 `.env`의
`MCBOT_UID/MCBOT_GID`를 갱신한 뒤 재기동 (`./data` 소유권 유지용).

## 검증

```bash
bun test                 # 봇 단위/통합 테스트
bun run typecheck        # tsc --noEmit
bun run minecraft:test   # 플러그인 JUnit (BUILD SUCCESSFUL)
cd server && ./mc.sh check   # ALL CHECKS PASSED 필수
```

`mc.sh check`는 JVM 힙·컨테이너 상한·포트 리스닝을 넘어 **양쪽 엔드포인트 실응답**까지 봅니다:
Java status ping (Leaf 1.21.11/protocol 774), Bedrock RakNet Pong (MCPE, port 19132),
Geyser `auth-type=floodgate` 등 11개 섹션. MC 1.21.11 gamerule 키는 snake_case
(`gamerule keep_inventory true`)라서 구형 `keepInventory`로는 FAIL이 정상입니다.

수동 헬스체크:

```bash
curl -s http://127.0.0.1:47865/health
# 봇→플러그인 (401이면 시크릿 불일치, 502+reason이면 Floodgate 검증 실패 등 의도된 거부):
curl -s -H "Authorization: Bearer $MC_BRIDGE_SECRET" http://127.0.0.1:8765/health  # 호스트 게시 안 함이라 컨테이너 경유 필요
docker exec mcbot bun -e "const r=await fetch('http://minecraft:8765/health',{headers:{Authorization:'Bearer '+process.env.MC_BRIDGE_SECRET}});console.log(await r.text())"
```

## 설계 판단 (바꾸기 전 필독)

- **Leaf 고정 + 버전 핀**: `latest`를 쓰지 않고 Leaf #179·플러그인 4종 URL·sha256을 전부 고정.
  올릴 땐 `update-plugins --dry-run`으로 MC 1.21.11 호환 목록부터 확인, sha256+`plugin.yml` 검증 후에만 `.env` 갱신·재시작.
- **JVM·자원 상한**: `-Xms1G -Xmx4G` + 기본 G1GC, Aikar/MeowIce/Shenandoah 플래그 미사용.
  2 OCPU 환경은 RAM이 아니라 CPU가 병목이라 Xmx를 올려도 TPS가 오르지 않습니다.
  게임 1.75cpu·백업 0.5cpu·봇 0.5cpu로 합계 2.75cpu 상한을 두어 서로 굶주리지 않게 했습니다.
- **화이트리스트는 봇 소유**: `ENABLE_WHITELIST=true` + `WHITELIST` 미설정.
  등록은 "화이트리스트 추가→DB 저장(실패 시 롤백)", 해제는 역순으로 원자성 유지.
  첫 등록 직후 `whitelist.json` 이름이 `(unknown)`이어도 UUID 매칭이라 접속에는 지장 없고 첫 접속 시 갱신됩니다.
- **브릿지 최소 권한**: 봇→플러그인 `/ops`는 8타입만 (`whitelistAdd/RemoveJava·Bedrock`, `getWhitelist·Playtime·OnlinePlayers·Status`).
  임의 command는 400, 시크릿 불일치는 401, Floodgate gamertag 검증 실패는 502로 거절합니다.
- **관측은 이벤트 푸시**: 플러그인이 `player.join/quit/death/advancement`·`server.status`를
  `POST /bridge/events`로 푸시 (3분 dedup + 재시도 1회). 로그 tail·RCON 폴링을 하지 않습니다.
- **네트워크 격리**: `mc-discord` 외부 네트워크로만 봇↔플러그인이 통신.
  봇 `:47865`는 loopback 게시, 플러그인 `:8765`는 호스트 미게시.
- **플러그인에 Discord 토큰 없음**: 인증은 `MC_BRIDGE_SECRET` 단일 시크릿 (Bearer 또는 `X-Bridge-Secret`, 타이밍 안전 비교).

## 보안

- 양쪽 `.env`·`server/secrets/rcon_password`(600)·`server/data/plugins/MinecraftBridge/config.yml`(600 권장)·`.mc_bridge_secret`은 git ignore.
  `mc.sh check`가 compose·`.env` 평문 RCON을 FAIL 처리합니다.
- Discord 토큰은 신규 어플리케이션으로 발급, 기존 봇과 공유 금지. 로그 마스킹(`secretValues`) 적용.
- 브릿지 포트는 외부 노출 금지 (봇 loopback, 플러그인 미게시). 클라우드에 여는 건 게임 포트(TCP 25565·UDP 19132)뿐.
- `online-mode=true` 유지 (오프라인 인증 금지, Bedrock은 Floodgate가 처리).

## Troubleshooting

| 증상 | 확인 |
|---|---|
| 서버 `Done` 후에도 접속 불가 | 클라우드 ingress 누락이 대부분 → `server/mc.sh status` 포트 섹션, UFW가 inactive면 클라우드 콘솔에서 직접 개방 |
| Bedrock 로그인 실패 | `server/data/plugins/Geyser-Spigot/config.yml`의 `auth-type: floodgate` 후 `./mc.sh restart` |
| OOM 종료 | `docker inspect minecraft \| grep OOMKilled`. Java 21은 `ExitOnOutOfMemoryError`로 빠르게 재시작 |
| 봇 `/health`의 `minecraft:false` | `docker logs minecraft`에 `MinecraftBridge listening` 있는지, `docker network inspect mc-discord`에 두 컨테이너가 모두 있는지 |
| `/ops`·브릿지 `401` | 봇 `.env`와 플러그인 `config.yml` 시크릿 일치 여부 (수정 후 양쪽 재시작) |
| 봇 로그 `discord disabled` | `.env`의 `DISCORD_TOKEN`/`DISCORD_APPLICATION_ID` 공란 = 정상 대기 상태, 채운 뒤 `docker compose up -d` |
| `fwhitelist … entry was not created` | Floodgate Xbox API 조회 실패 → gamertag 오타·미보유 계정 (502가 정상) |
| "계정을 찾을 수 없습니다 … 잠시 후 다시 시도" | Geyser Global API가 캐시 보유 플레이어만 반환 + Xbox Live 레이트리밋이면 503. 다른 Geyser 서버에 1회 접속해 캐시에 올린 뒤 재시도 (서버 `fwhitelist`도 동일 실패) |
| gamerule `keepInventory` 실패 | 1.21.11은 `keep_inventory` (snake_case) |
| `mc.sh check` RCON 평문 FAIL | `compose.yaml`·`.env`의 `RCON_PASSWORD=` 제거 → `secrets/rcon_password` 파일 마운트만 사용 |
| 이벤트 중복 전시 | 봇 3분 dedup + 플러그인 재시도 1회. 핸들러 500 실패는 dedup에 남지 않아 재시도가 재처리됨 (정상) |
| 길드 명령이 바로 안 보임 | 전역 등록은 최대 1시간 지연이 정상. 급하면 `bun run minecraft:commands -- <guildId>`로 해당 길드만 즉시 반영 |

## 문서

- [`server/README.md`](server/README.md) — 서버 단독 설치·운용·복원 (이 폴더만 복사해도 됨)
- [`docs/minecraft-integration.md`](docs/minecraft-integration.md) — 브릿지 이벤트·Ops 규약, Floodgate UUID 실측, 검증 기록
- [`minecraft-bridge/`](minecraft-bridge/) — 플러그인 소스 (`plugin.yml`, `config.yml` 템플릿 포함)
- [`src/minecraft/`](src/minecraft/) — 봇 도메인 (등록·리더보드·동기화·로그 채널)
