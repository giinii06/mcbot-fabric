# Minecraft 통합 (Discord 봇 ↔ Fabric 서버)

작성 기준: 2026-11-19 · 대상: Fabric 1.21.1 + Cobblemon 1.8.4, Java 21, Java Edition 전용.

호스팅·백업·포트는 [server/README.md](../server/README.md)를 따릅니다.

## 1. 아키텍처

```
┌────────────────────────┐
│ Discord                │  slash command / 로그 채널
└───────────┬────────────┘
            │ discord.js
┌───────────▼────────────┐   POST /bridge/events   ┌─────────────────────────────┐
│ mcbot (Bun)            │ ───────────────────────▶│ minecraft (Fabric)          │
│  :47865                │   Authorization:        │  MinecraftBridge 모드        │
│  GET /health           │   Bearer <시크릿>        │  0.0.0.0:8765               │
│  POST /bridge/events   │ ◀───────────────────────│  GET  /health               │
└────────────────────────┘   POST /ops              │  POST /ops                  │
        외부 Docker 네트워크 `mc-discord` (포트 호스트 미게시)
```

- 양방향 모두 공유 시크릿 `MC_BRIDGE_SECRET`으로 인증합니다.
  `Authorization: Bearer` 또는 `X-Bridge-Secret`, 타이밍 안전 비교, 실패 401.
- 브릿지는 Fabric 이벤트를 사용합니다. 로그 tail, RCON polling, `/list` 주기 실행은
  사용하지 않습니다. RCON은 백업 전용입니다.
- 모든 게임 상태 접근은 서버 스레드로 위임되고 4초 타임아웃이 적용됩니다.
- 봇은 Discord 토큰 없이도 브릿지 health/이벤트 검증용으로 기동할 수 있습니다.

### 이벤트 (브릿지 → 봇, `POST /bridge/events`)

| type | payload |
|---|---|
| `player.join` | `player{uuid, username, edition, xuid}` |
| `player.quit` | `player` |
| `player.chat` | `player`, `message` (1~1024자, 제어문자 제거) |
| `player.death` | `player`, `message`, `cause`, `killer`, `deathCount` |
| `player.advancement` | `player`, `advancement{key,title,description,frame}` |
| `server.status` | `started`\|`stopped`, `online`, `max`, `players[]` |

공통: `eventId`(UUID), `ts`. 좌표/월드/바이오는 넣지 않습니다.
`player.identity`(Bedrock 인증 이벤트)는 새 서버에서 발생하지 않습니다.

### Ops (봇 → 브릿지, `POST /ops`)

| op | 요청 | 응답 |
|---|---|---|
| `whitelistAddJava` | `uuid`, `username` | `{ok, applied}` |
| `whitelistRemoveJava` | `uuid`, `username` | `{ok, applied}` |
| `whitelistAddBedrock` | – | **501** `bedrock edition is not supported by this server` |
| `whitelistRemoveBedrock` | – | **501** |
| `getWhitelist` | – | `{entries:[{uuid,name,edition}]}` |
| `getPlaytime` | `uuid` | `{uuid, seconds, ticks, source}` |
| `getOnlinePlayers` | – | `{players:[...]}` |
| `getStatus` | – | `{ok, online, max, version, whitelistEnabled, enforceWhitelist}` |

실패: 인증 401, 잘못된 payload 400, 서버 스레드 타임아웃 504, 서버 중지 503,
변경 실패 502 `{ok:false, applied:false, reason}`. 임의 명령 실행 API는 없습니다.

## 2. 화이트리스트

- `ENABLE_WHITELIST=true`, `ENFORCE_WHITELIST=true`.
- 봇이 `/ops`로 Java UUID/이름을 추가·제거합니다.
- 브릿지는 `PlayerManager.getWhitelist()`의 `Whitelist`에 `WhitelistEntry`를
  추가/제거하고 `save()`합니다. `whitelist.json`을 외부에서 덮어쓰지 않습니다.
- `getWhitelist`는 서버 파일에서 UUID/이름을 읽어 `edition`을 계산합니다.
  기존 Bedrock UUID(`new UUID(0,xuid)`)는 `BEDROCK`으로 표시되지만 새 등록은
  거부됩니다.
