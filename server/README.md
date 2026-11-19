# 서버 운영 — Fabric 1.21.1 + Cobblemon 1.8.4

`server/`는 Docker Compose로 게임 서버(`minecraft`)와 백업 사이드카
(`minecraft-backup`)를 운영합니다. Java Edition 전용이며 Bedrock/Geyser/Floodgate는
포함하지 않습니다.

## 파일과 디렉터리

| 경로 | 내용 |
|---|---|
| `compose.yaml` | 게임/백업 서비스, 포트, 자원 제한 |
| `.env.example` | 고정 버전, 메모리, 백업 설정 |
| `mods.lock.json` | Cobblemon/Fabric API 버전·URL·SHA256·SHA512 |
| `install.sh` | 설치, 시크릿 생성, 모드 설치, 기존 Paper 월드 감지 |
| `mc.sh` | start/stop/check/backup/restore/모드 관리 |
| `backup-space.sh`, `backup-verify.sh` | 백업 전 공간 검사, 후 무결성 검사 |
| `data-cobblemon/` | Fabric 서버 데이터 (월드, config, 모드, Cobblemon 데이터) |
| `backups-cobblemon/` | zstd 백업 |
| `secrets/rcon_password`, `secrets/bridge_secret` | 600 권한 시크릿 |
| `data/` | **기존 Paper 데이터. 이 스택은 읽거나 수정하지 않음** |

## 설치

```bash
cd server
cp .env.example .env
./install.sh --no-start
./mc.sh start
./mc.sh logs -f      # Done (...)! 확인
./mc.sh check
```

`install.sh`는 `data/level.dat`가 있으면 Paper 26.3 월드로 판단하고 중단합니다.
새 Cobblemon 월드를 명시적으로 만들려면 `--new-world`를 추가합니다. 이때도
`data/`는 그대로 둡니다.

### 모드

```bash
./mc.sh install-mods   # lock 파일의 모드 + 브릿지 jar 설치, 해시 검증
./mc.sh verify-mods    # 파일 크기/SHA256/SHA512/fabric.mod.json 검증
```

`MODRINTH_PROJECTS`는 사용하지 않습니다. 이 기능은 오래된 파일을 정리하면서
사용자가 직접 넣은 jar를 지울 수 있기 때문입니다. 새 모드를 추가하려면
`mods.lock.json`에 URL과 해시를 고정하고 `install-mods`를 실행하세요.

브릿지 jar는 `minecraft-bridge/build/libs/MinecraftBridge-*.jar`에서 복사됩니다.
jar가 없으면 JDK 21이 있는 호스트에서 자동으로 `./gradlew build`를 실행합니다.

## 포트와 접근

| 포트 | 공개 | 용도 |
|---|---|---|
| TCP 25565 | 예 | Java 게임 접속 |
| TCP 25575 | 아니오 | RCON (백업/운영) |
| TCP 8765 | 아니오 | 브릿지 HTTP (`mc-discord` 내부) |
| TCP/UDP 19132 | 아니오 | Bedrock 미지원 |

OCI NSG/Security List는 TCP 25565만 허용하고 SSH 규칙을 유지하세요.
`mc.sh check`는 25575/8765/19132가 게시되면 실패합니다.

## 자원

- 게임: `mem_limit 8g`, `cpus 2.0`, JVM `-Xms2G -Xmx6G`
- 백업: `mem_limit 512m`, `cpus 0.25`, 낮은 `cpu_shares`
- 봇: 루트 compose에서 `384m`, `0.5 CPU`

2 OCPU 호스트에서 게임·백업·봇이 CPU를 공유합니다. 상한 합계는 예약량이 아닙니다.

## 게임 규칙

- `DIFFICULTY` 기본 `easy` (`server.properties`)
- 시작 시 RCON으로 세 차원에 `gamerule keepInventory true` 적용
- `online-mode=true`, `white-list=true`, `enforce-whitelist=true`
- `max-players`, view/simulation distance는 `.env`로 조정

