# Cobblemon 서버 운영

`server/`의 Docker Compose는 게임 서버 `minecraft`와 백업 서비스 `minecraft-backup`을 실행합니다. Java Edition 1.21.1, Fabric Loader 0.20.1, Fabric Installer 1.1.2, Java 21을 사용합니다. Cobblemon과 Fabric API의 버전과 해시는 [`mods.lock.json`](mods.lock.json)에 기록합니다.

## 시작과 점검

신규 설치는 [루트 README의 배포 절차](../README.md#서버와-봇-배포)를 따르세요. 다음 명령은 `server/`에서 실행합니다.

| 명령 | 동작 |
| --- | --- |
| `./mc.sh start` | 게임 서버와 백업 서비스 시작 |
| `./mc.sh stop` | 월드를 저장하고 서비스 중지 |
| `./mc.sh restart` | 월드를 저장하고 서비스 재시작. 변경한 Compose 설정 적용 |
| `./mc.sh status` | 컨테이너 상태와 자원 사용량 확인 |
| `./mc.sh logs -f` | 로그 확인 |
| `./mc.sh check` | 서버 설정, 모드, RCON, 브릿지, 포트, 최신 백업 확인 |
| `./mc.sh players` | 접속자 확인 |
| `./mc.sh command difficulty` | 현재 게임 난이도 확인 |
| `./mc.sh install-mods` | 고정 버전의 모드와 브릿지 설치 |
| `./mc.sh verify-mods` | JAR 파일 크기, 해시, 모드 ID 및 버전 확인 |

## 난이도와 소지품 유지

`DIFFICULTY` 기본값은 `peaceful`입니다. 이미 설치된 서버에서 `server/.env`에 `DIFFICULTY=easy`가 있으면 `DIFFICULTY=peaceful`로 바꾸고 `./mc.sh restart`를 실행하세요. 컨테이너가 시작될 때 Compose의 난이도를 `server.properties`에 적용합니다.

시작 시 RCON으로 오버월드, 네더, 엔드에 `keepInventory=true`를 적용합니다. 각 차원의 값을 확인하려면 다음 명령을 실행하세요.

```bash
./mc.sh command execute in minecraft:overworld run gamerule keepInventory
./mc.sh command execute in minecraft:the_nether run gamerule keepInventory
./mc.sh command execute in minecraft:the_end run gamerule keepInventory
```

## 접속과 화이트리스트

게임 서버는 온라인 계정 인증과 화이트리스트를 사용합니다. 플레이어는 Discord의 `/유저등록`으로 자신의 Java 계정을 등록합니다. 운영 콘솔에서 직접 등록하려면 `./mc.sh command whitelist add Java이름`을 실행하세요.

| 포트 | 접근 범위 |
| --- | --- |
| TCP 25565 | Minecraft Java 접속. 서버 호스트의 기본 공개 포트 |
| TCP 25575 | RCON. 컨테이너 내부 |
| TCP 8765 | Fabric 브릿지 HTTP. Docker 네트워크 `mc-discord` |
| TCP 47865 | 디스코드 봇 HTTP. `mc-discord`와 호스트 루프백 |

OCI에서는 게임 포트와 관리용 SSH의 접근 범위를 [OCI 배포 안내](../docs/DEPLOY_OCI.md)에 맞추세요.

## 설정과 데이터

| 파일 또는 경로 | 용도 |
| --- | --- |
| [`.env.example`](.env.example) | 게임 난이도, 메모리, 공개 포트, 백업 기본값 |
| [`compose.yaml`](compose.yaml) | 이미지 버전, 게임 8 GiB 메모리 상한, 네트워크 및 포트 |
| `data-cobblemon/` | 월드, 화이트리스트, 모드, Cobblemon 플레이어 데이터 |
| `data-cobblemon/config/minecraftbridge.json` | 브릿지 포트와 봇 주소. 기본 봇 주소는 `http://mcbot:47865` |
| `secrets/rcon_password` | 서버와 백업이 공유하는 RCON 비밀번호 |
| `secrets/bridge_secret` | Fabric 브릿지와 봇이 공유하는 시크릿. 루트 `.env`의 `MC_BRIDGE_SECRET`과 일치해야 함 |
| `backups-cobblemon/` | zstd 백업 보관 |
| `data/` | 이전 Paper 월드가 남아 있을 수 있는 경로. [Paper 이전 안내](../docs/MIGRATION_FROM_PAPER.md) |

기본 JVM 메모리는 2G부터 6G까지입니다. 접속 인원, 시야 거리, 시뮬레이션 거리는 `.env`에서 조정할 수 있습니다.

`./mc.sh install-mods`는 `mods.lock.json`에서 모드 JAR를 받습니다. 브릿지 JAR는 `../minecraft-bridge/build/libs/`에서 가져오며 JAR가 없으면 JDK 21과 Gradle wrapper로 빌드합니다. 모드 버전을 바꿀 때는 게임과 클라이언트가 같은 목록을 사용하도록 함께 배포하세요.

## 백업과 복구

백업은 서버 기동 3분 후 시작하며 기본 주기는 24시간, 보존 기간은 7일입니다. 백업 서비스는 여유 공간을 검사하고, RCON으로 월드를 디스크에 저장한 후 아카이브를 만듭니다. 월드, Cobblemon 플레이어 데이터, 설정 및 화이트리스트를 포함합니다. 모드 JAR는 설치 명령으로 다시 준비합니다.

```bash
./mc.sh backup
./mc.sh verify-backup backups-cobblemon/파일명.tar.zst
```

월드를 복구할 때는 [복구 절차](../docs/RECOVERY.md)를 따르세요.

## 문제 해결

| 증상 | 확인 |
| --- | --- |
| 게임 접속이 거부됨 | Java 계정 등록, 공개 포트, 클라이언트와 서버의 모드 버전 |
| Discord 봇의 `minecraft` 상태가 `false` | 양쪽 컨테이너의 `mc-discord` 연결, 게임 서버의 브릿지 기동 로그 |
| 브릿지 인증 오류 401 | 루트 `.env`와 `secrets/bridge_secret`의 값 일치 여부 |
| 모드 파일 검증 실패 | 디스크 여유 공간과 다운로드 연결. 이후 `./mc.sh install-mods` 재실행 |
| 백업 검증 실패 | 백업 서비스 로그, 디스크 여유 공간, 최신 아카이브 검사 |
