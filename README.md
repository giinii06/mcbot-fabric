# mcbot — Minecraft 서버 Discord 봇

Minecraft Java 1.21.11(Leaf) + Bedrock 크로스플레이 서버와 연동하는 Discord 봇.
화이트리스트 등록/해제, 누적 플레이타임 리더보드, 서버 로그 채널, 서버 상태를 제공합니다.

게임 서버와의 통신은 **별도 플러그인 `MinecraftBridge`**(자바, `minecraft-bridge/`)가 담당하며,
양쪽은 전용 Docker 네트워크 `mc-discord` 위에서 공유 시크릿으로 인증합니다.

상세 규약·배포·검증 기록은 [`docs/minecraft-integration.md`](docs/minecraft-integration.md) 참조.

## 구조

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

## 디렉터리

| 경로 | 내용 |
|---|---|
| `src/` | 봇 소스 (env, db, bridge, minecraft 도메인, discord, commands) |
| `test/` | bun 테스트 (107 케이스) |
| `minecraft-bridge/` | Paper 플러그인 (Gradle, JUnit 53 케이스) |
| `docs/` | 통합 문서 |
| `Dockerfile`, `compose.yaml` | 컨테이너 배포 |

## 개발

```bash
bun install
bun run typecheck        # tsc --noEmit
bun test                 # 단위/통합 테스트
bun run minecraft:test   # 플러그인 JUnit (bash minecraft-bridge/test.sh)
bun run minecraft:build-plugin   # 플러그인 JAR 빌드
```

## 설정

1. `.env.example` 을 `.env` 로 복사 (`chmod 600 .env`).
2. `MC_BRIDGE_SECRET` 채우기 (이미 `.mc_bridge_secret` 에 생성되어 있음).
   같은 값을 플러그인 `plugins/MinecraftBridge/config.yml` 에 넣어야 합니다.
3. Discord 신규 어플리케이션 생성 후 채울 값:
   `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `MINECRAFT_GUILD_ID`.
4. 슬래시 명령 등록: `bun run minecraft:commands`
5. 서버 초대: `bun run invite`

## 배포

```bash
docker network create mc-discord     # 1회
docker compose up -d --build          # 봇 (Discord 미설정이어도 브릿지만 뜸)
docker compose logs -f
```

Discord 값이 채워지지 않았으면 봇은 브릿지 엔드포인트만 열고 로그에
`discord disabled` 경고를 남깁니다. 값 채우고 `docker compose up -d` 재시작하면 그때 연결됩니다.

게임 서버 쪽 준비(이미 완료됨)는 `/home/ubuntu/minecraft/README.md` 의
「Discord 봇 연동」 절을 참조하세요.

## 명령어

| 명령 | 권한 | 설명 |
|---|---|---|
| `/유저등록 마크아이디:` | 모든 멤버 | Java/Bedrock 계정 연결 (화이트리스트 추가 → DB 저장, 실패 시 롤백) |
| `/유저해제` | 모든 멤버 | 본인 연결 해제 (DB 삭제 → 화이트리스트 제거, 실패 시 복구) |
| `/마크리더보드` | 모든 멤버 | 누적 플레이타임 TOP (정렬: 시간 → 이름 → UUID) |
| `/마크로그설치` | 관리자 | 현재 채널을 로그 채널로 지정 |
| `/유저조회 유저:` | 관리자 | 등록 정보 조회 (생략 시 본인) |
| `/유저목록` | 관리자 | 전체 등록 목록 |
| `/유저강제해제 유저:` | 관리자 | 다른 사용자 연결 해제 |
| `/화이트리스트동기-sync` | 관리자 | DB ↔ 화이트리스트 재동기화 |

## 보안

- 플러그인에 **Discord 토큰 없음**. 인증은 `MC_BRIDGE_SECRET` 단일 시크릿.
- 브릿지는 8개 타입만 허용 (`src/bridge/protocol.ts`), 임의 command 금지.
- 봇 포트는 `127.0.0.1` 에만 게시, 플러그인 포트는 호스트 미게시.
- `.env` / `.mc_bridge_secret` 은 git ignore 대상 (600 권장).
