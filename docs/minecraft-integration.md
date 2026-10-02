# Minecraft 통합 (Discord 봇 ↔ Minecraft 서버)

작성 기준: 2026-10-02 · 대상 서버 `~/minecraft` (Leaf 1.21.11 #179, Java 21, Geyser + Floodgate)

---

## 1. 아키텍처

```
┌────────────────────────┐
│ Discord                │  slash command / 로그 채널 embed
└───────────┬────────────┘
            │ discord.js (Gateway + REST)
┌───────────▼────────────┐   POST /bridge/events   ┌─────────────────────────────┐
│ mcbot (bun)            │ ───────────────────────▶│ minecraft (Leaf/Paper)      │
│  bridge server         │   Authorization:        │  MinecraftBridge 플러그인    │
│  :47865                │   Bearer <시크릿>        │  0.0.0.0:8765              │
│  GET  /health          │ ◀───────────────────────│  GET  /health              │
│  POST /bridge/events   │   POST /ops (8개 타입)   │  POST /ops                 │
└────────────────────────┘                         └─────────────────────────────┘
        외부 Docker 네트워크 `mc-discord` (포트 호스트 미게시)
```

- 양방향 모두 **공유 시크릿** `MC_BRIDGE_SECRET` 로 인증 (`Bearer` 또는 `X-Bridge-Secret`).
  타이밍 안전 비교, 실패 401. 봇 컨테이너는 `127.0.0.1:47865` 에만 게시.
- 플러그인은 **Paper 이벤트**만 사용합니다 (`latest.log` tail, Docker 로그, RCON, `/list` 주기 실행 없음).
  RCON 은 백업 전용입니다.
- 봇은 Discord 토큰 없이도 브릿지만으로 기동합니다 (연결 확인·로그 검증용).

### 이벤트 (플러그인 → 봇, `POST /bridge/events`)

| type | payload |
|---|---|
| `player.join` | `player{uuid, username, edition, xuid}` |
| `player.quit` | `player`, `reason` |
| `player.death` | `player`, `message`, `cause`, `killer` |
| `player.advancement` | `player`, `advancement{key,title,description,frame}` |
| `server.status` | `started`\|`stopped`, `online`, `max`, `players[]` |

공통: `eventId`(UUID), `ts`. 좌표/월드/바이오는 넣지 않습니다 (사양 무필드 + `Validation.sanitizeText` 좌표 패턴 제거).
수락 시 봇 로그에 `bridge event accepted` 가 남습니다.

### Ops (봇 → 플러그인, `POST /ops`)

허용 타입은 8개뿐입니다 (`Ops.fromWire` → `Optional<Ops>`). 임의 command 는 400.

| op | 요청 | 응답 |
|---|---|---|
| `whitelistAddJava` | `uuid`, `username` | `{ok, applied}` |
| `whitelistRemoveJava` | `uuid`, `username` | `{ok, applied}` |
| `whitelistAddBedrock` | `gamertag`, `xuid` | `{ok, applied}` |
| `whitelistRemoveBedrock` | `gamertag`, `xuid` | `{ok, applied}` |
| `getWhitelist` | – | `{entries:[{uuid,name,edition}]}` |
| `getPlaytime` | `uuid` | `{uuid, seconds, ticks, source}` |
| `getOnlinePlayers` | – | `{players:[...]}` |
| `getStatus` | – | `{ok, online, max, version, whitelistEnabled, enforceWhitelist}` |

실패 시 HTTP 502 + `{ok:false, applied:false, reason}`. 파싱 불가는 400, 인증 실패 401.

---

## 2. 화이트리스트 규칙

- 서버는 `ENABLE_WHITELIST=true` (itzg 이미지 환경변수) → `white-list=true`, `enforce-whitelist=true`.
  `WHITELIST` 목록 환경변수는 **설정하지 않습니다** (봇이 관리, 매 시작 재동기화 방지).
- **Java**: `whitelist add/remove <name>` 콘솔 디스패치 → 실패 시
  `OfflinePlayer.setWhitelisted` → 항상 `getWhitelistedPlayers()` 로 결과 검증.
- **Bedrock**: `fwhitelist add/remove "<gamertag>"` (Floodgate).
  Floodgate 는 **Xbox 글로벌 API 로 gamertag 를 검증**하므로 존재하지 않는 gamertag 는 등록 거부(502)됩니다.
  등록된 항목은 `whitelist.json` 에 Floodgate UUID 로 들어오고,
  플러그인은 `00000000-0000-0000-…` UUID 또는 이름으로 존재를 확인합니다.
- 등록 시 화이트리스트 추가 → DB 저장, **DB 실패 시 화이트리스트 롤백**.
  해제는 반대(DB 삭제 → 화이트리스트 제거, 실패 시 재-add 복구).
- 첫 등록 직후 `whitelist.json` 의 `name` 이 `(unknown)` 으로 남을 수 있습니다.
  온라인 모드는 **UUID 기준 매칭**이라 접속에는 영향 없고, 첫 접속 시 서버가 이름을 갱신합니다.

### Floodgate UUID (실측)

`org.geysermc.floodgate.util.Utils.getJavaUuid(long xuid)` = `new UUID(0, xuid)`
→ 문자열 `00000000-0000-0000-<lsb 상위 4 hex>-<lsb 하위 12 hex>`.
xuid ≥ 2^48 이면 4번째 그룹이 `0000` 이 아니므로 판정 prefix 는 **3그룹** `00000000-0000-0000-` 입니다.

```js
// 예: xuid 2535453759792258
"00000000-0000-0000-0009-01fb54b26482"
```

구현: Java `Validation.bedrockUuid` / `Validation.isBedrockUuid`,
TS `src/minecraft/identity.ts` `bedrockUuid` / `isBedrockUuid` (테스트로 고정).

---

## 3. 플레이타임 · 리더보드

- 온라인: `Statistic.PLAY_ONE_MINUTE` (200 tick 스냅샷), 오프라인: `world/stats/<uuid>.json`
  (`minecraft:play_time` 우선, `minecraft:play_one_minute` 폴백). 20 tick = 1초.
- 캐시 TTL 15초 / 최대 256개, 요청 `sync-task-ms` 4초 타임아웃.
- 정렬: seconds desc → ticks desc → `username` asc (`localeCompare`, "en", sensitivity base) → uuid asc.
- 표시: `0분` / `1분 미만` / `N분` / `N시간 N분` / `N일 N시간 N분` (0 은 생략).
- Discord 표시명: `formatMinecraftUser(discord, mc)` = `<Discord> (<MC>)`, 같으면 중복 제거, 멘션 금지.
- 플러그인 시작 시 `playtime api self-check` 로 `PLAY_ONE_MINUTE` 매핑을 실측합니다.

---

## 4. 배포 (실제 수행 명령)

```bash
# 1) 전용 네트워크 (외부, 1회)
docker network create mc-discord

# 2) 게임 서버: compose 에 networks + ENABLE_WHITELIST 추가, 재기동
cd ~/minecraft && ./mc.sh backup && docker compose up -d

# 3) 플러그인 설치 (시크릿은 plugins/MinecraftBridge/config.yml, 600, 소유권 1001)
bun run minecraft:build-plugin
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar ~/minecraft/data/plugins/

# 4) 봇
cd ~/cod/mcbot
docker compose up -d --build
```

시크릿은 `.mc_bridge_secret` (호스트) ↔ `plugins/MinecraftBridge/config.yml` ↔ 봇 `.env`
세 곳에서 동일해야 합니다. 값은 어디에도 출력하지 않습니다.

---

## 5. 검증 기록 (2026-10-02)

| 항목 | 결과 |
|---|---|
| `bun test` | **107 pass / 0 fail** |
| `bunx tsc --noEmit` | 통과 |
| 플러그인 JUnit (`bun run minecraft:test`) | **53 pass / 0 fail**, BUILD SUCCESSFUL |
| `./mc.sh check` (플러그인 설치·화이트리스트 변경 후) | ALL CHECKS PASSED |
| 플러그인 로그 | `MinecraftBridge listening on 0.0.0.0:8765 -> http://mcbot:47865`, `playtime api self-check: ok` |
| 이벤트 수신 | 봇 로그 `bridge event accepted {"type":"server.status","eventId":"765f47f3-…"}` |
| `GET :8765/health` | 200 `{ok, plugin:"MinecraftBridge", version:"1.0.0", minecraft:true}` |
| `GET :47865/health` (호스트) | 200 `{ok:true, minecraft:true}` |
| `/ops` 시크릿 없이 | **401** |
| `getStatus` | `whitelistEnabled:true, enforceWhitelist:true, online:0, max:10, version:"1.21.11-179-…"` |
| `whitelistAddJava` → `getWhitelist` → `whitelistRemoveJava` | 추가/중복/제거 모두 정상, `whitelist.json` 원상복구 |
| `whitelistAddBedrock` (가짜 gamertag) | 502 + reason, 상태 무변경 (Floodgate API 가 검증하는 의도된 동작) |
| `getPlaytime` (미접속 UUID) | `{seconds:0, ticks:0, source:"none"}` |
| `getOnlinePlayers` | `[]` |

---

## 6. 알려진 제약 / 남은 수동 작업

1. **Discord 신규 어플리케이션 생성(사람 수동)**: `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`,
   `MINECRAFT_GUILD_ID` 를 `.env` 에 넣고 `docker compose up -d`,
   `bun run minecraft:commands` 로 슬래시 명령 등록, `bun run invite` 로 초대.
   이전 봇(`giinii_bot`, `bwxi_origin`) 은 건드리지 않습니다.
2. **실접속 검증**: `player.join`/`quit`/`death`/`advancement` 은 온라인 모드 + 유효 계정을
   가진 실제 클라이언트가 필요합니다 (오프라인 인증·목업 접속 금지 정책).
   브릿지 전송 계층 자체는 `server.status` 로 이미 실측 완료했습니다.
3. **Bedrock 등록**: 실재하는 Xbox gamertag 가 필요합니다.
4. 등록 직후 화이트리스트 항목 이름이 `(unknown)` 인 경우 첫 접속 시 갱신됩니다.

## 7. 트러블슈팅

| 증상 | 확인 |
|---|---|
| 봇 `/health` 의 `minecraft:false` | `docker logs minecraft` 에 `MinecraftBridge listening` 인지, `docker network inspect mc-discord` 에 두 컨테이너 모두 속해 있는지 |
| `401` 반환 | `.env` 와 `plugins/MinecraftBridge/config.yml` 의 시크릿이 같은지 (재시작 후 반영) |
| 봇 로그에 `discord disabled` | `.env` 의 `DISCORD_TOKEN`/`DISCORD_APPLICATION_ID` 미입력 (공란=미설정) |
| `fwhitelist … entry was not created` | Floodgate 의 Xbox API 조회 실패 → gamertag 오타/미보유 계정 |
| 이벤트가 중복 전시 | 봇 dedup 3분 TTL + 플러그인 재시도. 핸들러 실패(500)는 dedup 에 남지 않아 재시도가 재처리됨 |
