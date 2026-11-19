# 구축·검증 기록 — Fabric + Cobblemon

검증일: 2026-11-19 (KST). 호스트: Ubuntu 24.04 ARM64, 2 OCPU / 12GB, Docker 29.1.3.
기존 Paper `server/data/`는 없었으므로 새 `data-cobblemon/`을 생성해 검증했습니다.

## 고정 버전

| 항목 | 값 |
|---|---|
| Minecraft / Fabric | 1.21.1 / loader 0.20.1, installer 1.1.2 |
| Cobblemon | 1.8.4+1.21.1, Modrinth `PdOzYHKU` |
| Fabric API | 0.116.18+1.21.1, Modrinth `5SwzqWUu` |
| 서버 이미지 | `itzg/minecraft-server:2026.11.0-java21@sha256:5fbaa7d1eb8d5575cd009c247f872d1fd6b5cd0f096e8ea173648cd4e43d52d4` |
| 백업 이미지 | `itzg/mc-backup:2026.11.0@sha256:a68dee00b2b56bd443bee7d310e5fc49e66682c0d1f4040cda6efa52d8c51df8` |
| Java | 21 |

모드 해시(설치 파일에서 재계산, 공식 SHA512와 일치):

```text
Cobblemon-fabric-1.8.4+1.21.1.jar
  sha256 77c4866b2e4c38afb488ed09b62ffd2729ce291dc793fca9c055c087f0b03978
  sha512 8ba3bc7eb0bb6d52309ca339dfc9fb11adcffebe36d183e0a8df7c8e741edbcbc436c60cc877fd2b42aa224670825cf4f55946676b58ecf0e998f9feae2173c2
  size   139966403

fabric-api-0.116.18+1.21.1.jar
  sha256 1cb46442dda6d3be9979a2619610eb1c1f6641cd7ed7cb3eec058589ce9eed46
  sha512 9f721c253ae2e9823cb548e8ec132c9928f80a65184e9b8dcfc489a8d632df20cbfea1e65ff8a4333bdb295c41fbe2228b43e4d41c7355d42ed4637a785840a1
  size   2453884
```

## 테스트

| 항목 | 결과 |
|---|---|
| `bun install --frozen-lockfile` | 통과 |
| `bun run typecheck` | 통과 |
| `bun test` | 167 pass / 0 fail, 19 파일 |
| Gradle `build` (JUnit) | 64 pass / 0 fail |
| `bash -n install.sh mc.sh backup-space.sh backup-verify.sh` | 통과 |
| `docker compose config -q` | 통과 |
| `./mc.sh verify-mods` | 3개(모드 2 + 브릿지) 통과 |

## 최초 구축 시 기동

- `docker compose up -d` → `minecraft` healthy, `minecraft-backup` running
- 서버 로그: `Starting minecraft server version 1.21.1`, `Done (22.465s)!`
- 브릿지: `MinecraftBridge 1.1.0 listening on 0.0.0.0:8765 -> http://mcbot:47865`
- Fabric: `fabric-server-mc.1.21.1-loader.0.20.1-launcher.1.1.2.jar`
- 메모리: 게임 약 2.2~2.9GiB / 8GiB, 백업 약 10MiB / 512MiB
- `keepInventory`: 세 차원 모두 `true` (RCON startup)
- 최초 구축 시 난이도: `easy`

## 운영 설정 변경 확인

- 난이도를 `peaceful`로 바꾸고 서버를 재시작한 뒤 `server.properties`와 RCON의 `difficulty`로 확인했습니다.
- 오버월드, 네더, 엔드에서 `keepInventory=true`를 RCON으로 확인했습니다.
- Cobblemon 1.8.4의 공식 한국어 제목 61개를 봇에 반영했습니다. 운영 봇 컨테이너에서 `cobblemon:root`의 한국어 제목을 확인했으며, 변경 후 `bun test`는 168개를 통과했습니다.
- `client-v1.1.1`은 GitHub Actions에서 Windows와 macOS 설치·재설치 검증을 통과했습니다.

## 브릿지 API 실측

| 요청 | 결과 |
|---|---|
| `GET /health` | `{"ok":true,"plugin":"MinecraftBridge","version":"1.1.0","minecraft":true}` |
| 무인증 `POST /ops` | 401 `unauthorized` |
| `getStatus` | `online:0, max:1000, version:"1.21.1 (fabric)", whitelistEnabled:true, enforceWhitelist:true` |
| `whitelistAddJava` (Notch UUID) | 200 `{ok:true, applied:true}`, `whitelist.json`에 기록 |
| `getWhitelist` | `[{uuid,name,edition:"JAVA"}]` |
| `whitelistRemoveJava` | 200, `whitelist.json` `[]` 복구 |
| `whitelistAddBedrock` | 501 `bedrock edition is not supported by this server` |
| `getPlaytime` (임시 통계 123400틱) | `{"seconds":6170,"ticks":123400,"source":"file"}` |

이벤트: 임시 `mcbot` 리스너를 `mc-discord`에 붙이고 서버를 재시작해
`server.status` `stopped`/`started`를 Bearer 인증으로 수신했습니다.
`eventId`, `ts`, `online`, `max`, `players` 필드를 확인했습니다.

## 백업·복구

- `./mc.sh backup` → `backups-cobblemon/cobblemon-20261119-164930.tar.zst` (14MiB)
- 아카이브에 `world/` 31개 항목, `config/`, `server.properties`, `whitelist.json` 포함
- 모드 jar는 제외(`.jar` 0개), 복구 시 이전 디렉터리에서 복사
- `./mc.sh restore` → `data-cobblemon.before-restore-20261119-074956/` 보호 사본 생성,
  복구 후 `./mc.sh start` 및 `./mc.sh check` 통과

## 최초 구축 당시 미검증

- 실제 Java 클라이언트 접속과 join/chat/death/advancement 이벤트
- 실제 Discord 토큰으로 게이트웨이·슬래시 명령 실행
- OCI NSG/공인 IP 외부 접속
- 10명 이상 동시 접속, 장시간 TPS/MSPT, GC 정지시간
- 기존 Paper 26.3 월드의 실제 이전(지원하지 않음)