- 서버가 꺼져 있으면 변경이 실패할 수 있습니다. 기동 후 등록하거나
  `/화이트리스트동기-sync`를 사용하세요.

## 3. 플레이타임

- 온라인: `StatHandler`의 `Stats.PLAY_TIME`을 10초마다 스냅샷.
- 오프라인: `<world>/stats/<uuid>.json`의 `minecraft:play_time`.
- 20 tick = 1초, 캐시 TTL 15초/최대 256개.
- 1.21.1은 `world/stats/`, 최신 형식은 `world/players/stats/`도 인식합니다.

## 4. 배포

```bash
# 1) 네트워크 (1회)
docker network create mc-discord

# 2) 브릿지 빌드
bun run minecraft:build-plugin

# 3) 서버 설치/기동
cd server
cp .env.example .env
./install.sh --no-start
./mc.sh start
./mc.sh check
cd ..

# 4) 봇
cp .env.example .env
# DISCORD_TOKEN, DISCORD_APPLICATION_ID, MC_BRIDGE_SECRET 입력
docker compose up -d --build
```

시크릿은 `server/secrets/bridge_secret` ↔ 루트 `.env`의 `MC_BRIDGE_SECRET`에서
동일해야 합니다. 값은 출력하거나 커밋하지 않습니다.

## 5. 검증 기록 (2026-11-19)

| 항목 | 결과 |
|---|---|
| `bun test` | 167 pass / 0 fail |
| Gradle JUnit | 64 pass / 0 fail |
| 실제 기동 | Fabric 1.21.1 + Cobblemon 1.8.4, `Done (22.465s)!` |
| 브릿지 로그 | `MinecraftBridge 1.1.0 listening on 0.0.0.0:8765` |
| `GET /health` | 200 `{ok:true, plugin:"MinecraftBridge", version:"1.1.0", minecraft:true}` |
| 무인증 `/ops` | 401 |
| `getStatus` | `online:0, max:1000, version:"1.21.1 (fabric)"` |
| 화이트리스트 add/list/remove | `whitelist.json` 반영·원상복구 |
| `getPlaytime` (123400틱 임시 파일) | `6170초, source:"file"` |
| Bedrock op | 501 |
| 이벤트 수신 | `server.status` stopped/started, Bearer 인증 통과 |
| 백업/복구 | zstd 생성·검증, 보호 사본 후 복구 성공 |

미검증: 실제 Java 클라이언트의 join/chat/death/advancement 수신, 실제 Discord
게이트웨이·슬래시 명령 실행, OCI 외부 접속.

## 6. 알려진 제약

1. Discord 애플리케이션 생성, 토큰 입력, 전역 명령 등록은 수동입니다.
2. 실제 플레이어 이벤트는 온라인 모드 + 유효 Java 계정이 필요합니다.
3. Bedrock 접속과 등록은 지원하지 않습니다. 기존 DB 기록은 보존됩니다.
4. 도전과제 이벤트는 Fabric API에 없어 `PlayerAdvancementTracker.grantCriterion`
   Mixin으로 수집합니다. 서버 시작 로그에 Mixin 오류가 없는지 확인하세요.
5. 등록 직후 `whitelist.json`의 이름이 `(unknown)`일 수 있습니다. 온라인 모드는
   UUID 기준이라 접속에 영향이 없고 첫 접속 시 갱신됩니다.

## 7. 트러블슈팅

| 증상 | 확인 |
|---|---|
| 봇 `/health`의 `minecraft:false` | `docker logs minecraft`의 `MinecraftBridge listening`, `docker network inspect mc-discord` |
| 401 | 루트 `.env`와 `server/secrets/bridge_secret` 일치 여부 |
| 503/504 | 서버 스레드 정지/과부하, `docker logs minecraft` 확인 |
| 봇 로그 `discord disabled` | `.env`의 토큰/애플리케이션 ID 미입력 |
| 모드 검증 실패 | `./mc.sh install-mods`, 디스크/다운로드 확인 |
| 이벤트 중복 | 봇 dedup TTL + 브릿지 재시도. 핸들러 실패는 dedup에 남지 않음 |
