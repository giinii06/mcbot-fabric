# mcbot — 마인크래프트 서버와 Discord를 연결하는 봇

Java·Bedrock 플레이어 등록, 화이트리스트, 플레이타임 조회, 게임 로그 전송을 제공하는 **Bun/TypeScript Discord 봇**입니다. 마인크래프트의 **MinecraftBridge 플러그인**과 사설 네트워크로 통신하며, Paper 서버·백업 컨테이너를 함께 운영할 수 있습니다.

이 저장소의 호스팅 설정은 Oracle ARM64 2 OCPU / 메모리 12GB 환경을 기준으로 작성되었습니다. 아래 버전과 자원 값은 저장소에 고정된 설정이며, 최신 버전이나 동시 접속 성능을 보장하는 수치는 아닙니다. `MAX_PLAYERS=1000`도 접속 상한 설정입니다.

## 목차

- [주요 기능](#주요-기능)
- [구성과 통신 방향](#구성과-통신-방향)
- [설치 전 준비](#설치-전-준비)
- [처음 설치하기](#처음-설치하기)
- [환경변수와 설정 파일](#환경변수와-설정-파일)
- [Discord 명령어](#discord-명령어)
- [Java·Bedrock 계정 등록](#javabedrock-계정-등록)
- [게임 로그의 표시 방식](#게임-로그의-표시-방식)
- [운영과 업데이트](#운영과-업데이트)
- [데이터와 백업](#데이터와-백업)
- [문제 해결](#문제-해결)
- [개발과 검증](#개발과-검증)
- [폴더와 참고 문서](#폴더와-참고-문서)

## 주요 기능

- Discord 계정과 Java 또는 Bedrock 계정을 연결하고 마인크래프트 화이트리스트에 추가합니다. 등록은 계정 미리보기를 확인한 뒤 버튼으로 확정합니다.
- 본인 등록 해제, 관리자 강제 해제, 등록 조회·목록, 화이트리스트 동기화를 제공합니다.
- 등록된 플레이어의 누적 플레이타임을 리더보드로 보여줍니다.
- 게임의 접속·퇴장·사망·도전과제·공개 채팅을 지정한 Discord 채널로 전송합니다.
- 같은 봇을 여러 Discord 서버에 초대하고, 서버마다 로그 채널을 지정할 수 있습니다.
- 봇과 게임 서버를 별도 Compose 프로젝트로 운영하여, **봇 코드만 변경할 때 게임 서버를 재시작하지 않고 적용**할 수 있습니다.

## 구성과 통신 방향

```text
Discord
  ↕ 슬래시 명령어 / 게임 로그
mcbot (Bun + discord.js + SQLite)
  ├─ 요청 → http://minecraft:8765/ops → MinecraftBridge → Paper
  └─ 수신 ← http://mcbot:47865/bridge/events ← MinecraftBridge

공유 Docker 네트워크: mc-discord
게임 접속: Java TCP 25565 / Bedrock TCP·UDP 19132
호스트 상태 확인: http://127.0.0.1:47865/health
```

| 구성 요소 | 역할 | 실행 위치 |
|---|---|---|
| `mcbot` | Discord 명령 처리, 등록 정보 저장, 게임 로그 전송 | 루트 `compose.yaml` |
| `minecraft` | Paper 게임 서버와 MinecraftBridge·Geyser·Floodgate | `server/compose.yaml` |
| `minecraft-backup` | RCON을 이용한 게임 데이터 백업 | `server/compose.yaml` |
| SQLite | 등록 정보, 로그 채널 설정, 감사 기록 저장 | 기본 `data/mcbot.sqlite` |

봇 → 플러그인 요청과 플러그인 → 봇 이벤트는 같은 공유 시크릿으로 인증합니다. 브릿지는 정해진 작업 API를 사용하며 Discord에서 임의의 서버 콘솔 명령을 실행하는 기능은 제공하지 않습니다.

### 저장소의 게임 서버 기본 설정

| 항목 | 설정 |
|---|---|
| 게임 서버 | Paper 26.3 STABLE 빌드 205 |
| 게임 런타임 | `itzg/minecraft-server:java25`, ARM64 지원 |
| 게임 규칙 | 생존, 평화로움, PvP 켬 |
| 인증·접속 제한 | `online-mode=true`, `white-list=true`, `enforce-whitelist=true` |
| 접속 상한 | 1000명으로 설정, 수용 성능은 별도 측정 필요 |
| Java 힙 | 초기 2G / 최대 6G |
| 게임 컨테이너 제한 | 메모리 8g / CPU 2.0 |
| 시야·시뮬레이션 거리 | 6 / 4 |
| 봇 컨테이너 제한 | 메모리 384m / CPU 0.5 |
| 게임 백업 | 24시간 간격, 7일 보관, zstd 단일 스레드 압축 |
| 플러그인 | MinecraftBridge, Geyser, Floodgate, 선택 설치 Chunky |
| 성능 분석 | Paper 내장 Spark |

게임·백업·봇은 호스트 자원을 공유합니다. 자세한 호스팅, 성능 측정, 계정 연결, TLS, 월드 복구 절차는 [서버 운영 안내](server/README.md)를 참고하세요. MinecraftBridge는 접속 인원수나 `keepInventory`를 강제로 변경하지 않습니다.

## 설치 전 준비

### 필요한 도구

- Docker Engine과 Docker Compose 플러그인: 컨테이너 실행 및 이미지 빌드에 사용합니다.
- Bun: 의존성 설치, 명령어 등록, 개발·테스트에 사용합니다. Dockerfile의 버전은 `1.3.14`입니다.
- Bash, curl, openssl: 서버 설치·운영 스크립트에 필요합니다.
- JDK 21 툴체인: MinecraftBridge를 직접 빌드·테스트할 때 필요합니다. 게임 서버의 Java 25 런타임은 Docker 이미지가 제공합니다.
- Discord 봇 토큰과 애플리케이션 ID: 별도 Discord 애플리케이션을 준비합니다.

설치는 저장소 루트에서 시작합니다. 아래 절차는 **새 서버용**입니다. 이미 월드나 설정이 있다면 덮어쓰지 말고 [기존 Leaf 이전·업데이트 안내](server/README.md#기존-leaf-이전업데이트)를 먼저 확인하세요. 운영자는 Minecraft EULA에 동의해야 하며 게임 Compose는 `EULA=TRUE`로 실행합니다.

### Discord 준비

1. Discord Developer Portal에서 사용할 애플리케이션과 봇을 준비합니다.
2. 봇 토큰은 루트 `.env`의 `DISCORD_TOKEN`, 애플리케이션 ID는 `DISCORD_APPLICATION_ID`에 넣습니다. 다른 봇의 토큰을 재사용하지 않습니다.
3. 아래 설치 후 `bun run invite`로 생성한 URL을 열어 Discord 서버에 초대합니다.
4. 로그 채널에서 봇에 **채널 보기, 메시지 보내기, 링크 임베드** 권한을 허용합니다. 채널별 권한 덮어쓰기도 확인합니다.

현재 봇은 `Guilds` Gateway Intent를 사용합니다. 마인크래프트 채팅은 플러그인에서 받아 전송하며, Discord 채팅을 게임으로 보내는 기능은 구현되어 있지 않습니다.

## 처음 설치하기

### 1. 의존성과 게임 서버 파일 준비

```bash
# 저장소 루트에서 실행
bun install --frozen-lockfile

# 파일·시크릿·고정 버전 JAR·이미지를 준비하고 게임은 시작하지 않음
(cd server && ./install.sh --no-start)

# MinecraftBridge 빌드 및 배치
bun run minecraft:build-plugin
mkdir -p server/data/plugins/MinecraftBridge
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
```

설치기는 새 설치에서 `mc-discord` 네트워크와 Geyser·Floodgate도 준비합니다. 기존 `.env`나 월드를 자동 업그레이드하지 않으며, 기존 `server.properties`가 있으면 준비 작업을 조기에 끝낼 수 있습니다. 기존 환경에 대한 보충 설치는 [서버 운영 안내](server/README.md)를 따릅니다.

### 2. 봇 환경변수와 플러그인 설정 작성

다음 복사는 해당 파일이 없을 때만 수행합니다. 기존 설정은 유지합니다.

```bash
# 저장소 루트에서 실행
if [ ! -f .env ]; then cp .env.example .env; fi
if [ ! -f server/data/plugins/MinecraftBridge/config.yml ]; then
  cp minecraft-bridge/src/main/resources/config.yml server/data/plugins/MinecraftBridge/config.yml
fi
chmod 600 .env server/data/plugins/MinecraftBridge/config.yml
mkdir -p data
```

루트 `.env`를 편집하여 Discord 토큰·애플리케이션 ID와 `MC_BRIDGE_SECRET`을 설정합니다. 공유 시크릿은 충분히 긴 난수로 생성하고, **같은 값**을 플러그인 `config.yml`의 `bot.secret`에도 입력합니다. 템플릿의 `CHANGE_ME`는 실제 시크릿으로 교체해야 합니다. 시크릿과 토큰을 커밋하거나 로그·스크린샷에 남기지 않습니다.

Compose 기본 구성을 사용할 때 연결 주소는 다음과 같습니다.

| 설정 위치 | 항목 | 값 |
|---|---|---|
| 루트 `.env` | `MC_BRIDGE_BASE_URL` | `http://minecraft:8765` |
| 플러그인 `config.yml` | `bot.base-url` | `http://mcbot:47865` |
| 플러그인 `config.yml` | `server.bind` | `0.0.0.0` |
| 플러그인 `config.yml` | `server.port` | `8765` |

컨테이너 내부의 `localhost`는 해당 컨테이너 자신입니다. 다른 컨테이너와 통신할 때는 위 서비스 이름을 사용합니다.

루트 `data/` 소유권은 봇의 실행 UID/GID와 일치해야 합니다. `id -u`, `id -g`로 확인하고 필요하면 루트 `.env`의 `MCBOT_UID`, `MCBOT_GID`를 설정합니다. 기본값은 `1001:1001`입니다. 게임 서버의 `MC_UID`, `MC_GID`는 **`server/.env`에 있는 별도 설정**입니다.

### 3. 게임과 봇 실행

```bash
# 저장소 루트에서 실행
(cd server && ./mc.sh start)
docker compose up -d --build --no-deps mcbot

# 애플리케이션에 슬래시 명령어 등록
bun run minecraft:commands

# 출력된 URL로 봇 초대
bun run invite
```

게임 첫 기동에는 시간이 걸릴 수 있습니다. `server/mc.sh logs -f`에서 기동 로그를 확인합니다. 새 호스트의 Bedrock 접속에는 방화벽과 signaling/TLS 준비도 필요할 수 있으므로 [Bedrock 운영 안내](server/README.md#typescript-discord-봇-연결)를 함께 따릅니다.

### 4. 상태 확인과 로그 채널 지정

```bash
docker compose ps
docker compose logs --tail 50 mcbot
curl -fsS http://127.0.0.1:47865/health
(cd server && ./mc.sh check)
```

정상 상태의 HTTP 응답 예시는 다음과 같습니다.

```json
{"ok":true,"minecraft":true}
```

`ok`는 봇 HTTP 엔드포인트의 응답 상태이고, `minecraft`는 최근 브릿지 상태 확인 결과입니다. 이 응답만으로 Discord 로그인이나 채널 전송 성공을 확인할 수는 없습니다. 봇 로그의 `discord ready`와 실제 채널 전송도 확인합니다.

Discord에서 관리자가 로그를 받을 채널에 `/마크로그설치`를 실행합니다. 설정 완료 메시지와 게임 이벤트가 도착하는지 확인하면 기본 연동이 끝납니다.

## 환경변수와 설정 파일

### 루트 `.env` — Discord 봇

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DISCORD_TOKEN` | 없음 | Discord 봇 로그인에 필요 |
| `DISCORD_APPLICATION_ID` | 없음 | Discord 애플리케이션 ID, 명령어 등록·초대에도 사용 |
| `MC_BRIDGE_SECRET` | 없음 | 필수, 최소 16자. 플러그인의 `bot.secret`과 일치 |
| `MC_BRIDGE_BASE_URL` | `http://minecraft:8765` | 봇이 호출하는 MinecraftBridge 주소 |
| `MC_BOT_PORT` | `47865` | 봇의 HTTP 수신 포트 |
| `SQLITE_PATH` | `data/mcbot.sqlite` | 등록·설정·감사 기록의 SQLite 경로 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `DISCORD_DISABLED` | 미설정 | `1` 또는 `true`이면 Discord 연결을 생략 |
| `MCBOT_UID` / `MCBOT_GID` | `1001` / `1001` | Compose가 사용하는 봇 실행 UID/GID |

Discord 토큰 또는 애플리케이션 ID가 비어 있으면 Discord 연결 없이 브릿지 엔드포인트만 실행됩니다. 이 모드에서도 브릿지 시크릿은 필요하며, Discord 로그 메시지는 전송되지 않습니다.

기본 포트를 변경할 때는 `.env`뿐 아니라 Compose의 포트 매핑·healthcheck와 플러그인의 `bot.base-url`도 함께 맞춰야 합니다. 현재 Compose는 `47865`를 명시하고 있습니다. SQLite 경로를 바꾸면 새 경로가 영속 볼륨 안에 있는지도 확인합니다.

### 게임 서버와 플러그인 설정

| 파일 | 용도 |
|---|---|
| `server/.env` | Paper 버전·빌드·해시, Java 메모리, 접속 상한, 백업 등 |
| `server/data/plugins/MinecraftBridge/config.yml` | 공유 시크릿, 봇 주소, 브릿지 수신 주소·포트, 큐·타임아웃 |
| `server/data/plugins/Geyser-Spigot/config.yml` | Bedrock 접속·signaling 설정 |
| `server/data/plugins/floodgate/config.yml` | Bedrock 인증·계정 연결 설정 |
| `server/secrets/rcon_password` | RCON 비밀번호 |

`server/.env.example`과 루트 `.env.example`은 서로 다른 용도의 템플릿입니다. 실제 시크릿 파일은 Git에서 제외되며 권한 `600`으로 보관합니다. Floodgate의 `key.pem`도 비밀 키입니다.

## Discord 명령어

명령어는 Discord 서버 안에서 사용합니다. 아래의 관리자는 Discord **Administrator 권한**을 가진 멤버를 의미합니다.

| 명령어 | 권한 | 사용법·동작 |
|---|---|---|
| `/유저등록` | 모든 멤버 | `마크아이디:`에 Java 이름 입력 → 미리보기 → 확인 후 등록 |
| `/유저등록베드락` | 모든 멤버 | `마크아이디:`에 Xbox 게이머태그 입력 → 확인 후 등록 |
| `/유저해제` | 모든 멤버 | 본인의 계정 연결 해제 및 화이트리스트 제거 |
| `/마크리더보드` | 모든 멤버 | 해당 Discord 서버의 등록자 플레이타임 순위, 페이지 이동 지원 |
| `/마크로그설치` | 관리자 | 현재 채널을 해당 Discord 서버의 게임 로그 채널로 지정 |
| `/유저조회` | 관리자 | `유저:`로 대상 지정, 생략하면 본인 조회 |
| `/유저목록` | 관리자 | 해당 Discord 서버의 등록 목록 조회 |
| `/유저강제해제` | 관리자 | `유저:`로 지정한 다른 사용자의 연결 해제 |
| `/화이트리스트동기-sync` | 관리자 | 실행한 Discord 서버의 DB 등록 목록을 기준으로 게임 화이트리스트 조정 |

등록은 화이트리스트 추가 후 DB에 저장하며, DB 저장 실패 시 화이트리스트 변경을 되돌리도록 처리합니다. 해제도 화이트리스트 제거 실패 시 DB 등록을 복구하도록 처리합니다. 실패 메시지가 나오면 현재 등록과 화이트리스트 상태를 확인한 뒤 다시 시도합니다.

**화이트리스트 동기화는 조회 명령이 아닙니다.** DB에만 있는 항목을 추가하고 화이트리스트에만 있는 항목을 제거합니다. 현재 구현은 전체 Discord 서버의 합집합이 아니라 **명령을 실행한 Discord 서버의 등록 목록**을 기준으로 합니다. 여러 Discord 서버에서 등록을 받거나 콘솔로 별도 허용한 플레이어가 있다면 그 항목이 제거될 수 있으므로, 실행 전에 대상과 백업을 확인하세요.

### 명령어 등록과 코드 배포의 차이

```bash
# 저장소 루트에서 실행: 봇이 속한 모든 서버용 전역 명령어 등록
bun run minecraft:commands

# 개발 시 특정 서버에만 명령어 등록: 숫자 ID를 실제 Discord 서버 ID로 교체
bun run minecraft:commands 123456789012345678
```

봇 시작은 명령어 등록을 자동으로 실행하지 않습니다. 명령어 이름·옵션이 바뀌었을 때 등록 스크립트를 별도로 실행합니다. 전역 명령어는 Discord 반영을 기다려야 할 수 있습니다. 임베드 색상이나 문구만 바꾸는 경우 명령어 재등록은 필요하지 않습니다.

등록 스크립트는 해당 애플리케이션·범위의 명령어 목록을 저장소 정의로 교체합니다. 다른 서비스에서 사용하는 애플리케이션을 공유하지 않습니다.

## Java·Bedrock 계정 등록

### Java 플레이어

1. Discord에서 `/유저등록 마크아이디:Java이름`을 실행합니다.
2. 미리보기의 계정 이름과 에디션을 확인한 뒤 등록을 확정합니다.
3. 서버 주소 `<공개 IP 또는 도메인>:25565`로 접속합니다.

등록 확인 요청은 5분 뒤 만료됩니다. 봇이 재시작된 경우에도 진행 중 요청이 사라지므로 명령어를 다시 실행합니다.

### Java 계정과 연결하지 않은 Bedrock 플레이어

1. `/유저등록베드락 마크아이디:Xbox게이머태그`를 실행합니다.
2. 계정을 확인하고 등록을 확정합니다.
3. Bedrock에서 같은 서버 주소와 포트 `19132`로 접속합니다.

Xbox 조회가 503 등으로 실패하면 Bedrock 앱에서 **먼저 서버 접속을 시도한 뒤 30분 안에** 등록 명령어를 다시 실행합니다. 화이트리스트로 입장이 거절되더라도 브릿지가 인증된 UUID/XUID를 봇에 전달하면 외부 Xbox 조회 없이 등록할 수 있습니다. 이 임시 인증 캐시는 봇 재시작 시 사라집니다.

### Java 캐릭터를 Bedrock에서도 사용하는 경우

Floodgate Global Linking으로 두 계정을 연결한 사용자는 `/유저등록`에 **Java 이름**을 입력합니다. 이미 Java 이름이 등록되어 있으면 다시 등록하지 않습니다. Microsoft 계정이 같아도 Global Linking은 별도로 필요합니다.

연결하면 Java UUID에 해당하는 인벤토리·위치·도전과제를 사용합니다. 기존 Bedrock 아이템과 자동 합쳐지지 않으며, 기존 Bedrock 데이터는 연결을 해제할 때까지 접근할 수 없습니다. 연결 절차와 데이터 주의사항은 [서버 운영 안내](server/README.md#typescript-discord-봇-연결)를 따릅니다.

## 게임 로그의 표시 방식

| 이벤트 | Discord 표시 | 색상·내용 |
|---|---|---|
| 접속 | 임베드 | 초록색 `#57F287`, 접속 안내 한 줄 |
| 퇴장 | 임베드 | 회색 `#99AAB5`, 퇴장 안내 한 줄 |
| 사망 | 임베드 | 빨간색 `#ED4245`, 한국어 사망 문구와 유효한 사망 횟수 |
| 도전과제 | 임베드 | **초록색 `#57F287`**, 달성 안내와 도전과제 이름 |
| 공개 채팅 | 일반 텍스트 | `닉네임 (마크이름): 채팅 내용` |

플레이어 표시는 가능한 경우 `Discord 닉네임 (마크이름)` 형식을 사용하고, 등록 정보가 없으면 마크 이름으로 표시합니다. Discord 이름과 마크 이름이 같으면 중복 표기를 생략합니다.

도전과제 이름은 저장소에 포함된 **Minecraft 26.3 공식 한국어 번역 126개**를 ID로 조회합니다. 설명은 표시하지 않습니다. 번역 목록에 없는 커스텀 도전과제는 플러그인이 전달한 이름을 유지합니다.

공개 채팅은 명령어·취소된 채팅을 제외하며 Discord 멘션 알림을 차단합니다. 사망 로그에는 좌표·월드·바이옴을 포함하지 않습니다. 현재 이벤트 처리기는 서버 상태 이벤트를 수신하더라도 시작·종료 알림을 Discord에 전송하지 않습니다.

### 여러 Discord 서버로 전송

- 각 Discord 서버에서 관리자가 `/마크로그설치`를 실행하면 설정된 모든 서버로 게임 로그를 전송합니다.
- 플레이어가 등록되어 있지 않아도 로그를 전송합니다.
- 여러 서버에 등록된 플레이어는 수신 서버의 등록 정보를 우선 사용합니다. 수신 서버에 등록이 없으면 다른 등록 서버의 닉네임을 사용할 수 있습니다.
- 서버별 로그 채널은 하나이며, 다른 채널에서 `/마크로그설치`를 다시 실행하면 변경됩니다.
- 게임 채팅과 다른 서버에서 등록한 닉네임이 공유될 수 있으므로, 함께 로그를 받을 Discord 서버의 범위를 운영자가 정합니다.

## 운영과 업데이트

### Discord 봇만 재빌드·적용하기 — 게임 서버 유지

임베드 색상·문구·봇 로직 등 **`src/`의 변경만 적용할 때** 사용합니다. 저장소 루트에서 실행합니다.

```bash
# 변경 범위에 맞는 검증
bun run typecheck
bun test test/embeds.test.ts test/events.test.ts

# 게임 서버의 컨테이너 ID·기동 시각·재시작 횟수 확인
docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' minecraft

# Discord 봇 서비스만 이미지 빌드 및 컨테이너 교체
docker compose up -d --build --no-deps mcbot

# 봇 상태와 Discord 로그인 확인
docker compose ps mcbot
docker compose logs --tail 50 mcbot
curl -fsS http://127.0.0.1:47865/health

# 적용 전과 같은 ID·기동 시각인지 비교
docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' minecraft
```

루트 Compose의 `mcbot` 서비스만 대상으로 지정하므로 게임·백업 컨테이너는 재생성하지 않습니다. 봇 컨테이너를 교체하는 동안에는 Discord 명령과 로그 연동이 잠시 중단될 수 있습니다. 플러그인의 이벤트 재시도·큐에는 한도가 있으므로 로그의 무손실 전송까지 보장하지는 않습니다.

이미지는 현재 작업 폴더의 `src/`를 복사하므로, 커밋되지 않은 다른 봇 코드 변경도 함께 포함됩니다. `git status --short`로 배포할 변경을 확인합니다. `.env`만 수정한 경우에도 컨테이너에 반영하려면 `up -d --no-deps mcbot`으로 다시 적용합니다.

**봇만 바꿀 때 `server/mc.sh restart`는 필요하지 않습니다.** 문서만 수정한 경우에도 재빌드나 재시작은 필요하지 않습니다.

### MinecraftBridge 플러그인 변경

플러그인 JAR를 바꿨다면 봇 재빌드만으로 적용되지 않습니다. 게임 백업과 접속자 안내 후 서버를 정지하고 새 JAR를 배치한 뒤 시작합니다. 이 작업은 플레이어 접속을 끊습니다.

```bash
# 저장소 루트에서 실행
bun run minecraft:test
bun run minecraft:build-plugin
(cd server && ./mc.sh backup)
(cd server && ./mc.sh stop)
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
(cd server && ./mc.sh start && ./mc.sh check)
```

Paper·Geyser·Floodgate 버전 변경이나 기존 월드 이전은 [서버 업데이트 절차](server/README.md#기존-leaf-이전업데이트)를 따릅니다. 월드를 새 버전에서 연 뒤에는 이전 버전으로 안전하게 되돌릴 수 없습니다.

### 자주 사용하는 상태 확인

```bash
# 저장소 루트: Discord 봇
docker compose ps
docker compose logs --tail 100 -f mcbot

# 게임 서버: 각 명령은 server/에서 실행
cd server
./mc.sh status
./mc.sh players
./mc.sh tps
./mc.sh mspt
./mc.sh logs -f
```

게임·봇의 `restart: unless-stopped`는 오류 종료와 Docker 재부팅 시의 재시작 정책입니다. healthcheck가 실패했다는 이유만으로 컨테이너를 자동 재시작하지는 않습니다.

## 데이터와 백업

| 경로 | 데이터 | 게임 자동 백업에 포함 |
|---|---|---|
| 루트 `data/` | 봇 SQLite와 관련 파일 | 아니요 |
| 루트 `.env` | Discord 토큰, 공유 시크릿, 봇 설정 | 아니요 |
| `server/data/` | 월드, 플레이어, 화이트리스트, 서버·플러그인 설정 | 포함, JAR·로그·캐시 등은 제외 |
| `server/.env` | 게임 버전·메모리·백업 설정 | 아니요 |
| `server/secrets/` | RCON·인증서 관련 시크릿 | 아니요 |
| `server/backups/` | 게임 압축 백업 | 백업 결과 저장 위치 |

게임 자동 백업은 첫 시작 후 약 3분 뒤, 이후 24시간 간격으로 실행되며 고정 시각 예약은 아닙니다. RCON을 이용해 저장을 제어하고, 압축 후 무결성을 검증합니다. 공간이 부족하거나 검증이 실패하면 백업 로그를 확인합니다.

게임 백업·복원 명령과 백업 제외 항목은 [백업과 복구](server/README.md#백업과-복구)를 따릅니다. 봇 DB와 `.env`·시크릿은 별도로 안전하게 백업해야 합니다. 게임 백업에도 플러그인의 공유 시크릿이 포함될 수 있으므로 백업 파일을 공개하지 않습니다.

SQLite를 단순 파일 복사로 보관하려면 **봇을 정상 정지한 상태에서 루트 `data/` 전체를 복사한 뒤 봇만 다시 시작**합니다. 실행 중 `mcbot.sqlite` 하나만 복사하면 WAL에 남은 변경을 놓칠 수 있습니다. 봇 정지는 게임 서버를 정지하지 않지만 그동안 Discord 연동은 중단됩니다.

복구 전에는 현재 데이터도 별도로 보관하고, 게임 데이터와 봇 등록 정보가 같은 시점인지 확인합니다. 복구 직후 동기화 명령부터 실행하면 의도하지 않은 화이트리스트 삭제가 발생할 수 있습니다.

## 문제 해결

| 증상 | 확인 순서 |
|---|---|
| 봇이 Discord에 로그인하지 않음 | 루트 `.env`의 토큰·애플리케이션 ID, `DISCORD_DISABLED`, `docker compose logs mcbot` 확인 |
| 슬래시 명령어가 보이지 않음 | 올바른 애플리케이션을 초대했는지, 명령어 등록 스크립트를 실행했는지, 전역 반영 대기·서버 명령 사용 권한 확인 |
| 관리자 명령을 실행할 수 없음 | 실행자의 Discord Administrator 권한 확인 |
| `minecraft:false` | 게임 healthy 여부, MinecraftBridge 로딩 로그, 양쪽 `mc-discord` 연결, `MC_BRIDGE_BASE_URL` 확인 |
| 상태 확인은 되지만 등록 요청이 인증 실패 | 봇 `MC_BRIDGE_SECRET`과 플러그인 `bot.secret`이 같은지 확인. 설정값 자체는 로그에 출력하지 않음 |
| 로그가 오지 않음 | `/마크로그설치`, 채널 보기·메시지 보내기·링크 임베드 권한, Discord 로그인과 플러그인의 봇 주소 확인 |
| 도전과제가 계속 노란색임 | 루트에서 봇만 재빌드했는지, 새 봇 컨테이너가 실행 중인지 확인. 이미 전송된 메시지는 색상이 자동으로 바뀌지 않음 |
| SQLite 쓰기 권한 오류 | 루트 `data/` 소유권과 `MCBOT_UID`·`MCBOT_GID`, 영속 경로 확인 |
| Bedrock Xbox 조회가 503 | 게임 접속을 먼저 시도한 후 30분 안에 재등록. 봇을 재시작했다면 접속 시도도 반복 |
| Bedrock만 접속 실패 | Geyser·Floodgate 로딩, 클라이언트 호환 버전, TCP·UDP 19132, signaling/TLS 설정 확인 |
| 봇 적용 후 진행 중 등록 버튼이 만료됨 | 등록 대기 정보는 메모리에 있으므로 등록 명령어를 다시 실행 |

상태 확인에 사용할 수 있는 명령입니다.

```bash
# 저장소 루트에서 실행
docker compose ps mcbot
docker compose logs --tail 100 mcbot
docker inspect -f '{{.State.Health.Status}}' minecraft
docker network inspect mc-discord
curl -fsS http://127.0.0.1:47865/health
```

공개 접속에는 호스트 방화벽과 클라우드 방화벽 양쪽에서 Java TCP 25565 및 Bedrock TCP·UDP 19132를 확인합니다. RCON 25575와 플러그인 8765는 외부에 게시하지 않습니다. 봇 47865는 호스트의 `127.0.0.1`에만 바인딩합니다. Bedrock TLS 인증서 갱신에 사용하는 TCP 80과 타이머는 [서버 운영 안내](server/README.md#typescript-discord-봇-연결)를 참고하세요.

## 개발과 검증

```bash
# 저장소 루트에서 실행
bun install --frozen-lockfile
bun run typecheck
bun test

# 브릿지 Java 테스트와 JAR 빌드
bun run minecraft:test
bun run minecraft:build-plugin
```

빠르게 임베드와 로그 전달만 확인할 때는 다음을 사용합니다.

```bash
bun test test/embeds.test.ts test/events.test.ts
```

로컬 실행은 `bun run start`, 파일 변경 감시는 `bun run dev`입니다. 로컬 프로세스는 Docker 서비스 이름 `minecraft`를 기본적으로 해석할 수 없으므로, 로컬 개발 환경에 맞는 브릿지 접근 경로와 플러그인의 봇 주소를 별도로 준비해야 합니다. 운영 브릿지 포트를 외부에 공개하여 해결하지 않습니다.

`DISCORD_DISABLED=1 bun run start`로 Discord Gateway 없이 실행할 수 있습니다. 이 모드는 실제 Discord 전송 확인을 대신하지 않습니다. 운영 봇과 같은 포트·DB를 사용하는 로컬 프로세스를 동시에 띄우지 않습니다.

MinecraftBridge는 Paper `1.21.11` API와 JDK 21로 컴파일하며, 게임은 Java 25 이미지에서 실행합니다. Java 테스트·빌드 성공과 실제 Paper 26.3에서의 플러그인 로딩 확인은 별도 검증입니다. 컨테이너 health, 실제 등록·접속, Discord 메시지 수신까지 확인해야 운영 연동을 검증할 수 있습니다.

## 폴더와 참고 문서

```text
mcbot/
├─ src/                       # Discord 봇·브릿지 클라이언트·SQLite 처리
│  ├─ bridge/                 # HTTP 인증·이벤트 스키마·Ops 클라이언트
│  ├─ core/                   # 공통 유틸리티
│  ├─ db/                     # DB 스키마·마이그레이션·저장소
│  ├─ discord/                # 상호작용·응답 처리
│  ├─ minecraft/              # 등록·플레이타임·로그·임베드
│  │  └─ commands/            # 슬래시 명령어 정의
│  └─ scripts/                # 명령어 등록·초대 URL
├─ test/                      # Bun 테스트
├─ minecraft-bridge/           # Java 플러그인·Gradle 빌드·Java 테스트
├─ server/                    # 게임·백업 Compose와 운영 스크립트
├─ docs/                      # 브릿지 통합 명세
├─ data/                      # 봇 런타임 데이터, Git 제외
├─ .env.example               # 봇 환경변수 템플릿
├─ compose.yaml               # Discord 봇 서비스
└─ Dockerfile                 # Discord 봇 이미지
```

| 문서 | 내용 |
|---|---|
| [서버 운영 안내](server/README.md) | 게임 설치, Bedrock·Global Linking·TLS, 성능 분석, 청크 사전 생성, 백업·복구·업데이트 |
| [구축 검증 기록](server/VALIDATION.md) | 당시 수행한 실제 기동·연동·백업·복원 결과 |
| [Minecraft 통합 명세](docs/minecraft-integration.md) | 브릿지 이벤트·Ops·인증·오류 처리와 검증 기록 |
| [봇 환경변수 템플릿](.env.example) | 루트 `.env` 작성 기준 |
| [게임 환경변수 템플릿](server/.env.example) | `server/.env` 작성 기준 |
| [플러그인 설정 템플릿](minecraft-bridge/src/main/resources/config.yml) | MinecraftBridge 연결·큐·타임아웃 기본값 |

통합 명세의 Leaf·Bedrock 실측 항목과 구축 검증 기록은 해당 시점의 기록입니다. 현재 호스팅 설정은 `server/`의 파일을 기준으로 확인합니다.
