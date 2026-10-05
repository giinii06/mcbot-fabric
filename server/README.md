# server/ — Minecraft Java + Bedrock 크로스플레이 서버 (단독 호스팅 가능)

Leaf 1.21.11 + Geyser/Floodgate(Bedrock) + ViaVersion(구버전 호환) + Chunky(사전 생성) +
mc-backup(6시간 주기) 구성을 Docker로 돌립니다.

**이 폴더만 통째로 다른 호스트에 복사해도 그대로 기동됩니다.**
봇과 함께 쓰는 전체 스택 이전 절차는 리포 루트 `README.md`의
"새 호스트로 통째로 옮기기" 절을 보세요.

```
server/
├── compose.yaml   게임 서버(minecraft) + 백업 사이드카(minecraft-backup)
├── .env.example   버전·URL·자원 템플릿 (시크릿 없음, 복제 후 .env로 복사)
├── install.sh     설치/재설정 (멱등, 월드·설정·화이트리스트를 덮어쓰지 않음)
├── mc.sh          실행·관리·검증 스크립트
├── .gitignore     data/ backups/ secrets/ .env 제외
├── data/          (실행 후 생성, git 제외) 월드·server.properties·플러그인
├── backups/       (실행 후 생성, git 제외) world_*.tar.zst
└── secrets/       (실행 후 생성, git 제외) rcon_password (600)
```

## 1. 요구사항

| 항목 | 값 |
|---|---|
| OS/아키텍처 | Ubuntu 22.04+ , `aarch64`/`arm64`/`x86_64` (Java라 아키 무관) |
| CPU/RAM | 최소 2 vCPU / 4 GB 권장 (검증 환경: 2 OCPU / 12 GB). 게임 5g·1.75cpu + 백업 1g·0.5cpu 상한 |
| 디스크 | 여유 3 GB+ (월드+백업, `./mc.sh check`가 2 GB 미만이면 FAIL) |
| Docker | Engine 24+ + compose v2 (`docker compose version` 확인) |
| 포트 | TCP 25565 (Java), UDP 19132 (Bedrock). UFW가 active일 때만 자동 추가, 비활성이면 건드리지 않음 |
| 클라우드 방화벽 | OCI Security List/NSG, AWS SG 등에서 ingress 직접 개방 (아래 참조) |

```
TCP 25565  0.0.0.0/0   (Java 클라이언트)
UDP 19132  0.0.0.0/0   (Bedrock 클라이언트)
```

접속 주소 (공개 IP 기준): Java `공개IP:25565`, Bedrock `공개IP:19132` (UDP, 게임 내 "서버 추가").

## 2. 설치 (신규 호스트, 3줄)

```bash
cd server
cp .env.example .env && chmod 600 .env
# .env의 MC_UID/MC_GID를 본인 id에 맞춤 (install.sh가 첫 생성 시 자동 설정하지만,
# .env.example을 직접 복사했다면 수동 확인):  id -u ; id -g
./install.sh          # 설치/재설정 + 서버 기동 (첫 부팅은 Leaf 다운로드+월드 생성으로 수 분 소요)
./mc.sh check         # 전수 검증 — 반드시 ALL CHECKS PASSED 확인
```

`install.sh`가 하는 일 (멱등, 재실행 안전):

1. 아키텍처·Docker·포트(25565/tcp, 19132/udp) 점검. 사용 중인데 `minecraft` 컨테이너가 아니면 중단 (기존 프로세스를 죽이지 않음).
2. 외부 네트워크 `mc-discord` 생성 (없으면). 봇 없이 서버만 써도 해가 없고, 나중에 봇을 붙일 때 그대로 재사용.
3. `data/` `backups/` `secrets/` 생성 (`secrets`는 700).
4. `secrets/rcon_password` 생성 (없을 때만, `openssl rand -hex 24`, 600). compose·`.env`에는 평문을 두지 않고 파일 마운트만 사용.
5. `.env` 준비 (없으면 `.env.example` 복사 후 `MC_UID/MC_GID`를 `id -u/id -g`로 자동 설정, 600. 있으면 누락 키만 추가, 기존 값 유지).
6. `compose.yaml` 문법 검증 (`docker compose config -q`).
7. Leaf JAR sha256 대조 (불일치 시 재다운로드용 삭제, 일치는 유지).
8. 이미지 pull (`itzg/minecraft-server:java21`, `itzg/mc-backup`).
9. UFW가 active일 때만 `25565/tcp`·`19132/udp` allow. 비활성이면 활성화하지 않음 (클라우드 콘솔에서 직접 개방).
10. `docker compose up -d` + `Done (...)!` 부팅 대기 (최대 900초). 이미 실행 중이면 대기 생략.

이미 월드가 있는 호스트에서 재실행해도 `data/world*`·`server.properties`·플러그인·Floodgate `key.pem`·ops·whitelist를 덮어쓰지 않습니다.

