# mcbot — Paper 서버 + TypeScript Discord 봇

Oracle ARM64 2 OCPU / 12GB용 **Paper 26.3 #205 / Java 25 / Java 정품 10인 생존** 서버와
화이트리스트·플레이타임·로그 채널을 관리하는 Bun/TypeScript Discord 봇입니다.
게임 호스팅 설정과 운영 절차는 [server/README.md](server/README.md)를 따릅니다.
실제 기동·연동·백업·복원 결과는 [구축 검증 기록](server/VALIDATION.md)에 있습니다.

```text
Discord ←→ mcbot:47865 ←→ MinecraftBridge:8765 (private mc-discord network)
                            ↓
                    Paper:25565 (public TCP)
```

| 항목 | 값 |
|---|---|
| 게임 | Paper 26.3 STABLE #205, survival, peaceful(고정), PvP, max 10 |
| 런타임 | itzg/minecraft-server:java25, ARM64 지원 |
| 자원 | Xms 2G / Xmx 6G, 게임 메모리 상한 8g·2 CPU |
| 거리 | view 6 / simulation 4 |
| 백업 | 24시간 간격, zstd 단일 스레드, 7일 보관, 공간·무결성 검사 |
| 인증 | online-mode + whitelist + enforce-whitelist |
| 플러그인 | MinecraftBridge, 필요 시 Chunky 1.5.3, Paper 내장 Spark |
| 포트 | 공개 TCP 25565; 봇 47865는 loopback, 브릿지·RCON은 미게시 |

Bedrock 호스팅 플러그인과 UDP 공개는 제거했습니다. 봇의 기존 Java/Bedrock API 및 데이터 형식은
유지하며, 이 서버에서는 Java 등록을 사용합니다. 기존 Bedrock 등록 데이터는 삭제하지 않습니다.
브릿지는 인원수나 keepInventory를 강제하지 않습니다. 기존 월드 규칙은 보존합니다.
마크의 일반 공개 채팅은 `/마크로그설치`로 지정한 Discord 로그 채널에 일반 텍스트 메시지로
`닉네임 (마크이름): 채팅 내용`으로 표시됩니다. 명령어·취소된 채팅은 전송하지 않으며 멘션 알림은 차단합니다.
도전과제 이름은 Minecraft 26.3 공식 한국어 번역(기본 126개)을 사용하며 설명은 표시하지 않습니다.
번역 목록에 없는 도전과제는 서버가 제공한 이름을 유지합니다.

## 빠른 시작

```bash
bun install --frozen-lockfile
cd server
./install.sh --no-start
cd ..
bun run minecraft:build-plugin
mkdir -p server/data/plugins
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
cp .env.example .env
chmod 600 .env
```

루트 `.env`에 `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `MC_BRIDGE_SECRET`을 입력합니다.
동일한 공유 시크릿을 `server/data/plugins/MinecraftBridge/config.yml`의 `bot.secret`에 설정합니다.
템플릿은 `minecraft-bridge/src/main/resources/config.yml`이며 실제 파일은 600 권한으로 보관합니다.
`MC_BRIDGE_BASE_URL=http://minecraft:8765`, `bot.base-url: http://mcbot:47865`를 사용합니다.
토큰·시크릿은 커밋하거나 로그에 출력하지 마세요.

```bash
cd server && ./mc.sh start && cd ..
mkdir -p data
# 필요 시 루트 .env의 MCBOT_UID/MCBOT_GID를 현재 id -u/id -g에 맞춤
# ./data 소유권과 compose user가 일치해야 SQLite 기록 가능
docker compose up -d --build
bun run minecraft:commands
bun run invite
curl -fsS http://127.0.0.1:47865/health
cd server && ./mc.sh check
```

Discord 자격 증명이 비어 있으면 봇은 브릿지만 기동합니다. 성공 시 health의 `minecraft:true`를 확인합니다.
EULA에 동의하는 운영자가 설치해야 하며 Compose는 `EULA=TRUE`로 서버를 실행합니다.
기존 Leaf 월드가 있으면 [이전 절차](server/README.md#기존-leaf-이전업데이트)를 먼저 확인하세요.

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

## 개발·검증

```bash
bun test
bun run typecheck
bun run minecraft:test
bun run minecraft:build-plugin
```

봇 코드는 `src/`, 테스트는 `test/`, 브릿지는 `minecraft-bridge/`에 있습니다.
플러그인은 기존 Paper 1.21.11 API / JDK 21로 컴파일하여 Java 25 서버에서 실행합니다.
실제 Paper 26.3 로딩 여부는 운영 점검에서 따로 확인합니다.

`MCBOT_UID`/`MCBOT_GID`는 호스트 data 소유권과 일치시킵니다(기본 1001:1001).
봇 `.env`의 `SQLITE_PATH=data/mcbot.sqlite`, `MC_BOT_PORT=47865`, `LOG_LEVEL=info` 기본값을 사용할 수 있습니다.
Discord 없이 개발할 때는 `DISCORD_DISABLED=1`을 설정합니다.
공유 네트워크 `mc-discord`는 서버 설치기가 준비합니다.

브릿지 이벤트·Ops 명세는 [docs/minecraft-integration.md](docs/minecraft-integration.md)에 있습니다.
그 문서의 Leaf/Bedrock 실측 기록은 이전 구성의 기록이며 현재 호스팅 사양은 `server/`를 기준으로 합니다.