기존 월드의 게임 규칙을 자동으로 되돌리지 않습니다. `keepInventory`는 의도적으로
매 시작 적용합니다.

## 화이트리스트

봇이 `/ops`의 `whitelistAddJava`/`whitelistRemoveJava`로 관리합니다.
브릿지는 서버의 공식 `Whitelist` API로 추가/제거하고 `save()`하므로
`whitelist.json`을 외부에서 덮어쓰지 않습니다. 서버가 꺼져 있을 때는 봇의 등록이
실패할 수 있으니, 서버 기동 후 등록하거나 `/화이트리스트동기-sync`를 사용하세요.

봇 없이 추가하려면:

```bash
./mc.sh command whitelist add Java이름
```

## 백업

- 24시간 간격, 기동 3분 후 첫 백업, 7일 보존
- zstd, RCON `save-off` → `save-all flush` → 백업 → `save-on`
- 공간 부족 시 `backup-space.sh`가 중단
- 백업 후 `backup-verify.sh`가 아카이브 전체를 읽어 검증
- 월드, Cobblemon 플레이어 데이터, config, 화이트리스트 포함
- 모드 jar는 제외 (lock 파일로 재설치)

수동 백업/검증:

```bash
./mc.sh backup
./mc.sh verify-backup backups-cobblemon/cobblemon-YYYYMMDD-HHMMSS.tar.zst
```

복구는 [RECOVERY.md](../docs/RECOVERY.md)를 따르세요.

## 점검

```bash
./mc.sh check
```

검증 항목:

1. Compose 구문과 컨테이너 health
2. Java 21, Fabric 프로세스
3. `server.properties`의 인증·화이트리스트·난이도·인원·시야
4. 모드 해시와 `fabric.mod.json` ID/버전
5. Bukkit/Paper 플러그인 jar 부재
6. RCON `list`, 1.21.1 기동, `keepInventory`, difficulty
7. 브릿지 `/health`와 `minecraft:true`
8. 25565 게시, 25575/8765/19132 미게시
9. 최신 백업 무결성(백업이 아직 없으면 경고)
10. 컨테이너 자원과 디스크

## 브릿지 설정

`data-cobblemon/config/minecraftbridge.json`:

```json
{
  "enabled": true,
  "botBaseUrl": "http://mcbot:47865",
  "bind": "0.0.0.0",
  "port": 8765,
  "secretFile": "/run/secrets/bridge_secret",
  "secret": "",
  "timeouts": { "botConnectMs": 3000, "botRequestMs": 3000, "syncTaskMs": 4000 },
  "queue": { "capacity": 200, "workers": 2, "retry": 1 }
}
```

시크릿 우선순위: `MC_BRIDGE_SECRET` 환경변수 → `secretFile` → `secret`.
값이 16자 미만이거나 `CHANGE_ME`이면 브릿지는 비활성화됩니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| `check`에서 Fabric 프로세스 실패 | `./mc.sh logs`에서 `fabric-server-mc.1.21.1-loader.0.20.1` 확인 |
| 브릿지 health 실패 | `data-cobblemon/config/minecraftbridge.json`의 `secretFile`, `docker logs minecraft`의 `MinecraftBridge` 로그 |
| 401 | 루트 `.env`의 `MC_BRIDGE_SECRET`와 `server/secrets/bridge_secret` 일치 여부 |
| 모드 검증 실패 | `./mc.sh install-mods` 재실행, 디스크/다운로드 확인 |
| 백업 공간 부족 | `backups-cobblemon/` 정리 또는 `BACKUP_RETENTION_DAYS` 조정 |
| Paper 월드를 열려고 함 | 지원하지 않음. [MIGRATION_FROM_PAPER.md](../docs/MIGRATION_FROM_PAPER.md) 참고 |