## 3. `.env` 항목표 (전부 고정값, "latest" 금지)

| 키 | 예시 | 설명 |
|---|---|---|
| `MC_VERSION` / `LEAF_BUILD` | `1.21.11` / `179` | 서버 구현체 버전. 플러그인 호환과 세트이므로 임의 변경 금지 |
| `LEAF_JAR_URL` / `LEAF_SHA256` | (고정 URL) | Leaf 다운로드 주소와 sha256. `install.sh`·`mc.sh check`가 검증 |
| `GEYSER_URL`/`GEYSER_SHA256` | 2.11.3/b1247 | Bedrock 접속용. 공식 geysermc download API |
| `FLOODGATE_URL`/`FLOODGATE_SHA256` | 2.2.5/b141 | Bedrock 인증용. Bedrock 계정 없이 입장 가능 (`auth-type=floodgate`) |
| `VIAVERSION_URL`/`VIAVERSION_SHA256` | 5.12.0 | 구버전 클라이언트 호환 (Hangar) |
| `CHUNKY_URL`/`CHUNKY_SHA256` | 1.4.40 | 월드 사전 생성 (Hangar, Modrinth 호환 확인 후 선정) |
| `JVM_INIT_MEMORY`/`JVM_MAX_MEMORY` | `1G`/`4G` | `-Xms1G -Xmx4G`. Java 21 기본 G1GC, Aikar/MeowIce 플래그 미사용 |
| `MC_UID`/`MC_GID` | `id -u`/`id -g` | 호스트 유저 매핑 (`./data` 소유권 유지) |
| `TZ` | `Asia/Seoul` | 로그·백업 파일 시각 |
| `JAVA_PORT`/`BEDROCK_PORT` | `25565`/`19132` | 바꾸면 방화벽 규칙도 같이 변경 |
| `BACKUP_INTERVAL` | `6h` | 정기 백업 주기 (백업 컨테이너가 수행, 7일 초과분 자동 삭제) |
| `BACKUP_RETENTION_DAYS` | `7` | 보관 일수 |
| `BACKUP_COMPRESS_ARGS` | `-3 -T1` | zstd 압축 강도·스레드 |
| `BACKUP_EXCLUDES` | (고정) | jar·캐시·로그 제외 → 월드·설정·플러그인 설정만 백업 |

플러그인 올리기: `./mc.sh update-plugins --dry-run` (조회+다운로드+검증만) →
`./mc.sh update-plugins` (백업→`.env` 갱신→재시작→로드 확인).
공식 API에서 최신 조회 후 sha256+`plugin.yml` 검증, **MC 1.21.11 호환 목록에 없으면 중단**합니다.

## 4. 관리 명령 (`mc.sh`)

```bash
./mc.sh status            # 컨테이너/포트/자원/백업/플레이어 요약
./mc.sh logs [N] [-f]     # 로그 N줄 (기본 150), -f 실시간 follow
./mc.sh console           # 서버 콘솔 접속 (TTY 필요, 나가기: Ctrl-P Ctrl-Q, Ctrl-C 금지)
./mc.sh start|stop|restart
./mc.sh players           # 온라인 + OP 목록
./mc.sh tps               # Leaf 내장 /tps (fallback: spark tps)
./mc.sh mspt              # Leaf 내장 /mspt (fallback: spark tick durations)
./mc.sh backup            # 즉시 백업 (정기 백업과 동일 방식)
./mc.sh update-plugins [--dry-run]
./mc.sh check             # 전수 검증 (배포·복원·이전 후 필수)
```

월드 사전 생성 (선택, 접속 없이도 가능. 실행 중 CPU 점유):

```bash
./mc.sh pregen-overworld   # world 5000블록 반경
./mc.sh pregen-nether      # world_nether 2000
./mc.sh pregen-end         # world_the_end 2000
./mc.sh pregen-status      # 진행률/속도/ETA
./mc.sh pregen-pause|pregen-continue
./mc.sh pregen-cancel      # 취소 (chunky cancel + confirm)
```

실측 (2 OCPU): 약 6~14 cps, 실행 중 TPS 19.1~20.0. 사전 생성 없이도 접속 가능 (첫 접속 시 청크 생성).

## 5. 핵심 설정값 (제약 조건, 바꾸기 전 README 루트 "설계 판단" 참조)

