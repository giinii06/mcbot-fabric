# mcbot — Minecraft Java·Bedrock 서버와 Discord 연동

**mcbot은 Minecraft 계정 등록, Java 화이트리스트 관리, 플레이타임 조회, 게임 로그 전송을 제공하는 Discord 봇입니다.** Bun·TypeScript로 실행되는 봇과 Paper에서 실행되는 Java 플러그인 `MinecraftBridge`로 구성됩니다. 이 저장소에는 게임 서버, Bedrock 크로스플레이, 자동 백업을 위한 Docker Compose와 운영 스크립트도 포함되어 있습니다.

Discord에서 Java 계정을 등록하면 게임 화이트리스트에 추가됩니다. Bedrock은 Floodgate로 인증된 사용자가 Discord 등록 없이 접속할 수 있으며, Bedrock 등록은 게임 로그에 표시할 Discord 이름을 연결하는 용도입니다. 한 Discord 사용자는 같은 Discord 서버에서 **Java 1개와 Bedrock 1개를 각각 등록**할 수 있습니다.

이 문서는 **현재 저장소의 코드와 설정 템플릿**을 기준으로 합니다. 버전은 저장소에 고정된 값이며 최신 릴리스라는 의미가 아닙니다. 기존 월드가 있는 환경에서는 신규 설치 절차를 그대로 실행하지 말고 [업데이트와 이전](#업데이트와-이전)을 먼저 확인하세요.

## 목차

1. [기능과 제공 범위](#기능과-제공-범위)
2. [전체 구조와 통신](#전체-구조와-통신)
3. [기본 서버 사양](#기본-서버-사양)
4. [마인크래프트를 호스팅하는 방법](#마인크래프트를-호스팅하는-방법)
5. [설치 전 준비](#설치-전-준비)
6. [신규 설치](#신규-설치)
7. [환경변수와 플러그인 설정](#환경변수와-플러그인-설정)
8. [Discord 명령어 전체 안내](#discord-명령어-전체-안내)
9. [Java와 Bedrock 계정 등록](#java와-bedrock-계정-등록)
10. [플레이타임과 리더보드](#플레이타임과-리더보드)
11. [게임 로그와 전송 정책](#게임-로그와-전송-정책)
12. [브릿지 HTTP API](#브릿지-http-api)
13. [일상 운영](#일상-운영)
14. [업데이트와 이전](#업데이트와-이전)
15. [데이터 저장과 백업](#데이터-저장과-백업)
16. [문제 해결](#문제-해결)
17. [개발과 검증](#개발과-검증)
18. [저장소 구조와 참고 문서](#저장소-구조와-참고-문서)

## 기능과 제공 범위

| 기능 | 제공하는 동작 |
|---|---|
| Java 등록 | Mojang에서 이름·UUID 조회 → 미리보기 → 확인 버튼 → 화이트리스트 추가 및 DB 저장 |
| Bedrock 등록 | Xbox 게이머태그·XUID 조회 또는 게임 인증 캐시 이용 → 확인 → Discord 계정과 연결 |
| 에디션별 등록 관리 | Java·Bedrock 각각 등록·조회·해제, 관리자의 에디션별 강제 해제 |
| 등록 목록 | 해당 Discord 서버의 등록 계정 수와 최대 20개 계정 표시 |
| 화이트리스트 동기화 | 해당 Discord 서버의 Java 등록 목록과 게임 화이트리스트 비교·추가·제거 |
| 플레이타임 | 게임 통계를 기준으로 누적 시간 조회, 등록 계정 리더보드와 페이지 이동 |
| 게임 로그 | 접속·퇴장·사망·도전과제·공개 채팅을 Discord에 전송 |
| 서버별 로그 채널 | 여러 Discord 서버에서 각각 하나의 수신 채널 설정 |
| 감사 기록 | 등록·해제·강제 해제·로그 채널 설정·동기화 작업을 SQLite에 기록 |
| 상태 확인 | 봇과 플러그인 각각 HTTP `/health` 제공 |
| 게임 호스팅 | 고정 버전 Paper, Geyser·Floodgate, 자동 백업, 선택적 Chunky 사전 생성 |
| 독립 배포 | 봇만 수정한 경우 게임 서버를 재시작하지 않고 봇 컨테이너 교체 |

Minecraft에서 Discord로 채팅을 보내는 기능을 제공합니다. Discord 채팅을 Minecraft로 전달하는 기능, 웹 관리 화면, Discord에서 임의 콘솔 명령 실행, 계정 소유권 인증용 게임 내 코드 발급은 구현되어 있지 않습니다. 등록 미리보기의 확인 버튼은 조회된 계정을 선택하는 단계이며, 해당 Minecraft 계정을 실제로 소유했다는 증명은 아닙니다.

## 전체 구조와 통신

```text
Discord 사용자
   │ 슬래시 명령어·버튼
   ▼
mcbot 컨테이너                         minecraft 컨테이너
Bun + discord.js + SQLite              Paper + MinecraftBridge
   │                                     ▲
   ├── POST http://minecraft:8765/ops ─────┤
   │   화이트리스트·플레이타임·접속자 조회  │
   │                                     │
   ◀── POST http://mcbot:47865/bridge/events
   │   접속·퇴장·사망·도전과제·채팅·인증 정보
   ▼
Discord 로그 채널

공유 네트워크: mc-discord
게임 백업: minecraft-backup → RCON → minecraft → server/backups/
```

### 실행 단위

| 구성 요소 | 파일 | 역할 |
|---|---|---|
| `mcbot` | 루트 [`compose.yaml`](compose.yaml) | Discord 연결, 명령 처리, SQLite 저장, 이벤트 수신 |
| `minecraft` | [`server/compose.yaml`](server/compose.yaml) | 게임 서버와 Java 플러그인 실행 |
| `minecraft-backup` | [`server/compose.yaml`](server/compose.yaml) | RCON 저장 제어, 게임 데이터 압축·검증·보관 |
| `MinecraftBridge` | [`minecraft-bridge/`](minecraft-bridge/) | 게임 API를 HTTP 작업 API와 이벤트로 연결 |
| Geyser·Floodgate | `server/data/plugins/` | Bedrock 클라이언트 접속과 인증, 선택적 Java 계정 연결 |

봇 Compose와 게임 Compose는 별도 프로젝트이며 외부 Docker 네트워크 `mc-discord`를 공유합니다. 루트에서 실행한 `docker compose`는 봇을, `server/`에서 실행한 `docker compose`는 게임·백업을 대상으로 합니다. `server/mc.sh`는 내부에서 작업 디렉터리를 `server/`로 이동합니다.

### 포트와 접근 범위

| 포트 | 프로토콜 | 용도 | 기본 접근 범위 |
|---|---|---|---|
| `25565` | TCP | Java 게임 접속 | 호스트에 게시, `JAVA_PORT`로 호스트 포트 변경 가능 |
| `19132` | TCP·UDP | Bedrock 접속·NetherNet signaling | 호스트에 게시 |
| `8765` | HTTP/TCP | MinecraftBridge `/ops`, `/health` | Docker 내부, 호스트 미게시 |
| `47865` | HTTP/TCP | 봇 이벤트 수신, `/health` | Docker 내부 및 호스트 `127.0.0.1` |
| `25575` | TCP | 게임 백업·운영용 RCON | Docker 내부, 호스트 미게시 |
| `80` | TCP | 별도 구성한 Bedrock TLS의 ACME 인증 | 해당 TLS 갱신 구성을 사용할 때 필요 |

외부 게임 접속에는 호스트 방화벽과 클라우드 방화벽 양쪽의 허용 규칙이 필요합니다. 설치기는 OCI NSG/Security List를 수정하지 않습니다. RCON과 브릿지 포트를 공인 IP로 공개하지 마세요.

컨테이너 안의 `localhost`는 그 컨테이너 자신입니다. 기본 구성에서는 봇이 `minecraft:8765`, 플러그인이 `mcbot:47865`로 접근해야 합니다.

## 기본 서버 사양

호스팅 템플릿은 **Oracle ARM64 2 OCPU / 메모리 12GB** 환경을 기준으로 작성되어 있습니다. 실제 수용 인원은 월드·플러그인·탐험·엔티티·네트워크와 호스트의 다른 서비스에 따라 달라집니다.

| 항목 | 저장소 기본값 |
|---|---|
| 게임 서버 | Paper `26.3`, 빌드 `205` |
| 게임 이미지 | `itzg/minecraft-server:java25` |
| 봇 이미지 기반 | `oven/bun:1.3.14-slim` |
| MinecraftBridge | `1.0.0` |
| 브릿지 컴파일 | JDK 21 툴체인, Paper `1.21.11-R0.1-SNAPSHOT` API |
| Geyser | `2.12.0`, 빌드 `1268` |
| Floodgate | `2.2.5`, 빌드 `141` |
| 선택적 Chunky | `1.5.3` |
| 게임 모드·난이도 | 생존·평화로움 |
| PvP | 켬 |
| 인증 | `online-mode=true` |
| 화이트리스트 | `white-list=true`, `enforce-whitelist=true`; 인증된 Floodgate 접속 예외 |
| 보안 프로필 | `enforce-secure-profile=false` |
| 최대 접속 설정 | `1000`명 |
| 시야·시뮬레이션 거리 | `6` / `4` |
| JVM 힙 | 초기 `2G`, 최대 `6G` |
| 게임 컨테이너 자원 상한 | 메모리 `8g`, CPU `2.0` |
| 봇 컨테이너 자원 상한 | 메모리 `384m`, CPU `0.5` |
| 백업 컨테이너 자원 상한 | 메모리 `512m`, CPU `0.25` |
| 백업 | 기동 후 초기 지연 `3m`, 이후 `24h` 간격, `7`일 보관 |
| 시간대 | 게임·백업 `Asia/Seoul` |

`MAX_PLAYERS=1000`은 접속 상한이며 1000명 수용 성능을 뜻하지 않습니다. CPU 상한은 예약된 전용 자원이 아니며 게임·봇·백업이 호스트 CPU를 함께 사용합니다. MinecraftBridge는 최대 인원이나 기존 월드의 `keepInventory`를 강제로 바꾸지 않습니다.

## 마인크래프트를 호스팅하는 방법

이 저장소는 **상시 켜 두는 Linux 서버에서 Docker Compose로 Paper를 실행**하는 방식입니다. 호스팅 기준 환경은 Oracle Cloud ARM64 VM 2 OCPU·메모리 12GB이며, 게임·자동 백업·Discord 봇을 같은 호스트에서 각각 별도 컨테이너로 실행합니다. 게임 프로세스를 개발자 PC나 SSH 터미널에 직접 띄워 유지하는 구조가 아닙니다.

### 1. 호스트와 저장 공간 준비

클라우드 VM에 공개 접속 주소와 SSH 접근을 준비하고, 서버에서 Docker Engine·Compose를 사용할 수 있게 설치합니다. 저장소를 내려받기 위한 Git도 필요합니다. 전체 봇 연동과 브릿지 빌드까지 하려면 아래 [설치 전 준비](#설치-전-준비)의 Bun·JDK도 준비합니다.

- VM 생성, 공개 IP 할당, 클라우드 방화벽 설정은 운영자가 수행합니다. 저장소 스크립트가 클라우드 인프라를 생성하지 않습니다.
- 월드는 호스트의 `server/data/`, 게임 백업은 `server/backups/`에 남습니다. 저장소는 임시 디스크가 아닌 계속 보관할 디스크에 둡니다.
- 디스크에는 월드 원본 외에 플러그인·이미지·로그·보관 기간의 백업을 저장할 공간이 필요합니다. 필요한 양은 월드 크기에 따라 달라집니다.
- 메모리가 다른 호스트에서는 JVM 힙과 컨테이너 제한을 함께 검토합니다. 게임 힙 외에도 JVM·운영체제·봇·백업의 메모리가 필요합니다.

SSH로 호스트에 접속한 뒤 저장소를 준비합니다. 이미 내려받았다면 기존 저장소에서 진행합니다.

```bash
git clone https://github.com/blond11qq/mcbot.git
cd mcbot

# 호스트 자원과 Docker 접근 확인
uname -m
free -h
df -h .
docker version
docker compose version
```

### 2. 게임 파일과 컨테이너 준비

신규 서버에서는 저장소 루트에서 다음을 실행합니다.

```bash
(cd server && ./install.sh --no-start)
```

설치기는 게임·백업용 설정과 디렉터리, RCON 시크릿, 공유 Docker 네트워크를 만들고 고정된 Paper·Geyser·Floodgate JAR와 이미지를 준비합니다. `--no-start`이므로 이 시점에는 게임을 시작하지 않습니다. 기존 월드가 있으면 자동으로 새 버전으로 바꾸지 않습니다.

전체 Discord 연동으로 호스팅하려면 이 상태에서 [신규 설치](#신규-설치)의 MinecraftBridge 빌드·배치, 공유 시크릿, 봇 환경변수 설정을 끝낸 뒤 게임을 시작합니다. 플러그인 없이 게임만 먼저 띄우면 Discord 등록과 Bedrock 화이트리스트 예외는 제공되지 않습니다.

게임만 운영하는 경우에도 기본 Java 화이트리스트는 켜져 있습니다. 게임 기동 후 운영자가 실제 Java 이름을 허용할 수 있습니다.

```bash
# JavaPlayer를 접속시킬 실제 Java 계정 이름으로 교체
(cd server && ./mc.sh command whitelist add JavaPlayer)
```

나중에 봇의 화이트리스트 동기화를 실행하면 수동 추가 계정이 제거될 수 있으므로, 봇 연동 후에는 Discord 등록 목록과 함께 관리합니다.

### 3. 외부에서 접속할 네트워크 열기

호스트의 공개 주소까지 게임 트래픽이 도달해야 합니다. OCI를 사용한다면 해당 VM에 적용되는 NSG 또는 Security List와 호스트 방화벽을 함께 확인합니다. 집이나 사내 공유기 뒤에서 운영하면 공유기 포트 전달과 외부에서 접근 가능한 주소도 필요합니다.

| 허용할 트래픽 | 목적 | 적용 범위 |
|---|---|---|
| TCP `25565` | Java 게임 접속 | 접속할 사용자들의 주소 범위 |
| TCP `19132` | Bedrock NetherNet signaling | Bedrock을 제공할 때 |
| UDP `19132` | Bedrock 게임 통신 | Bedrock을 제공할 때 |
| TCP `22` | SSH 운영 접속 | 관리자의 주소 범위, 기존 접근 유지 |
| TCP `80` | Bedrock TLS 인증서 갱신 | 해당 ACME 갱신 구성을 사용할 때 |

`JAVA_PORT`를 바꾸면 Java 허용 포트도 그 값에 맞춥니다. Docker의 포트 게시와 방화벽 허용은 각각 확인해야 합니다. 방화벽을 전체 초기화하거나 SSH 허용 규칙을 지우지 않습니다. TCP `25575`·`8765`·`47865`는 게임 접속용 공개 포트가 아닙니다.

Bedrock의 새 호스트 설정은 포트 개방만으로 끝나지 않을 수 있습니다. Geyser signaling 주소, HTTPS 인증서와 갱신 구성을 실제 공개 주소에 맞춰 준비합니다. 기존 호스트의 인증서·IP를 그대로 복사하지 말고 [Bedrock 운영 안내](server/README.md#typescript-discord-봇-연결)를 따릅니다.

### 4. 게임 시작과 접속 확인

```bash
# 저장소 루트에서 게임·백업 시작
(cd server && ./mc.sh start)
(cd server && ./mc.sh logs -f)
```

`start`는 내부적으로 `docker compose up -d`를 실행하므로 SSH 연결을 닫아도 컨테이너는 계속 실행됩니다. `logs -f` 화면에서 `Ctrl+C`를 눌러도 로그 추적만 끝나고 게임은 유지됩니다.

기동 완료 후 상태를 확인합니다.

```bash
(cd server && ./mc.sh status)
(cd server && ./mc.sh check)
(cd server && ./mc.sh players)
```

Java에서는 서버 주소를 `<호스트 공개 IP 또는 도메인>:25565`로 추가합니다. Bedrock에서는 같은 공개 주소와 포트 `19132`를 사용합니다. Java는 등록 또는 수동 허용을 먼저 마쳐야 하며, Bedrock은 Geyser·Floodgate와 브릿지 예외 설정에 따라 접속합니다. 호스트 안의 상태 확인뿐 아니라 실제 외부 네트워크의 게임 클라이언트로 접속을 확인하세요.

### 5. SSH 종료·호스트 재부팅 후에도 유지

게임·백업·봇 Compose는 `restart: unless-stopped`를 사용합니다. Docker 데몬이 부팅 시 시작되도록 설정되어 있고 컨테이너를 수동 정지하지 않았다면 Docker가 다시 시작될 때 컨테이너도 재시작합니다.

```bash
# systemd를 사용하는 호스트에서 확인
systemctl is-enabled docker
systemctl is-active docker

# 자동 시작이 꺼져 있다면 활성화
sudo systemctl enable --now docker
```

수동으로 `./mc.sh stop`한 게임은 호스트를 재부팅해도 자동 시작을 기대하지 말고 `./mc.sh start`로 다시 시작합니다. healthcheck 실패만으로 컨테이너가 자동 교체되지는 않으므로 상태·디스크·백업 로그를 운영자가 확인해야 합니다.

### 6. 월드를 유지하며 운영하기

게임 월드와 설정은 컨테이너 내부 임시 공간이 아니라 `server/data/`에 마운트됩니다. 따라서 컨테이너를 교체해도 이 디렉터리를 유지하면 게임 데이터가 남습니다. `server/data/` 삭제·덮어쓰기나 호스트 디스크 상실은 별개이므로 [데이터 저장과 백업](#데이터-저장과-백업)을 따릅니다.

```bash
# 정기 점검
(cd server && ./mc.sh status)
(cd server && ./mc.sh tps)
(cd server && ./mc.sh mspt)

# 작업 전 일회 백업, 게임은 실행 중이어야 함
(cd server && ./mc.sh backup)

# 점검을 위한 정상 종료와 시작
(cd server && ./mc.sh stop)
(cd server && ./mc.sh start)
```

자동 백업은 같은 호스트의 `server/backups/`에 저장됩니다. 호스트 전체 장애에 대비하려면 백업과 비밀 설정을 별도 저장소에도 보관합니다. 서버 버전 변경, 데이터 복구, 봇만 배포하는 절차는 아래의 해당 절을 따릅니다.

## 설치 전 준비

### 필요한 프로그램과 계정

| 준비물 | 필요한 작업 |
|---|---|
| Docker Engine·Compose 플러그인 | 게임·백업·봇 이미지 빌드와 컨테이너 실행 |
| Bun | 봇 의존성 설치, 명령어 등록, 개발·테스트 |
| JDK 21 툴체인 | MinecraftBridge 빌드·JUnit 테스트 |
| Bash·curl·openssl·SHA256 도구 | 설치·운영 스크립트, JAR 다운로드·검증, 난수 생성 |
| Discord 애플리케이션·봇 | 봇 토큰과 애플리케이션 ID 발급 |
| Java 또는 Bedrock 실제 계정 | 실제 접속과 계정 연동 확인 |

Gradle은 [`minecraft-bridge/gradlew`](minecraft-bridge/gradlew) 래퍼로 실행하므로 별도 Gradle 설치는 필요하지 않습니다. 최초 빌드에는 Gradle과 Maven 의존성을 다운로드할 네트워크가 필요합니다. 게임 런타임 Java 25는 Docker 이미지가 제공하며, 호스트 플러그인 빌드용 JDK와 구분합니다.

```bash
# 저장소 루트에서 도구 확인
docker version
docker compose version
bun --version
java -version
id -u
id -g
```

운영자는 Minecraft EULA를 확인하고 동의해야 합니다. 게임 Compose에는 `EULA: "TRUE"`가 설정되어 있습니다.

### Discord 애플리케이션 준비

1. Discord Developer Portal에서 이 봇에 사용할 애플리케이션과 Bot을 준비합니다.
2. Bot 토큰을 루트 `.env`의 `DISCORD_TOKEN`에 입력합니다.
3. 애플리케이션 ID를 `DISCORD_APPLICATION_ID`에 입력합니다. 토큰과 ID는 같은 애플리케이션의 값이어야 합니다.
4. 설치 후 `bun run invite`가 출력하는 URL로 사용할 Discord 서버에 초대합니다.
5. 로그 수신 채널에서 봇의 **채널 보기·메시지 보내기·링크 임베드** 권한을 허용합니다.

초대 스크립트는 `bot`, `applications.commands` scope와 위 세 가지 권한을 요청합니다. 채널별 권한 덮어쓰기로 전송이 차단되지 않았는지도 확인하세요. 관리자 명령을 쓰는 사람에게는 Discord **Administrator** 권한이 필요합니다.

현재 봇이 요청하는 Gateway Intent는 `Guilds`입니다. 게임 채팅은 MinecraftBridge가 보내므로 Discord 메시지 본문을 읽기 위한 Message Content Intent를 사용하지 않습니다.

## 신규 설치

아래는 **새 호스트·새 월드**에 대한 순서입니다. 명시하지 않은 명령은 저장소 루트에서 실행합니다. 실제 `.env`, 런타임 데이터, 비밀 키는 문서에 복사하거나 Git에 추가하지 않습니다.

### 1. 의존성과 게임 서버 파일 준비

```bash
bun install --frozen-lockfile

# 게임을 시작하지 않고 파일·시크릿·JAR·이미지 준비
(cd server && ./install.sh --no-start)

# MinecraftBridge 빌드
bun run minecraft:build-plugin

# 서버 plugins 디렉터리에 배치
mkdir -p server/data/plugins/MinecraftBridge
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
```

`install.sh --no-start`는 읽기 전용 점검이 아닙니다. 새 설치에서는 다음 작업을 수행합니다.

- `server/.env`가 없으면 예제에서 복사하고 실행 사용자 UID/GID를 설정합니다.
- `server/data/`, `server/backups/`, `server/secrets/`를 생성합니다.
- RCON 비밀번호가 없으면 생성하고 파일 권한을 제한합니다.
- `mc-discord` 네트워크가 없으면 생성합니다.
- Paper·Geyser·Floodgate JAR를 고정 URL에서 내려받고 SHA256을 검증합니다.
- Bedrock 설정 템플릿을 배치하고 게임·백업 이미지를 준비합니다.

기존 `server/.env`는 덮어쓰지 않습니다. 구 Leaf 설정은 이전 안내와 함께 중단하고, `server/data/server.properties`가 있으면 기존 데이터를 유지한 채 준비를 조기에 끝냅니다. 따라서 기존 설치에서 실행했다고 네트워크·플러그인까지 모두 갱신되는 것은 아닙니다.

### 2. 봇 환경변수와 브릿지 설정 만들기

```bash
# 기존 파일이 있으면 유지
if [ ! -f .env ]; then
  cp .env.example .env
fi
if [ ! -f server/data/plugins/MinecraftBridge/config.yml ]; then
  cp minecraft-bridge/src/main/resources/config.yml server/data/plugins/MinecraftBridge/config.yml
fi

mkdir -p data
chmod 600 .env server/data/plugins/MinecraftBridge/config.yml
```

루트 `.env`에서 다음 값을 설정합니다.

```dotenv
DISCORD_TOKEN=실제_봇_토큰
DISCORD_APPLICATION_ID=실제_애플리케이션_ID
MC_BRIDGE_SECRET=충분히_긴_난수로_교체
MC_BRIDGE_BASE_URL=http://minecraft:8765
MC_BOT_PORT=47865
SQLITE_PATH=data/mcbot.sqlite
LOG_LEVEL=info
```

위 토큰·ID·시크릿은 설명용 자리표시자입니다. `openssl rand -hex 32` 등으로 공유 시크릿을 생성하고, 다음 두 위치에 **완전히 같은 값**을 입력합니다.

| 위치 | 항목 |
|---|---|
| 루트 `.env` | `MC_BRIDGE_SECRET` |
| `server/data/plugins/MinecraftBridge/config.yml` | `bot.secret` |

플러그인의 `bot.secret: 'CHANGE_ME'`를 반드시 교체합니다. 봇은 최소 16자를 요구합니다. 생성한 값은 비밀정보로 다루고 커밋·로그·공유 스크린샷에 남기지 않습니다.

기본 네트워크 주소는 다음과 같이 맞춥니다.

```yaml
# server/data/plugins/MinecraftBridge/config.yml 일부
enabled: true
bot:
  base-url: 'http://mcbot:47865'
  secret: '루트_MC_BRIDGE_SECRET과_동일한_실제_값'
server:
  bind: '0.0.0.0'
  port: 8765
```

### 3. 봇 데이터 디렉터리 권한 확인

봇 Compose의 기본 실행 UID/GID는 `1001:1001`입니다. 루트 `data/`에 이 사용자가 쓸 수 있어야 합니다. 호스트 사용자로 실행하려면 `id -u`, `id -g`의 결과를 루트 `.env`에 넣습니다.

```dotenv
# 예시: 실제 호스트 사용자 숫자로 바꾸기
MCBOT_UID=1001
MCBOT_GID=1001
```

`mkdir -p data`로 만든 디렉터리가 해당 사용자 소유인지 확인합니다. 게임의 `MC_UID`, `MC_GID`는 `server/.env`의 별도 설정입니다. 기존 게임 데이터 전체의 권한을 무작정 변경하지 마세요.

### 4. 게임과 봇 실행

```bash
(cd server && ./mc.sh start)
docker compose up -d --build --no-deps mcbot

# 봇 초대 URL 생성
bun run invite

# 전역 슬래시 명령어 등록
bun run minecraft:commands
```

초대 URL을 열어 원하는 Discord 서버에 봇을 추가합니다. 봇 실행과 명령어 등록은 별도 작업입니다. 컨테이너가 실행된 것만으로 슬래시 명령어가 등록되지는 않습니다.

첫 게임 기동은 파일 생성과 플러그인 초기화로 시간이 걸릴 수 있습니다.

```bash
(cd server && ./mc.sh logs -f)
```

로그의 게임 기동 완료와 MinecraftBridge 초기화를 확인한 후 다음 단계로 진행합니다.

### 5. 상태 확인

```bash
docker compose ps mcbot
docker compose logs --tail 50 mcbot
curl -fsS http://127.0.0.1:47865/health
(cd server && ./mc.sh check)
```

봇 상태 응답 예시:

```json
{"ok":true,"minecraft":true}
```

- `ok`: 봇의 HTTP 상태 엔드포인트가 응답하고 있다는 뜻입니다.
- `minecraft`: 최근 플러그인 통신 상태가 유효한지 나타냅니다. 봇은 10초마다 상태를 확인하고, 상태 응답에 최대 30초의 신선도 기준을 사용합니다.
- 이 응답은 Discord 로그인·로그 전송 성공이나 공유 시크릿 일치까지 증명하지 않습니다. 플러그인 `/health`는 인증 없이 응답합니다.
- Compose의 봇 healthcheck는 HTTP 성공 여부를 검사하며 `minecraft` 필드의 값까지 검사하지 않습니다.

봇 로그에서 `discord ready`를 확인하고 Discord 채널에서도 동작을 확인해야 합니다.

### 6. 로그 채널과 실제 접속 확인

1. Discord 관리자가 게임 로그를 받을 채널에서 `/마크로그설치`를 실행합니다.
2. 설정 확인 메시지가 해당 채널에 도착하는지 확인합니다.
3. Java 사용자는 `/유저등록`으로 계정을 등록하고 확인 버튼을 누릅니다.
4. Java 클라이언트로 `<호스트 공개 주소>:25565`에 접속합니다.
5. Bedrock은 주소와 포트 `19132`를 사용합니다. 새 호스트는 [Bedrock 설정 안내](server/README.md#typescript-discord-봇-연결)의 signaling·TLS와 TCP·UDP 방화벽 설정을 먼저 확인합니다.
6. 접속·채팅·퇴장 이벤트가 Discord 채널에 도착하는지 확인합니다.

설정 파일만 준비된 상태와 실제 Java·Bedrock 접속이 검증된 상태는 구분해서 운영 기록을 남깁니다.

## 환경변수와 플러그인 설정

### 루트 `.env`: 봇 설정

봇은 Bun의 환경변수 로딩을 이용합니다. 빈 문자열은 미설정으로 취급하고 시작 시 Zod 스키마로 검사합니다.

| 변수 | 기본값 | 의미와 검증 |
|---|---|---|
| `DISCORD_TOKEN` | 없음 | Discord 로그인용 봇 토큰 |
| `DISCORD_APPLICATION_ID` | 없음 | 숫자로 된 애플리케이션 ID, 명령 등록·초대에 사용 |
| `MC_BRIDGE_SECRET` | 없음, 필수 | 최소 16자, 플러그인 `bot.secret`과 동일해야 함 |
| `MC_BRIDGE_BASE_URL` | `http://minecraft:8765` | 봇 → 플러그인 HTTP 기본 주소 |
| `MC_BOT_PORT` | `47865` | 봇 HTTP 수신 포트, 1~65535 정수 |
| `SQLITE_PATH` | `data/mcbot.sqlite` | SQLite 파일 경로 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` 중 하나 |
| `DISCORD_DISABLED` | 미설정 | 정확히 `1` 또는 `true`이면 Discord 연결 생략 |
| `MCBOT_UID` | `1001` | Compose 봇 실행 UID, 애플리케이션 스키마 항목은 아님 |
| `MCBOT_GID` | `1001` | Compose 봇 실행 GID, 애플리케이션 스키마 항목은 아님 |

`DISCORD_TOKEN` 또는 `DISCORD_APPLICATION_ID` 중 하나라도 없으면 Discord 연결 없이 실행합니다. 이때도 `MC_BRIDGE_SECRET`은 필수입니다. 이벤트 HTTP 수신은 가능하지만 Discord 전송을 대신하는 저장소나 나중에 재전송할 대기열이 생기는 것은 아닙니다.

컨테이너는 `/app`에서 실행하며 호스트 루트 `data/`를 `/app/data`에 마운트합니다. `SQLITE_PATH`를 바꾸면 새 경로가 영속 마운트 내부인지 확인하세요.

`MC_BOT_PORT`만 바꾸면 기본 Compose와 맞지 않습니다. 루트 Compose의 게시 포트·healthcheck, 플러그인의 `bot.base-url`도 함께 수정해야 합니다. 현재 템플릿은 `47865`를 명시합니다.

### MinecraftBridge `config.yml`

템플릿: [`minecraft-bridge/src/main/resources/config.yml`](minecraft-bridge/src/main/resources/config.yml). 실제 파일: `server/data/plugins/MinecraftBridge/config.yml`.

| 키 | 기본값 | 역할 |
|---|---|---|
| `enabled` | `true` | 브릿지 사용 여부 |
| `bot.base-url` | `http://mcbot:47865` | 플러그인 → 봇 기본 주소, `/bridge/events`는 코드가 붙임 |
| `bot.secret` | `CHANGE_ME` | 공유 시크릿, 반드시 실제 값으로 교체 |
| `server.bind` | `0.0.0.0` | 플러그인 HTTP 수신 인터페이스 |
| `server.port` | `8765` | 플러그인 HTTP 수신 포트 |
| `timeouts.bot-connect-ms` | `3000` | 이벤트 전송 연결 타임아웃 |
| `timeouts.bot-request-ms` | `3000` | 이벤트 HTTP 요청 타임아웃 |
| `timeouts.sync-task-ms` | `4000` | 게임 메인 스레드 작업 대기 한도 |
| `queue.capacity` | `200` | 메모리에 보관할 이벤트 큐 용량 |
| `queue.workers` | `2` | 이벤트 전송 워커 수 |
| `queue.retry` | `1` | 최초 전송 실패 뒤 추가 재시도 횟수 |

큐가 가득 차면 오래된 이벤트를 버립니다. 영구 메시지 큐가 아니므로 장시간 장애·재시작·과부하에서 이벤트가 유실될 수 있습니다. 워커가 둘이므로 이벤트의 엄격한 도착 순서도 보장하지 않습니다.

설정은 플러그인 초기화 시 읽습니다. 설정 파일만 편집한 것으로 실행 중인 플러그인에 반영되지 않으며 게임 서버 재시작 절차가 필요합니다.

### `server/.env`: 게임·백업 설정

전체 템플릿은 [`server/.env.example`](server/.env.example)을 참고하세요. 루트 `.env`와 다른 파일입니다.

| 변수 | 기본값 또는 용도 |
|---|---|
| `MC_VERSION`, `PAPER_BUILD` | `26.3`, `205` |
| `PAPER_JAR_URL`, `PAPER_SHA256` | 고정 Paper JAR 다운로드 주소·SHA256 |
| `GEYSER_URL`, `GEYSER_SHA256` | 고정 Geyser JAR 주소·SHA256 |
| `FLOODGATE_URL`, `FLOODGATE_SHA256` | 고정 Floodgate JAR 주소·SHA256 |
| `CHUNKY_URL`, `CHUNKY_SHA256` | 선택 설치 Chunky 주소·SHA256 |
| `JVM_INIT_MEMORY`, `JVM_MAX_MEMORY` | `2G`, `6G` |
| `MAX_PLAYERS` | `1000`, 접속 상한 |
| `VIEW_DISTANCE`, `SIMULATION_DISTANCE` | `6`, `4` |
| `MC_UID`, `MC_GID` | 템플릿 `1001:1001`, 신규 설치기가 실행 사용자 값으로 설정 |
| `TZ` | `Asia/Seoul` |
| `JAVA_PORT` | `25565`, 호스트의 Java 게시 포트 |
| `BACKUP_INTERVAL` | `24h` |
| `BACKUP_RETENTION_DAYS` | `7` |
| `BACKUP_COMPRESS_ARGS` | `-3 -T1`, zstd 압축 수준·단일 스레드 |
| `BACKUP_EXCLUDES` | JAR·캐시·로그·임시 파일·라이브러리·RCON CLI 인증 파일 등 제외 |

난이도·PvP·컨테이너 자원 제한 등 일부 설정은 `server/compose.yaml`에 있습니다. `./mc.sh check`는 생존·평화로움·시야 6·시뮬레이션 4 등 기본 정책을 검사하므로, 운영 정책을 바꾸면 검사 기준도 검토해야 합니다.

### 설정 파일 위치 정리

| 경로 | 내용 | 변경 적용 |
|---|---|---|
| 루트 `.env` | 봇 토큰·공유 시크릿·DB·봇 주소 | 봇 컨테이너 재생성 |
| `server/.env` | 게임 버전·메모리·백업 환경변수 | 대상 게임·백업 컨테이너 재생성 |
| `server/data/plugins/MinecraftBridge/config.yml` | 브릿지 주소·시크릿·큐 | 게임 재시작 |
| `server/data/plugins/Geyser-Spigot/config.yml` | Bedrock·signaling 설정 | 설정에 따라 Geyser reload 또는 게임 재시작 |
| `server/data/plugins/floodgate/config.yml` | Bedrock 인증·Global Linking | 게임 재시작 |
| `server/secrets/rcon_password` | RCON 비밀번호 | 관련 게임·백업 서비스 설정과 함께 반영 |

`server/bedrock/`은 배포용 템플릿입니다. 기존 운영 설정은 설치기가 덮어쓰지 않으므로 템플릿 변경은 자동으로 반영되지 않습니다. Floodgate `key.pem`과 인증서 개인 키도 비밀정보입니다.

## Discord 명령어 전체 안내

모든 명령은 Discord 서버 안에서 사용하며 DM용으로 등록하지 않습니다. 아래의 관리자는 **Administrator 권한이 있는 Discord 멤버**입니다. 관리자 제한은 명령 등록 권한과 실행 시 검사에 모두 적용됩니다.

`에디션` 옵션은 `Java` 또는 `Bedrock` 선택 항목이며 내부 값은 각각 `JAVA`, `BEDROCK`입니다.

| 명령 | 권한 | 필수 옵션 | 선택 옵션 | 응답 |
|---|---|---|---|---|
| `/유저등록` | 모든 멤버 | `마크아이디` | 없음 | 본인에게만 표시 |
| `/유저등록베드락` | 모든 멤버 | `마크아이디` | 없음 | 본인에게만 표시 |
| `/유저해제` | 모든 멤버 | `에디션` | 없음 | 본인에게만 표시 |
| `/마크리더보드` | 모든 멤버 | 없음 | 없음 | 채널에 표시 |
| `/마크로그설치` | 관리자 | 없음 | 없음 | 설정 확인을 채널에 표시 |
| `/유저조회` | 관리자 | `에디션` | `유저`, 생략 시 본인 | 본인에게만 표시 |
| `/유저목록` | 관리자 | 없음 | 없음 | 본인에게만 표시 |
| `/유저강제해제` | 관리자 | `에디션`, `유저` | 없음 | 본인에게만 표시 |
| `/화이트리스트동기-sync` | 관리자 | 없음 | 없음 | 본인에게만 표시 |

등록·해제 결과는 개인 응답과 별개로 설정된 게임 로그 채널에도 기록될 수 있습니다.

### 사용 예시

아래는 Discord에서 입력할 예시입니다. Bash 명령이 아닙니다.

```text
/유저등록 마크아이디:JavaPlayer
/유저등록베드락 마크아이디:Xbox Player
/유저해제 에디션:Bedrock
/유저조회 에디션:Java 유저:@사용자
/유저조회 에디션:Bedrock
/유저강제해제 에디션:Java 유저:@사용자
/유저목록
/마크리더보드
/마크로그설치
/화이트리스트동기-sync
```

### 명령별 동작

- **등록**: 에디션에 맞는 계정 제공자만 조회합니다. 미리보기에서 이름·에디션·UUID를 확인한 뒤 버튼을 눌러 확정합니다. 대기 요청은 5분 후 만료되고 봇 재시작 시 사라집니다.
- **본인 해제·강제 해제**: 지정한 에디션의 등록만 지웁니다. 다른 에디션은 유지합니다. Bedrock 해제는 Discord 연결 삭제이며 게임 접속 차단 기능이 아닙니다.
- **유저조회**: 계정 이름·에디션·UUID·플레이타임·접속 여부·등록일을 보여줍니다. 브릿지 오류 시 시간은 `조회 실패`, 접속 상태는 `확인 불가`로 표시될 수 있습니다.
- **유저목록**: 등록 순서 기준 최대 20개 계정을 표시하고 나머지 개수를 안내합니다. Java·Bedrock을 둘 다 등록한 사람은 두 계정으로 집계합니다. 목록 자체에는 페이지 이동이 없습니다.
- **마크리더보드**: 해당 Discord 서버에 등록된 계정의 플레이타임 순위를 10개씩 표시합니다.
- **마크로그설치**: 현재 채널을 수신 채널로 지정합니다. 새 채널에 메시지를 보내지 못하면 이전 설정으로 되돌립니다. 다른 채널에서 다시 실행하면 수신 채널이 바뀝니다.

일반 슬래시 명령에는 사용자별 `6초에 4회`, 등록 준비에는 별도로 `8초에 3회` 제한을 적용합니다. 사용자 ID 기준이므로 다른 Discord 서버에서 연속 실행한 요청도 같은 봇 프로세스의 제한에 영향을 줄 수 있습니다.

### 화이트리스트 동기화의 범위

**`/화이트리스트동기-sync`는 즉시 게임 화이트리스트를 변경합니다.** 미리보기나 별도 승인 단계가 없습니다.

| 비교 결과 | 동작 |
|---|---|
| 현재 Discord 서버 DB에만 있는 Java 계정 | 게임 화이트리스트에 추가 |
| DB와 게임에 모두 있는 Java UUID | 유지 |
| 게임에만 있는 Java 계정 | 화이트리스트에서 제거 |
| Bedrock UUID 또는 점 접두사 계정 | 동기화 대상에서 제외 |
| 제거 대상 이름이 Java 이름 형식이 아님 | 제거하지 못한 항목으로 결과에 기록 |

기준은 **명령을 실행한 Discord 서버의 Java 등록 목록**입니다. 모든 Discord 서버 등록의 합집합을 계산하지 않습니다. 다른 Discord 서버에서만 등록한 사용자나 콘솔에서 별도 허용한 사용자의 접속 권한이 제거될 수 있습니다.

다른 서버에서 같은 Java 계정을 등록했더라도 한 서버에서 해제하면 게임의 공용 화이트리스트에서 제거될 수 있습니다. 여러 Discord 서버가 하나의 게임 서버를 공유할 때는 누가 Java 접속 권한을 관리할지 정한 뒤 운영하세요. 동기화 전에는 DB와 게임 백업을 보관하고 적용할 등록 목록을 확인합니다. 일부 항목 실패 시 이미 성공한 변경까지 전체 롤백하지는 않습니다.

### 명령어 등록·갱신

```bash
# 모든 초대 서버에 사용할 전역 명령어
bun run minecraft:commands

# 위와 같은 스크립트의 별칭
bun run register

# 개발 시 특정 Discord 서버의 명령어로 등록
bun run minecraft:commands -- 123456789012345678
```

등록 스크립트는 해당 애플리케이션의 선택한 범위에 명령어 목록을 일괄 PUT합니다. 같은 애플리케이션에 다른 기능의 명령어를 함께 등록했다면 덮어쓸 수 있으므로 전용 애플리케이션을 사용합니다.

특정 서버용 등록은 전역 등록과 별도 범위입니다. 개발 서버에 등록한 명령 정의는 이후 전역 정의와 달라질 수 있으므로 옵션이 다르게 보이면 두 범위를 확인하세요. 전역 등록은 즉시 표시되지 않을 수 있습니다.

봇 코드를 배포해도 Discord에 저장된 명령 이름·설명·옵션이 자동 갱신되지는 않습니다. 명령 정의를 바꾼 경우 배포와 별개로 등록 스크립트를 다시 실행합니다. 임베드 색상·문구만 바꿨다면 명령어를 다시 등록할 필요는 없습니다.

## Java와 Bedrock 계정 등록

### 저장 단위와 중복 제한

등록 정보는 Discord 서버별로 나뉩니다.

- 같은 서버에서 한 Discord 사용자당 Java 1개, Bedrock 1개를 등록할 수 있습니다.
- 같은 서버에서 같은 Minecraft UUID를 다른 Discord 사용자가 중복 등록할 수 없습니다.
- 다른 에디션을 추가 등록하려고 기존 에디션을 해제할 필요는 없습니다.
- 같은 에디션의 계정을 변경하려면 해당 에디션을 먼저 해제한 뒤 다시 등록합니다.
- 다른 Discord 서버의 등록은 별도 DB 항목이지만, 게임 서버와 화이트리스트는 공유합니다.

Minecraft 플레이어와 등록 정보의 연결은 UUID 기준입니다. 이름 문자열이 같다는 이유로 다른 UUID를 같은 계정으로 취급하지 않습니다.

### Java 등록 흐름

1. `/유저등록 마크아이디:JavaPlayer`를 실행합니다.
2. 입력을 검사하고 Mojang 프로필 API에서 이름과 UUID를 조회합니다.
3. 미리보기에서 대상 계정을 확인합니다.
4. 확인 버튼을 누르면 중복 여부를 다시 검사합니다.
5. MinecraftBridge로 Java 화이트리스트에 추가합니다.
6. 추가 성공 후 SQLite에 등록 정보를 저장하고 감사 기록·로그를 남깁니다.

DB 저장이 실패하면 화이트리스트 추가를 되돌리려고 시도합니다. 해제는 화이트리스트 제거 후 DB 삭제 순서이고, DB 삭제 실패 시 화이트리스트 복구를 시도합니다. 복구 통신 자체가 실패할 수 있으므로 `whitelist rollback failed`, `whitelist restore failed`가 나오면 실제 DB와 화이트리스트를 대조합니다.

화이트리스트 작업이 필요한 Java 등록·해제는 게임 브릿지에 접근할 수 있어야 합니다. 등록만으로 Minecraft 인벤토리·아이템·월드 데이터를 변경하지 않습니다.

### Bedrock 등록과 게임 접속

Bedrock 접속은 Geyser·Floodgate가 처리합니다. MinecraftBridge는 Floodgate API가 인증한 플레이어의 화이트리스트 검사에 예외를 적용합니다. 따라서 Discord에 등록하지 않은 Bedrock 사용자도 접속할 수 있습니다.

- Java 정품 인증과 Java 화이트리스트는 유지합니다.
- Bedrock의 차단·정원 제한을 해제하는 기능은 아닙니다.
- 브릿지가 비활성화되면 브릿지가 제공하던 화이트리스트 예외도 적용되지 않습니다.
- Bedrock 등록·해제는 DB의 Discord 연결만 바꾸고 화이트리스트 작업 API를 호출하지 않습니다.
- Bedrock 등록 해제로 접속을 막을 수 없습니다. 접속 통제는 게임 운영 정책에 맞게 별도로 처리해야 합니다.

`/유저등록베드락`에는 Xbox 게이머태그를 입력합니다. 서버 표시용 점(`.`) 접두사는 붙이지 않습니다. 일반 경로는 Geyser의 Xbox XUID API를 이용하고, XUID를 Floodgate UUID로 변환하여 저장합니다.

현재 입력 검증은 최대 16자이며 영문·숫자로 시작하고 영문·숫자·공백·`._'-`를 허용합니다. Java 계정 조회는 영문·숫자·밑줄의 3~16자 이름을 대상으로 합니다. 실제 서비스에서 가능한 모든 국제 문자 게이머태그를 지원하는 입력기는 아닙니다.

### Xbox 조회가 503으로 실패할 때

코드는 Geyser/Xbox 조회의 503을 계정이 없다는 뜻과 구분합니다. 다음 순서로 게임 인증 정보를 이용할 수 있습니다.

1. Bedrock 앱에서 먼저 이 서버에 접속을 시도합니다.
2. 플러그인이 인증된 플레이어의 UUID·XUID를 `player.identity` 이벤트로 봇에 전달합니다.
3. 봇이 해당 정보를 메모리에 보관합니다.
4. **30분 안에** `/유저등록베드락`으로 다시 등록합니다.

이 경로는 게임 인증과 플러그인 → 봇 이벤트 통신이 작동해야 합니다. 접속 시도가 봇에 도달하지 않았거나 봇이 재시작되면 캐시를 이용할 수 없습니다. 다시 접속을 시도한 뒤 등록하세요. 일반 외부 조회 캐시는 기본 60초, 게임 인증으로 얻은 Bedrock 캐시는 30분입니다.

### Java·Bedrock 캐릭터를 함께 쓰는 Global Linking

Discord에 Java·Bedrock을 각각 등록하는 것과 **Floodgate Global Linking**은 서로 다른 기능입니다.

| 구분 | 연결하는 대상 | 인벤토리·캐릭터 |
|---|---|---|
| Discord 등록 | Discord 사용자 ↔ Minecraft 계정 | 게임 캐릭터를 합치지 않음 |
| Floodgate Global Linking | Java 계정 ↔ Bedrock 계정 | 연결된 Java UUID의 캐릭터로 플레이 |

Java 캐릭터를 Bedrock에서도 사용하려면 [서버 운영 문서의 Global Linking 절차](server/README.md#typescript-discord-봇-연결)를 따릅니다. Microsoft 계정이 같아도 별도 연결 절차가 필요합니다. 연결한 뒤에는 `/유저등록`에 **Java 게임 내 이름**을 입력하고, 이미 등록한 Java 사용자는 다시 등록하지 않습니다.

연결 시 Java UUID의 인벤토리·위치·도전과제를 사용합니다. 기존 Bedrock 캐릭터의 아이템이 자동으로 합쳐지지 않으며 연결을 해제할 때까지 기존 Bedrock 데이터에 접근할 수 없으므로, 연결 전에 필요한 아이템과 데이터를 확인합니다.

## 플레이타임과 리더보드

플레이타임은 Discord 접속 시간이나 봇 가동 시간이 아니라 **Minecraft 게임 통계**에서 가져옵니다. 등록 전부터 같은 월드·UUID로 플레이한 시간도 게임 통계에 있다면 누적값에 포함됩니다.

- 플러그인은 온라인 플레이어 통계 스냅샷과 오프라인 통계 파일을 사용합니다.
- 현재 서버의 `world/players/stats/`와 이전 형식의 `world/stats/` 경로를 지원합니다.
- 통계 단위는 틱이며 초 변환에는 20틱/초를 사용합니다.
- 게임 통계가 없는 UUID는 0으로 반환될 수 있습니다.
- 리더보드는 해당 Discord 서버에 등록된 계정만 표시하고 계정당 한 줄을 사용합니다.
- Java·Bedrock 계정을 모두 등록하면 각각 별도 순위로 나타날 수 있습니다.
- 기본 페이지 크기는 10개이며 버튼으로 페이지를 이동합니다.
- 시간 내림차순으로 정렬하고, 동률이면 이름·UUID 순으로 정렬합니다.

리더보드는 조회 시 게임 브릿지에 각 등록 계정의 시간을 요청합니다. 개별 조회 실패는 현재 구현에서 0초로 처리되므로 게임 장애 중 보이는 0초가 실제 초기화를 의미하지는 않습니다. 브릿지를 복구한 뒤 다시 조회하세요. `/유저조회`는 실패한 경우 `조회 실패`를 표시하므로 함께 확인할 수 있습니다.

## 게임 로그와 전송 정책

### 이벤트별 표시

| 이벤트 | Discord 형식 | 색상·내용 |
|---|---|---|
| 접속 | 임베드 | 초록 `#57F287`, 접속 안내 |
| 퇴장 | 임베드 | 회색 `#99AAB5`, 퇴장 안내 |
| 사망 | 임베드 | 빨강 `#ED4245`, 한국어 사망 안내와 유효한 사망 횟수 |
| 도전과제 | 임베드 | 초록 `#57F287`, 달성 안내와 도전과제 이름 |
| 공개 채팅 | 일반 텍스트 | `닉네임 (마크이름): 내용` |
| 등록·해제 | 임베드 | 실행한 Discord 서버의 로그 채널에 결과 기록 |
| `player.identity` | 채널 표시 없음 | Bedrock 등록 조회용 캐시 갱신 |
| `server.status` | 채널 표시 없음 | 이벤트는 수신하지만 현재 처리기는 알림을 보내지 않음 |

`/마크로그설치`의 확인 문구에 서버 상태가 언급되어도 현재 이벤트 처리기는 시작·종료 상태 메시지를 Discord에 게시하지 않습니다.

### 플레이어 이름

기본 형식은 `Discord 닉네임 (Minecraft 이름)`입니다.

```text
별빛 (JavaPlayer) 님이 서버에 접속했습니다.
? (.Xbox_Player) 님이 서버에 접속했습니다.
```

Discord 이름은 서버 표시 이름, 글로벌 이름, 사용자 이름 순으로 선택하고 이벤트 처리에서는 저장된 표시 이름을 보조로 사용할 수 있습니다. 등록자를 찾을 수 없으면 `?`를 표시합니다. Discord 이름과 Minecraft 이름이 같으면 중복 표기를 생략합니다.

등록 후에는 새로 전송되는 메시지에 연결된 이름을 사용합니다. 이미 보낸 Discord 메시지를 소급 수정하지 않습니다.

### 채팅·사망·도전과제

공개 채팅은 명령어와 취소된 채팅을 제외합니다. Discord Markdown을 이스케이프하고 메시지 길이를 제한하며, `allowed_mentions`로 멘션 알림을 차단합니다. 일반 텍스트 전송은 링크 임베드도 억제합니다.

사망 로그에는 좌표·월드·바이옴을 표시하지 않습니다. 원인·가해자 등 전달된 정보를 이용해 사망 안내를 구성합니다.

도전과제는 [`src/minecraft/advancements.ko.json`](src/minecraft/advancements.ko.json)에 포함된 Minecraft 26.3 한국어 번역을 ID로 조회합니다. 이름만 표시하며 설명은 표시하지 않습니다. 번역에 없는 커스텀 도전과제는 플러그인이 전달한 이름을 사용합니다.

### 여러 Discord 서버로 보내는 규칙

1. 각 서버 관리자가 `/마크로그설치`로 채널을 설정합니다.
2. 일반 게임 이벤트는 로그 채널이 설정된 모든 Discord 서버로 전송합니다. 미등록 플레이어 이벤트도 전송합니다.
3. 이름은 수신 서버의 등록을 우선 사용합니다. 수신 서버에 등록이 없으면 다른 등록 서버의 Discord 이름을 사용할 수 있습니다.
4. 코드에 지정된 서버 `1214203256620847124`에 등록된 플레이어는 예외로 **그 서버에만** 로그를 보냅니다. 그 서버에 로그 채널이 없으면 전송하지 않습니다.

위 특정 서버 예외는 환경변수 옵션이 아니라 [`src/minecraft/events.ts`](src/minecraft/events.ts)의 정책입니다. 여러 서버에 초대하기 전에 공개 채팅과 Discord 표시 이름을 어디까지 공유할지 정하세요.

### 전송 보장과 한계

플러그인은 유한한 메모리 큐와 재시도로 이벤트를 보냅니다. 봇은 이벤트 ID를 기본 3분 동안 기억하여 중복을 억제합니다. 핸들러가 예외로 실패하면 HTTP 500을 반환하고 성공한 이벤트로 기억하지 않아 재시도가 가능합니다.

하지만 **HTTP 수신 성공이 모든 Discord 채널의 게시 성공을 의미하지는 않습니다.** 채널 전송 실패는 로그에 남고 `false`로 처리되며, 일반 이벤트 처리기가 그 결과를 예외로 올리지 않아 이벤트 HTTP 응답이 성공할 수 있습니다. 재시도 소진·큐 초과·프로세스 재시작·채널 권한 오류에서 유실될 수 있고, 일부 대상에만 전송된 뒤 재시도되면 중복이 생길 수도 있습니다. 게임 로그를 무손실 감사 저장소로 사용하지 마세요.

## 브릿지 HTTP API

상세 스키마는 [`src/bridge/protocol.ts`](src/bridge/protocol.ts), 통신 구현은 [`src/bridge/`](src/bridge/)와 [`minecraft-bridge/.../bridge/`](minecraft-bridge/src/main/java/kr/mcbot/bridge/bridge/)에 있습니다.

### 엔드포인트

| 서버 | 메서드·경로 | 인증 | 동작 |
|---|---|---|---|
| 봇 `:47865` | `GET /health` | 없음 | 봇 응답과 최근 게임 통신 상태 |
| 봇 `:47865` | `POST /bridge/events` | 공유 시크릿 | 이벤트 검증·중복 확인·처리 |
| 플러그인 `:8765` | `GET /health` | 없음 | 플러그인 이름·버전·상태 |
| 플러그인 `:8765` | `POST /ops` | 공유 시크릿 | 정해진 게임 작업 실행 |

기본 요청 인증은 `Authorization: Bearer <shared-secret>`이며 `X-Bridge-Secret` 헤더도 지원합니다. HTTP이므로 사설 네트워크 안에서 사용합니다. 비밀값을 URL 쿼리나 공개 예제에 넣지 않습니다.

### 작업 종류

| `op` | 목적 | 주요 인자 |
|---|---|---|
| `whitelistAddJava` | Java 화이트리스트 추가 | `uuid`, `username` |
| `whitelistRemoveJava` | Java 화이트리스트 제거 | `uuid`, `username` |
| `whitelistAddBedrock` | Bedrock 화이트리스트 작업 API | `gamertag`, 선택 `xuid` |
| `whitelistRemoveBedrock` | Bedrock 화이트리스트 작업 API | `gamertag`, 선택 `xuid` |
| `getWhitelist` | 현재 화이트리스트 조회 | 없음 |
| `getPlaytime` | 누적 플레이타임 조회 | `uuid` |
| `getOnlinePlayers` | 현재 접속자 조회 | 없음 |
| `getStatus` | 접속 인원·최대 인원·버전·화이트리스트 설정 조회 | 없음 |

모든 작업 요청에는 `op`와 `requestId`가 필요합니다. Bedrock 화이트리스트 API가 남아 있어도 현재 Discord Bedrock 등록·해제·동기화 경로는 이를 호출하지 않습니다. 임의 콘솔 명령 문자열을 실행하는 브릿지 API는 없습니다.

요청 모양 예시:

```json
{
  "op": "getPlaytime",
  "requestId": "example-playtime-001",
  "uuid": "00000000-0000-0000-0000-000000000001"
}
```

플레이타임 응답은 `uuid`, `seconds`, `ticks`, `source`를 제공합니다. 위 UUID는 설명용이며 실제 계정 조회 결과를 나타내지 않습니다.

### 오류 해석

| 상태 | 주로 의미하는 상황 |
|---|---|
| `400` | 잘못된 JSON·요청 스키마·작업 이름·인자 |
| `401` | 공유 시크릿 인증 실패 |
| `404` | 지원하지 않는 경로·메서드 등 |
| `500` | 이벤트 처리 또는 플러그인 작업 내부 오류 |
| `502` | 플러그인 화이트리스트 작업 실패 |
| `503` | 플러그인 작업 중단·실행 불가 등 |
| `504` | 게임 메인 스레드 작업 대기 시간 초과 |

봇 → 작업 API의 기본 타임아웃은 5초, 플러그인 health 요청은 최대 3초입니다. 타임아웃만 보고 서버 측 변경이 전혀 없었다고 단정하지 말고 실제 화이트리스트·DB 상태를 확인합니다. 자세한 필드와 과거 연동 기록은 [Minecraft 통합 문서](docs/minecraft-integration.md)를 참고하세요.

## 일상 운영

### 봇 상태와 로그

```bash
# 저장소 루트
docker compose ps mcbot
docker compose logs --tail 100 mcbot
docker compose logs -f mcbot
curl -fsS http://127.0.0.1:47865/health
```

봇 컨테이너 로그는 `json-file` 드라이버로 파일당 10MB, 최대 5개를 보관하도록 설정되어 있습니다. 애플리케이션 로거는 설정된 토큰·시크릿을 가리지만, 별도 셸 명령이나 설정 파일 출력까지 비밀값을 보호하는 것은 아닙니다.

### 게임 운영 명령

아래 명령은 `server/`에서 실행합니다. `./mc.sh command`는 운영자가 RCON으로 실행하는 기능이며 Discord 브릿지 명령과 다릅니다.

| 명령 | 동작 |
|---|---|
| `./mc.sh start` | 게임·백업 서비스 시작 |
| `./mc.sh stop` | 백업 정지 → 월드 flush → 게임 정상 종료 |
| `./mc.sh restart` | 정상 정지 후 게임·백업 시작 |
| `./mc.sh status` | 컨테이너·자원·디스크 상태 |
| `./mc.sh logs -f` | 게임·백업 로그 추적 |
| `./mc.sh logs -f minecraft-backup` | 백업 로그 추적 |
| `./mc.sh players` | 현재 접속자 |
| `./mc.sh tps` | TPS 조회 |
| `./mc.sh mspt` | MSPT 조회 |
| `./mc.sh command <명령>` | 게임 콘솔 명령 실행 |
| `./mc.sh check` | 기본 게임 설정·해시·상태·비공개 포트·브릿지 점검 |
| `./mc.sh backup` | 실행 중 게임의 일회 백업 |
| `./mc.sh verify-backup backups/파일.tar.zst` | 아카이브 읽기 검증 |
| `./mc.sh download-paper` | 고정 Paper JAR 다운로드·해시 검사 |
| `./mc.sh install-bedrock` | 고정 Geyser·Floodgate 설치, 기존 설정 유지 |
| `./mc.sh install-chunky` | 선택적 Chunky 설치 |

게임 종료 유예는 120초입니다. `restart: unless-stopped`는 프로세스 종료와 Docker 재기동에 대한 정책이며, 수동 정지한 서비스는 정지 상태를 유지합니다. healthcheck 실패만으로 자동 재시작하지는 않습니다.

### 성능 확인과 청크 사전 생성

```bash
# server/에서 실행
./mc.sh tps
./mc.sh mspt
./mc.sh command spark healthreport
./mc.sh command spark profiler start --timeout 120
```

Paper 내장 Spark를 이용합니다. 20 TPS의 틱 예산은 50ms이며 실제 플레이 중 평균·95백분위 MSPT, GC 정지, CPU·힙, 청크 생성, 엔티티 부하를 확인합니다. 실접속 부하 검증 없이 정원이나 안정적인 TPS를 보장하지 않습니다.

새 청크 생성 부하를 미리 처리하려면 선택적으로 Chunky를 설치합니다.

```bash
./mc.sh install-chunky
./mc.sh restart
./mc.sh pregen-overworld
./mc.sh pregen-status
./mc.sh pregen-pause
./mc.sh pregen-continue

# 오버월드 작업 후 별도로 수행
./mc.sh pregen-nether
```

기본 오버월드는 원형 반경 2000, 네더는 반경 1000입니다. 시작 시 접속자 0명과 디스크 여유 10GiB를 검사합니다. 진행 중 자동으로 플레이어 접속을 막거나 부하에 따라 멈추는 기능은 아니므로 운영자가 관찰하고 필요하면 중단해야 합니다. 실제 월드 이름과 운영 절차는 [선택적 사전 생성](server/README.md#선택적-사전-생성)을 참고하세요.

### Bedrock TLS 운영

Bedrock 설정은 NetherNet을 사용하며 TCP·UDP 19132를 모두 확인해야 합니다. 저장소에는 [`server/renew-bedrock-tls.sh`](server/renew-bedrock-tls.sh)가 있지만 신규 설치기가 모든 호스트의 인증서·systemd 타이머를 자동 구성하지는 않습니다.

기존 운영 환경의 IP·인증서 경로를 다른 호스트에 그대로 사용하지 마세요. 실제 공개 주소, 인증서, Geyser HTTPS 설정, 인증서 갱신용 TCP 80 규칙을 맞춥니다. 기존 운영 환경의 타이머 확인 예시는 다음과 같습니다.

```bash
systemctl status mcbot-bedrock-tls.timer
journalctl -u mcbot-bedrock-tls.service
```

인증서 설치·갱신·Geyser reload와 클라이언트 설정은 [서버 운영 안내](server/README.md#typescript-discord-봇-연결)를 따릅니다.

## 업데이트와 이전

### 변경한 파일에 따라 적용 방법 선택

| 변경 범위 | 필요한 적용 |
|---|---|
| README 등 문서 | 서비스 재시작 없음 |
| `src/` 봇 코드 | 검증 후 봇 이미지 재빌드·컨테이너 교체 |
| 루트 `.env` | 봇 컨테이너 재생성 |
| 슬래시 명령 정의 | 봇 배포와 별개로 명령어 등록 스크립트 실행 |
| MinecraftBridge Java 코드·설정 | 플러그인 검증·빌드·배치, 게임 재시작 |
| Paper·Geyser·Floodgate 버전 | 호환 검토·백업·정지·JAR 및 설정 갱신·게임 기동 |
| `server/.env`·게임 Compose | 변경 대상 서비스 재생성, 게임 중단 여부 사전 확인 |

### 봇만 배포하기

게임 서버는 그대로 두고 봇만 변경하려면 저장소 루트에서 실행합니다.

```bash
git status --short
bun run typecheck
bun test

# 필요하면 배포 전 게임 컨테이너 식별값 기록
docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' minecraft

# 봇만 빌드·교체
docker compose up -d --build --no-deps mcbot

docker compose ps mcbot
docker compose logs --tail 50 mcbot
curl -fsS http://127.0.0.1:47865/health

# 게임 컨테이너가 유지되었는지 비교
docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' minecraft
```

루트 Compose의 서비스 이름 `mcbot`을 지정하며 게임 Compose는 실행하지 않습니다. 봇만 바꿀 때 `server/mc.sh restart`는 필요하지 않습니다.

봇 교체 중 Discord 명령·로그 전송이 잠시 끊길 수 있고, 등록 확인 대기·중복 억제·계정 조회 캐시는 사라집니다. 등록 완료 데이터와 로그 채널 설정은 영속 SQLite에 남습니다. Dockerfile이 현재 작업 폴더의 `src/`를 복사하므로 커밋되지 않은 코드도 배포에 포함됩니다.

`.env`만 바꾼 경우에도 단순 `docker compose restart`는 새 환경변수를 컨테이너에 주입하지 않습니다. 다음처럼 `up`으로 다시 적용합니다.

```bash
docker compose up -d --no-deps mcbot
```

이전 코드로 복귀하더라도 이미 적용된 DB 마이그레이션이 자동으로 되돌아가지는 않습니다. DB 구조를 바꾸는 업데이트 전에는 별도로 백업합니다.

### MinecraftBridge 업데이트

게임 접속이 끊기는 작업입니다. 백업이 성공했는지 확인하고 접속자에게 안내한 뒤 진행합니다.

```bash
# 저장소 루트
bun run minecraft:test
bun run minecraft:build-plugin

(cd server && ./mc.sh backup)
(cd server && ./mc.sh stop)
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
(cd server && ./mc.sh start)
(cd server && ./mc.sh check)

curl -fsS http://127.0.0.1:47865/health
```

게임 플러그인 JAR를 바꾸는 작업은 봇 이미지 재빌드만으로 반영되지 않습니다. 빌드 성공 후에도 실제 Paper에서 플러그인이 로드되고 등록·이벤트가 동작하는지 확인합니다.

### Paper·Bedrock 플러그인과 기존 Leaf 이전

기존 서버는 업데이트 전 설정·월드·봇 DB·비밀 키를 보관합니다. 이전 버전 스크립트로 백업·정지해야 하는 환경에서는 새 스크립트로 바꾸기 전에 수행합니다.

1. 현재 버전과 이미지, 설정, 게임 데이터 및 봇 DB를 기록·백업합니다.
2. 게임·플러그인 호환성을 확인합니다.
3. `server/.env`의 버전·빌드·다운로드 URL·SHA256을 함께 갱신합니다.
4. 교체 대상 기존 JAR는 데이터 디렉터리 밖에 보관합니다. 기존 설정·키는 삭제하지 않습니다.
5. MinecraftBridge도 필요한 경우 새로 빌드·배치합니다.
6. 게임 이미지를 준비하고 서버를 기동합니다.
7. 게임 상태, Java·Bedrock 접속, 등록, Discord 로그, 백업을 확인합니다.

다운로드 스크립트는 기존 파일의 해시가 다르면 덮어쓰지 않고 중단합니다. 무조건 파일을 지우기보다 백업 후 의도한 교체인지 확인하세요. `install-bedrock`도 기존 플러그인 설정을 덮어쓰지 않습니다.

새 게임 버전으로 연 월드는 구버전으로 안전하게 다운그레이드할 수 없습니다. 복귀에는 업데이트 전 월드와 당시 설정·JAR·이미지가 필요합니다. `java25`·백업 이미지 같은 태그는 바뀔 수 있으므로 정확한 이미지 재현이 필요하면 사용한 digest도 기록합니다. 자세한 이전 절차는 [서버 이전·업데이트 안내](server/README.md#기존-leaf-이전업데이트)를 따릅니다.

## 데이터 저장과 백업

### 무엇이 어디에 저장되는가

| 경로 | 저장 내용 | 게임 자동 백업 포함 |
|---|---|---|
| 루트 `data/` | 봇 SQLite와 WAL 등 관련 파일 | 아니요 |
| 루트 `.env` | Discord 토큰·공유 시크릿·봇 설정 | 아니요 |
| `server/data/` | 월드·플레이어·화이트리스트·서버·플러그인 설정 | 포함, 제외 패턴 적용 |
| `server/.env` | 게임 버전·메모리·백업 설정 | 아니요 |
| `server/secrets/` | RCON 비밀번호·별도 TLS 인증 관련 파일 | 아니요 |
| `server/backups/` | 생성된 게임 압축 백업 | 백업 결과 위치 |

SQLite에는 `minecraft_registrations`, `minecraft_log_channels`, `minecraft_audit_log` 테이블을 사용합니다. 등록 정보에는 Discord 서버·사용자 ID, 표시 이름, Minecraft UUID·이름·에디션, 등록·수정 시각을 저장합니다. 감사 기록은 작업·실행자·대상·세부 내용을 보관합니다.

DB는 WAL 모드이며 시작할 때 `PRAGMA user_version`에 따라 마이그레이션을 순서대로 적용합니다. 현재 에디션별 등록 마이그레이션은 기존 등록을 보존하면서 기본 키를 `(guild_id, discord_user_id, minecraft_edition)`으로 바꿉니다. 적용된 마이그레이션은 직접 고치지 않고 새 항목을 추가하는 구조입니다.

### 게임 자동 백업

기본 백업은 시작 시 3분 지연 후 생성하고 이후 24시간 간격으로 실행합니다. 고정 시각의 cron 작업은 아니며 중단 기간의 백업을 소급 생성하지 않습니다. 보관 기간은 7일입니다.

백업은 RCON으로 저장을 제어하고 zstd 단일 스레드로 압축합니다. 저장 flush와 데이터 읽기 부하는 남으며, 엄격한 전체 파일 일관성이 필요한 이전에는 게임을 정지한 복사본도 보관합니다. 백업 중 설정 파일·화이트리스트를 동시에 변경하는 작업을 피합니다.

월드·서버·플러그인 설정은 포함되지만 JAR·로그·캐시·라이브러리·일부 인증 파일 등은 제외됩니다. 플러그인 설정 속 공유 시크릿은 포함될 수 있으므로 백업을 비공개로 보관하세요. 봇 DB·환경변수·RCON 시크릿은 별도 백업 대상입니다.

```bash
# server/에서 실행
./mc.sh backup
./mc.sh logs -f minecraft-backup
./mc.sh verify-backup backups/world-실제파일명.tar.zst
```

`backup`은 실행 중 게임에 RCON으로 접근하는 방식이므로 게임이 떠 있어야 합니다. 강제 종료 등으로 백업 중단 후 저장 상태가 의심되면 `./mc.sh command save-on`으로 쓰기 재개 여부를 확인합니다.

같은 디스크의 백업은 호스트·디스크 상실에 대한 복구 수단이 되지 않습니다. 필요한 보관 정책에 따라 별도 안전한 저장소에 복제해야 하며, 이 저장소가 새 클라우드 볼륨·버킷을 자동 생성하지는 않습니다.

### 봇 DB 별도 백업

단순 파일 복사 방식은 **봇을 정상 정지한 상태에서 `data/` 전체**를 보관합니다. 실행 중 SQLite 본 파일 하나만 복사하면 WAL의 변경을 놓칠 수 있습니다.

```bash
# 저장소 루트에서 실행
# 이 복사본은 게임 자동 백업이나 원격 백업을 대신하지 않음
docker compose stop mcbot
(umask 077; mkdir -p backups; cp -a data "backups/mcbot-data-$(date -u +%Y%m%d-%H%M%S)")
docker compose start mcbot
```

복사 성공을 확인한 뒤 봇을 시작합니다. 봇 정지는 게임 서버를 정지하지 않지만 그동안 Discord 연동은 중단됩니다. 기본 경로 이외의 `SQLITE_PATH`를 사용한다면 실제 DB가 위 `data/`에 포함되는지 먼저 확인합니다.

루트 `.env`, `server/.env`, `server/secrets/`는 비밀정보 보관 정책에 따라 별도로 백업합니다. Git 제외는 백업이나 접근 제어를 대신하지 않습니다.

### 복구 원칙

1. 복구 파일을 검증하고 현재 상태도 별도 보관합니다.
2. 게임 복구는 게임을, 봇 DB 복구는 봇을 정지한 상태에서 수행합니다.
3. 데이터와 맞는 설정·플러그인·게임 버전·이미지를 준비합니다.
4. 파일 UID/GID와 비밀 키 권한을 확인합니다.
5. 기동 후 상태·등록·접속·로그 전송을 확인합니다.
6. 화이트리스트와 DB의 시점 차이를 검토한 뒤 필요한 조정을 합니다.

게임 백업만 복구해도 봇 등록 DB가 같은 시점으로 되돌아가지는 않습니다. 복구 직후 동기화부터 실행하면 기존 화이트리스트를 의도치 않게 제거할 수 있습니다. 아카이브 복원 명령과 `/restore` 마운트 사용법은 [게임 백업·복구 안내](server/README.md#백업과-복구)를 따릅니다.

## 문제 해결

### 증상별 확인

| 증상 | 확인할 사항 |
|---|---|
| `invalid environment` | 오류에 표시된 변수, 공유 시크릿 최소 길이, 애플리케이션 ID 숫자 형식, 포트·로그 수준 |
| `discord disabled` | 루트 토큰·애플리케이션 ID 누락 또는 `DISCORD_DISABLED=1/true` |
| Discord 로그인 실패 | 토큰과 애플리케이션의 일치, 토큰 유효성, 봇 로그, 외부 네트워크 |
| 명령어가 안 보임 | 초대한 애플리케이션, 명령 등록 여부·범위, 전역 반영 대기, 서버 명령 권한 |
| 명령 옵션이 예전 형태임 | 명령 재등록 여부, 개발 서버 명령과 전역 명령의 차이 |
| 관리자 명령을 못 씀 | 실행자 Administrator 권한, Discord 통합 명령 권한 |
| `/health`는 200인데 `minecraft:false` | 게임·플러그인 기동, 브릿지 주소, Docker 네트워크, 최근 통신 오류 |
| `minecraft:true`인데 Java 등록 401 | 두 공유 시크릿의 일치와 변경 후 재시작 여부; health는 인증 검사 아님 |
| `network mc-discord ... could not be found` | 신규 설치가 완료됐는지, 외부 네트워크 존재 여부 |
| SQLite 쓰기·열기 실패 | 실제 DB 경로, 루트 `data/` 소유권과 봇 UID/GID, 디스크 공간 |
| 등록 확인 버튼 만료 | 5분 경과 또는 봇 재시작, 등록 명령 다시 실행 |
| 같은 에디션 중복 등록 | 해당 에디션을 먼저 해제, 다른 사용자가 같은 UUID를 등록했는지 확인 |
| Java 등록됐는데 접속 불가 | 실제 게임 UUID·화이트리스트, 다른 서버의 해제·동기화, 차단·인증·방화벽 |
| Bedrock 등록 없이 접속됨 | 인증된 Floodgate 플레이어의 화이트리스트 예외에 따른 동작 |
| Bedrock 해제했는데 접속됨 | 해제는 Discord 연결 삭제, 접속 차단은 별도 게임 정책 |
| Bedrock 조회 503 | 먼저 게임 접속 시도 → 이벤트 수신 확인 → 30분 안에 재등록 |
| Bedrock 캐시 경로가 안 됨 | 봇 재시작·만료, 게이머태그 입력, UUID/XUID 인증 이벤트 전달 |
| Bedrock만 접속 실패 | Geyser·Floodgate 로딩, 호환 클라이언트, TCP·UDP 19132, signaling·TLS |
| 로그가 오지 않음 | 채널 설정·권한, 봇 로그인, 플러그인 `bot.base-url`, 이벤트 전송 오류 |
| 특정 플레이어 로그가 일부 서버에 없음 | 특정 Discord 서버 전용 전송 정책과 그 서버 로그 채널 |
| 등록 안 한 플레이어 로그가 옴 | 미등록 플레이어도 설정된 채널에 보내는 기본 정책 |
| 서버 시작·종료 알림이 없음 | 현재 `server.status`는 채널 게시를 하지 않음 |
| 리더보드가 모두 0초 | 개별 브릿지 조회 실패가 0으로 처리될 수 있음, `/유저조회`와 게임 상태 확인 |
| 도전과제 색상·문구가 예전 그대로 | 새 봇 이미지 적용 여부; 과거 메시지는 수정되지 않음 |
| `504 server busy` | 게임 메인 스레드 지연, TPS·MSPT·CPU·GC·청크 부하 |
| JAR 해시 검사 실패 | URL·SHA256·기존 JAR 일치 여부, 의도한 버전 교체인지 확인 |
| 자동 백업이 안 생김 | 백업 컨테이너 로그, 게임 healthy, RCON 비밀번호, 디스크 여유, 보관 설정 |
| `mc.sh check` 일부 설정 실패 | 기본 검사값과 의도적으로 바꾼 서버 설정 비교 |

### 기본 진단 명령

```bash
# 저장소 루트
docker compose ps mcbot
docker compose logs --tail 100 mcbot
curl -fsS http://127.0.0.1:47865/health
docker network inspect mc-discord
docker inspect -f '{{.State.Health.Status}}' minecraft

# 게임·백업 상태
(cd server && ./mc.sh status)
(cd server && ./mc.sh logs --tail 100)
(cd server && ./mc.sh check)
```

봇에서 플러그인까지 컨테이너 네트워크로 접근 가능한지 확인할 수 있습니다. 이 요청은 시크릿을 출력하지 않습니다.

```bash
docker compose exec mcbot bun -e 'const r = await fetch("http://minecraft:8765/health"); console.log(r.status, await r.text())'
```

기본값과 다른 주소를 쓴다면 예시도 해당 주소로 바꿉니다. 네트워크가 없다면 다음은 생성 작업입니다.

```bash
docker network create mc-discord
```

이미 존재하면 만들 필요가 없습니다. 생성만으로 기존 컨테이너가 자동 연결되는 것은 아니므로 Compose 설정과 대상 서비스 적용 상태도 확인합니다.

### 확인할 로그 메시지

| 메시지 | 의미 |
|---|---|
| `bridge endpoint listening` | 봇 HTTP 수신 시작 |
| `discord ready` | Discord Gateway 로그인 완료 |
| `discord disabled` | Discord 연결 생략 모드 |
| `bridge request failed` | 봇 → 게임 작업 요청 실패 |
| `bridge event rejected: unauthorized` | 게임 → 봇 이벤트 인증 실패 |
| `bridge event accepted` | 봇 이벤트 처리 완료, 모든 채널 게시 보장은 아님 |
| `failed to deliver log message` | Discord 채널 전송 실패 |
| `whitelist rollback failed` | 등록 저장 실패 후 화이트리스트 되돌리기 실패 |
| `whitelist restore failed` | 해제 저장 실패 후 화이트리스트 복구 실패 |
| `bridge event delivery failed` | 플러그인 → 봇 전송 실패 |

문제 공유 시 토큰·시크릿·개인 키·백업 내용은 제외합니다. `docker compose config`나 `.env` 전체 출력 대신 필요한 상태와 오류 줄만 확인하세요.

## 개발과 검증

### 기본 검증 명령

```bash
# 저장소 루트
bun install --frozen-lockfile
bun run typecheck
bun test

# Java JUnit 및 플러그인 JAR
bun run minecraft:test
bun run minecraft:build-plugin
```

봇 테스트는 Bun 내장 테스트 러너, 플러그인 테스트는 Gradle·JUnit 5를 사용합니다. JAR 빌드는 `clean jar`이며 테스트 실행과 별도이므로 배포 전에 테스트 명령도 실행합니다.

### 변경 범위별 빠른 검사

```bash
# 임베드·이벤트·채팅
bun test test/embeds.test.ts test/events.test.ts test/chat.test.ts

# 등록·에디션 분리
bun test test/registration.test.ts test/registration-editions.test.ts

# 브릿지 인증·클라이언트·이벤트 수신
bun test test/auth.test.ts test/bridge-client.test.ts test/bridge-server.test.ts test/protocol.test.ts

# 계정 조회·명령 정의·순위
bun test test/identity.test.ts test/commands.test.ts test/leaderboard.test.ts
```

테스트 결과는 실행한 코드·시점의 결과입니다. [`server/VALIDATION.md`](server/VALIDATION.md)나 통합 문서의 과거 통과 개수를 현재 커밋의 검증 결과로 간주하지 않습니다.

### 로컬 실행

```bash
bun run start
bun run dev

# Discord Gateway 없이 브릿지 프로세스 실행
DISCORD_DISABLED=1 bun run start
```

`dev`는 Bun 파일 감시 모드입니다. 코드가 바뀌어 프로세스가 재시작되면 메모리 캐시와 미완료 등록 요청도 사라집니다.

호스트에서 직접 실행한 프로세스는 기본적으로 Docker 서비스 이름 `minecraft`를 해석하지 못합니다. 로컬 개발 환경에서 봇·플러그인 양쪽이 도달할 수 있는 사설 주소를 정하고 `MC_BRIDGE_BASE_URL`, `bot.base-url`을 맞추세요. 운영 브릿지를 공인 IP로 공개하는 방식으로 해결하지 않습니다.

운영 봇과 로컬 프로세스를 같은 포트·DB·Discord 토큰으로 동시에 실행하지 않습니다. 테스트용 Discord 애플리케이션, 별도 DB 경로와 포트를 사용합니다. `DISCORD_DISABLED=1`도 공유 시크릿·DB·포트 설정은 필요하며 실제 Discord 전송 검증을 대신하지 않습니다.

### 검증 단계의 차이

| 검사 | 확인할 수 있는 것 |
|---|---|
| TypeScript typecheck | 타입·호출 규약 오류 |
| Bun·JUnit 테스트 | 테스트가 다루는 로직·경계 조건 |
| 플러그인 JAR 빌드 | 의존성·컴파일·패키징 |
| Compose·HTTP health | 프로세스·네트워크·상태 응답 |
| 실제 게임 접속 | 인증·화이트리스트·클라이언트 호환 |
| Discord 실제 메시지 | 로그인·채널 권한·전송·표시 |
| 백업 검증·복원 연습 | 아카이브 읽기와 실제 복구 가능성 |

MinecraftBridge는 Paper 1.21.11 API로 컴파일하고 게임 템플릿은 Paper 26.3·Java 25로 실행합니다. 단위 테스트와 빌드 성공만으로 실제 서버 호환·실접속·성능·복구까지 검증되지는 않습니다.

### 구현을 수정할 때 참고할 위치

| 변경할 동작 | 주요 위치 |
|---|---|
| 명령 이름·설명·옵션 | `src/minecraft/commands/` |
| 버튼·인터랙션 처리 | `src/discord/interactions.ts`, `src/minecraft/pending.ts` |
| 등록·해제·실패 복구 | `src/minecraft/registration.ts` |
| Java·Xbox 계정 조회·인증 캐시 | `src/minecraft/identity.ts` |
| 로그 대상 서버 정책 | `src/minecraft/events.ts` |
| 임베드·사망 문구·도전과제 표시 | `src/minecraft/embeds.ts`, `src/minecraft/advancements.ko.json` |
| 리더보드 | `src/minecraft/leaderboard.ts` |
| DB와 마이그레이션 | `src/db/` |
| 봇·플러그인 통신 규약 | `src/bridge/protocol.ts`, Java `bridge/` |
| Bedrock 화이트리스트 예외 | Java `events/ConnectionListener.java` |
| 게임 이벤트·통계 | Java `events/`, `stats/` |
| 게임 배포·백업 | `server/compose.yaml`, `server/mc.sh`, 백업 hook 스크립트 |

## 저장소 구조와 참고 문서

```text
mcbot/
├─ src/
│  ├─ index.ts                  # 봇 초기화·상태 probe·종료 처리
│  ├─ env.ts                    # 환경변수 검증
│  ├─ log.ts                    # 로그 수준·비밀값 마스킹
│  ├─ services.ts               # 서비스 의존성
│  ├─ bridge/                   # HTTP 인증·스키마·클라이언트·수신 서버
│  ├─ core/                     # 시간·동시성·표시 이름·rate limit
│  ├─ db/                       # SQLite·마이그레이션·저장소
│  ├─ discord/                  # 인터랙션·버튼·응답
│  ├─ minecraft/                # 등록·계정 조회·로그·순위·임베드
│  │  └─ commands/              # 슬래시 명령 모듈
│  └─ scripts/                  # Discord 명령 등록·초대 URL
├─ test/                        # Bun 테스트
├─ minecraft-bridge/
│  ├─ src/main/java/            # Paper 플러그인
│  ├─ src/main/resources/       # plugin.yml·config.yml
│  ├─ src/test/java/            # JUnit 테스트
│  ├─ build.gradle.kts          # JDK·의존성·JAR 설정
│  ├─ build.sh                  # 플러그인 빌드
│  └─ test.sh                   # 플러그인 테스트
├─ server/
│  ├─ compose.yaml             # 게임·백업 컨테이너
│  ├─ .env.example             # 게임·백업 템플릿
│  ├─ install.sh               # 신규 호스트 준비
│  ├─ mc.sh                    # 운영 명령
│  ├─ backup-space.sh          # 백업 공간 검사
│  ├─ backup-verify.sh         # 백업 후 아카이브 검사
│  ├─ renew-bedrock-tls.sh      # Bedrock TLS 갱신
│  ├─ bedrock/                 # Geyser·Floodgate 설정 템플릿
│  ├─ data/                    # 게임 런타임 데이터, Git 제외
│  ├─ backups/                 # 게임 백업, Git 제외
│  └─ secrets/                 # RCON·TLS 관련 비밀정보, Git 제외
├─ docs/
│  └─ minecraft-integration.md # 통합 규약·과거 연동 기록
├─ data/                        # 봇 DB, Git 제외
├─ .env.example                # 봇 환경변수 템플릿
├─ compose.yaml                # 봇 컨테이너
├─ Dockerfile                  # 봇 이미지
├─ package.json                # 스크립트·의존성
└─ bun.lock                    # 의존성 잠금 파일
```

런타임 디렉터리는 설치·실행 과정에서 생성되며 Git에 포함되지 않습니다.

| 문서·설정 | 참고할 내용 |
|---|---|
| [게임 서버 운영 안내](server/README.md) | ARM64 호스팅, Bedrock·Global Linking·TLS, 성능, 청크 생성, 게임 복구·이전 |
| [구축 검증 기록](server/VALIDATION.md) | 해당 시점에 수행한 기동·연동·백업·복원 결과 |
| [Minecraft 통합 문서](docs/minecraft-integration.md) | 브릿지 규약·설계·과거 실측 |
| [봇 환경변수 예제](.env.example) | 루트 `.env` 작성 기준 |
| [게임 환경변수 예제](server/.env.example) | `server/.env` 작성 기준 |
| [브릿지 설정 예제](minecraft-bridge/src/main/resources/config.yml) | 공유 시크릿·주소·타임아웃·큐 |
| [봇 Compose](compose.yaml) | 봇 실행 사용자·포트·영속 데이터·자원·healthcheck |
| [게임 Compose](server/compose.yaml) | 게임·백업 이미지·네트워크·포트·자원·백업 정책 |

통합 문서의 Leaf·구버전 Bedrock 항목과 검증 문서의 실측 결과는 작성 당시 기록입니다. 현재 배포값은 실제 사용하는 `.env`·운영 설정과 저장소의 Compose·코드를 기준으로 확인합니다.