| 항목 | 값 | 이유 |
|---|---|---|
| 게임 `mem_limit`/`cpus` | 5g / 1.75 | 12 GB·2 OCPU 중 일부만 사용 (다른 서비스 보호). RAM이 아니라 **CPU가 병목** |
| 백업 `mem_limit`/`cpus` | 1g / 0.5 | 게임 서버와 CPU 경쟁 방지 |
| `online-mode` | `true` | 오프라인 인증 금지 (Bedrock은 Floodgate가 처리) |
| `view-distance`/`simulation-distance` | 7 / 4 | 2 OCPU 기본값 |
| `pause-when-empty-seconds` | 60 | 빈 서버 60초 후 월드 틱 일시정지 |
| GC | 기본 G1GC | Aikar/MeowIce/Shenandoah 플래그 미사용 |
| Spark | Leaf 번들 | 별도 설치 금지 |
| 화이트리스트 | `ENABLE_WHITELIST=true` | 봇 연동 시 봇이 관리. 단독 운용이면 `whitelist add <name>` 콘솔 명령으로 수동 관리 |

`data/server.properties`·`data/config/` 직접 조정은 `restart` 후 유지, `install.sh`는 초기화하지 않음.

## 6. 검증 (`./mc.sh check`가 보는 것)

아키텍처·CPU·디스크 → 구성 파일 문법·권한 → 시크릿 분리(RCON 평문 없음) →
컨테이너 자원 한도(5g/1.75cpu) → JVM `-Xms1G/-Xmx4G` → 포트 리스닝·TCP 연결 →
**양쪽 엔드포인트 실응답**(Java status ping = Leaf 1.21.11/protocol 774,
Bedrock RakNet Pong = MCPE, port 19132) → `server.properties` →
Leaf JAR sha256 → 플러그인 4종 로드 + Floodgate `key.pem` →
Geyser `auth-type=floodgate`/`show-coordinates=true`/`clone-remote-port=false`/`debug-mode=false` →
`gamerule keep_inventory=true` → 최근 500줄 오류 스캔 → 백업 파일 존재.

> MC 1.21.11의 gamerule 키는 snake_case: `gamerule keep_inventory true`
> (`keepInventory` 아님. 실행 결과 `Gamerule keep_inventory is now set to: true`).

## 7. 백업·복원

백업은 **`/data` 기준 상대경로**(`./world`, `./plugins`, `./server.properties` …)로 담고
`*.jar`/`versions`/`libraries`/`logs`/`cache`는 제외 → 월드·설정·플러그인 설정만 복원,
실행 파일은 재다운로드. 정기 백업은 `minecraft-backup` 컨테이너가 6시간 주기로 수행.

```bash
./mc.sh stop
mv data data.bak-$(date +%Y%m%d-%H%M%S)   # 기존 데이터는 절대 삭제하지 않음
mkdir data
tar --use-compress-program=unzstd -xf backups/world-YYYYMMDD-HHMMSS.tar.zst -C data
./install.sh
./mc.sh check
```

Floodgate/Geyser `key.pem`은 백업에 포함 → 복원 후 Bedrock 계정 매핑 유지.

## 8. Discord 봇과 함께 쓰기 (요약, 상세는 루트 README)

1. `docker network inspect mc-discord`에 `minecraft`·`mcbot` 둘 다 있는지 확인
   (`install.sh`가 서버 쪽을, 루트 `docker compose up`이 봇 쪽을 붙임).
2. 플러그인 빌드·배포 (리포 루트에서):
   ```bash
   bun run minecraft:build-plugin
   cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
   ```
3. `server/data/plugins/MinecraftBridge/config.yml`의 `secret`과 봇 `.env`의
   `MC_BRIDGE_SECRET`을 같은 값으로 (어느 쪽에도 커밋·로그 금지, 600 권장).
   플러그인 포트 `:8765`는 호스트 미게시, 봇은 `mcbot:47865`로 호출.
4. `ENABLE_WHITELIST=true` 유지, `WHITELIST` 목록 환경변수는 설정하지 않음 (봇이 DB↔파일 동기화).

## 9. Troubleshooting

| 증상 | 확인 |
|---|---|
| `Done (...)!` 후에도 접속 불가 | 클라우드 ingress 누락이 대부분 (TCP 25565 + UDP 19132) → `./mc.sh status` 포트 섹션 |
| Bedrock 로그인 실패 | `data/plugins/Geyser-Spigot/config.yml`의 `auth-type: floodgate` 확인 후 `./mc.sh restart` |
| OOM 종료 | `docker inspect minecraft \| grep OOMKilled`. Java 21은 힙 소진 시 `ExitOnOutOfMemoryError`로 빠르게 재시작 |
| 포트 충돌 | `./mc.sh status` 포트 섹션. 기존 컨테이너는 종료하지 않음 (수동 정리) |
| `check`에서 RCON 평문 FAIL | `compose.yaml`·`.env`에 `RCON_PASSWORD=` 평문을 넣었는지 확인 → 파일 마운트(`secrets/rcon_password`)만 사용 |
| `check`에서 아키텍처 FAIL | `uname -m`이 aarch64/arm64/x86_64인지 확인 (라즈베리·WSL·클라우드 모두 통과) |
| `gamerule keepInventory` 실패 | 1.21.11은 `keep_inventory` (snake_case) |
