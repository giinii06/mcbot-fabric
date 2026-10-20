# Oracle ARM64 Paper 생존 서버

2 OCPU / 12GB 호스트용 Java 전용 10인 서버입니다. Paper **26.3 #205 STABLE**과
`itzg/minecraft-server:java25`(ARM64 지원)를 사용합니다. 게임 버전과 빌드는 고정되며 자동으로 올리지 않습니다.
공식 출처: [Paper API](https://fill.papermc.io/v3/projects/paper/versions/26.3/builds/205),
[Java 요구사항](https://docs.papermc.io/paper/getting-started/),
[itzg 설정](https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/server-types/paper/).

## 구성과 설치

`server/`가 설치 경로이며 `data/`는 모든 월드·설정·플러그인, `backups/`는 압축 백업,
`secrets/rcon_password`는 RCON 비밀번호(600)입니다. `.env`도 600으로 보관합니다.
Docker Engine + Compose, curl, openssl, bash가 필요합니다. Docker 데몬은 부팅 시 실행되어야 합니다
(`systemctl is-enabled docker`; 필요하면 `sudo systemctl enable --now docker`).

```bash
cd server
./install.sh --no-start  # 호스트 검사, UID/GID 설정, 시크릿 생성, 해시 검증, 이미지 준비
./mc.sh start
./mc.sh logs -f         # Done (...)! 및 healthy 확인
./mc.sh check
```

기존 `.env`와 월드는 덮어쓰지 않습니다. 구 Leaf `.env` 또는 기존 server.properties가 있으면
설치기는 자동 업그레이드를 중단합니다. 아래 이전 절차를 먼저 수행하세요.
Docker가 없을 때 임의 원격 설치 스크립트를 실행하지 않으며 공식 설치 주소를 안내합니다.
`--no-start`도 파일 생성·이미지 다운로드를 수행하지만 게임은 시작하지 않습니다.

| 설정 | 기본값 |
|---|---|
| 힙 / 컨테이너 메모리 | Xms 2G / Xmx 6G / 게임 8g |
| CPU | 게임 상한 2.0, 백업 0.25·낮은 CPU shares |
| 백업 메모리 | 512m |
| 게임 | survival, peaceful(고정), PvP 켬, 10명 |
| 인증·접속 제한 | online-mode, white-list, enforce-whitelist 모두 true |
| 시야 / 시뮬레이션 | 6 / 4 |
| GC | Java 25 기본 G1, Aikar/MeowIce 플래그 없음 |
| 공개 포트 | TCP 25565만; RCON 25575·브릿지 8765는 호스트 미게시 |

게임과 백업·봇은 같은 2 OCPU를 공유합니다. CPU 상한 합계는 예약량이 아니며,
동시 부하에서는 서로 경쟁합니다. 다른 상주 서비스가 있으면 메모리 여유를 계속 확인하세요.
Paper 기본 chunk workers, 엔티티 활성·추적 범위, 몹 스폰, 호퍼, 주민 AI, 레드스톤,
자동저장·네트워크 설정을 임의 변경하지 않습니다. 빈 서버 틱 정지는 끄고 백업 RCON 응답을 유지합니다.
Paper 자체의 바닐라 차이는 남아 있으며 완전히 동일한 엔진은 아닙니다.

## TypeScript Discord 봇 연결

기존 `/ops`, `/bridge/events`, 공유 시크릿 인증을 그대로 사용합니다.
26.1+의 `world/players/stats/` 경로를 사용하며 이전 버전의 `world/stats/` 조회도 지원합니다.
브릿지는 인원 제한·keepInventory를 강제하지 않고 서버 설정과 기존 월드 규칙을 따릅니다.
신규 월드는 기본 생존 규칙을 사용하며 기존 월드의 keepInventory 값은 자동 변경하지 않습니다.

리포 루트에서:

```bash
bun install --frozen-lockfile
bun run minecraft:build-plugin
mkdir -p server/data/plugins
cp minecraft-bridge/build/libs/MinecraftBridge-1.0.0.jar server/data/plugins/
```

1. 루트 `.env.example`을 `.env`로 복사하고 Discord 토큰·애플리케이션 ID를 입력합니다.
2. `openssl rand -hex 32`로 공유 시크릿을 만들어 루트 `.env`의 `MC_BRIDGE_SECRET`과
   `data/plugins/MinecraftBridge/config.yml`의 `bot.secret`에 동일하게 설정합니다.
   플러그인 설정 템플릿은 `minecraft-bridge/src/main/resources/config.yml`입니다.
   값은 커밋·출력하지 말고 두 설정 파일의 권한을 600으로 유지합니다.
3. `bot.base-url: http://mcbot:47865`, `MC_BRIDGE_BASE_URL=http://minecraft:8765`,
   `server.bind: 0.0.0.0`를 유지합니다. 양쪽 Compose는 `mc-discord` 네트워크를 공유합니다.
4. `cd server && ./mc.sh restart`, 루트에서 `docker compose up -d --build` 실행.
5. `curl -fsS http://127.0.0.1:47865/health`의 `minecraft:true` 확인.

봇이 화이트리스트를 관리하므로 `WHITELIST` 목록 환경변수를 추가하지 마세요.
Discord에서 `/유저등록`을 사용합니다.
봇 없이 운영할 때만 `./mc.sh command whitelist add Java이름`으로 추가합니다.
Geyser/Floodgate/ViaVersion과 Bedrock UDP 포트는 이 호스팅 구성에 포함하지 않습니다.
봇의 Bedrock 기능은 소스에 남아 있지만 이 Java 전용 서버에서는 사용하지 않습니다.

## 운영·성능 측정

```bash
./mc.sh start
./mc.sh stop                 # 백업 먼저 정지, save-all flush, 정상 종료(120초 유예)
./mc.sh restart
./mc.sh status               # 자원·디스크·컨테이너 상태
./mc.sh logs -f              # 게임 + 백업 로그
./mc.sh players
./mc.sh tps
./mc.sh mspt
./mc.sh command spark healthreport
./mc.sh command spark profiler start --timeout 120
```

`restart: unless-stopped`로 오류 종료와 Docker 재부팅 후 재시작합니다. 수동으로 정지한
서버는 재부팅해도 정지 상태를 유지합니다. healthcheck 실패만으로 자동 재시작하지는 않습니다.
Spark는 Paper 내장 기능을 사용합니다. 프로파일 링크에는 서버 정보가 포함될 수 있습니다.
실제 접속 중 평균·95백분위 MSPT, GC 정지, CPU·힙, 청크 생성, 엔티티·블록 엔티티를 확인하세요.
20 TPS 예산은 틱당 50ms입니다. 95백분위가 이를 자주 넘으면 프로파일의 상위 작업부터 확인합니다.
10명 실접속 시험 전에는 20 TPS 보장을 주장할 수 없습니다. 신규 청크 탐험·몹팜·주민이 예상 CPU 병목입니다.

## 선택적 사전 생성

[Chunky 1.5.3](https://modrinth.com/plugin/chunky/version/MdY6JATr)은 Paper 26.3 호환 release로 확인했고
URL·SHA256을 고정했습니다. 필요할 때만 설치합니다. 월드명은 기본 `world` 기준입니다.

```bash
./mc.sh install-chunky
./mc.sh restart
./mc.sh pregen-overworld      # 원형 반경 2000, 중심 0,0
./mc.sh pregen-status
./mc.sh pregen-pause
./mc.sh pregen-continue
# 오버월드 완료 후 별도로 실행
./mc.sh pregen-nether         # 원형 반경 1000
```

26.1+는 `world/dimensions/minecraft/{overworld,the_nether,the_end}`에 차원을 저장합니다.
Chunky에서는 Bukkit 월드 이름을 사용합니다. `./mc.sh command chunky world`로 실제 이름을 확인하세요.
시작 시 플레이어 0명·디스크 여유 10GiB 이상을 검사합니다. 진행 중에는 접속을 제한하고
상태를 관찰하세요. 사람이 들어오거나 MSPT가 오르면 `pregen-pause`로 중단합니다.
모든 월드를 동시에 생성하지 않으며 엔드는 필요할 때 수동으로 선택합니다.

## 백업과 복구

첫 부팅 후 3분 뒤, 그 뒤 **24시간 간격**으로 zstd 단일 스레드 압축 백업을 만듭니다.
실행 기준 간격이므로 고정 시각 예약은 아닙니다. 7일 보관하며 하루 이상 서비스가 중단되면
그 기간 백업은 생성되지 않습니다. 저장 공간은 원본 크기 + 1GiB 이상을 요구합니다.
RCON으로 `save-off` → `save-all flush` → 압축 → `save-on`을 수행합니다.
쓰기 재개 후 전체 아카이브를 읽어 무결성을 검증하고 실패하면 로그·비정상 종료로 알립니다.
강제 종료 중 백업 실패 시 `./mc.sh command save-on`을 확인하세요.
압축 중에도 틱은 진행하지만 저장 flush·디스크 읽기 부하는 남습니다.

백업은 오버월드·네더·엔드, 서버·플러그인 설정, whitelist/ops를 포함합니다.
JAR·로그·캐시·RCON CLI 인증 파일은 제외합니다. 설정을 수정하거나 화이트리스트를 동기화하는
작업은 백업과 겹치지 않게 하세요. 엄격한 전체 파일 일관성이 필요한 이전에는 서버를 정지한 복사본도 보관하세요.
브릿지 시크릿은 백업에 포함되므로 `backups/`를 비공개로 보관합니다.
봇 SQLite·루트 `.env`·`server/.env`·RCON 시크릿은 게임 백업 밖이므로 별도로 안전하게 보관해야 합니다.

```bash
./mc.sh backup
./mc.sh verify-backup backups/world-실제파일명.tar.zst
./mc.sh logs -f minecraft-backup
```

복구는 먼저 파일 목록과 무결성을 확인한 **신뢰하는 백업**으로만 합니다.

```bash
./mc.sh verify-backup backups/world-실제파일명.tar.zst
./mc.sh stop
mv data "data.before-restore-$(date +%Y%m%d-%H%M%S)"
mkdir data
# 백업 이미지의 tar/zstd 사용, 게임 컨테이너는 시작하지 않음
# 복원 파일 소유권 유지를 위해 .env의 MC_UID:MC_GID 숫자로 USER값을 교체
# (예: --user 1001:1001)
docker compose run --rm --no-deps --user 1001:1001 -v "$PWD/data:/restore" --entrypoint tar minecraft-backup \
  --zstd -xf /backups/world-실제파일명.tar.zst -C /restore
```

백업 서비스의 `/data`는 읽기 전용이므로 별도의 `/restore` 마운트를 사용합니다. 복원 후 고정 Paper JAR 및 브릿지 JAR를 다시 배치하고
`./mc.sh start`, `./mc.sh check`로 확인합니다. 기존 `data.before-restore-*`는 삭제하지 않습니다.
별도 기존 스토리지로 복제할 수 있으나 새 OCI 볼륨·버킷은 자동 생성하지 않습니다.

## 기존 Leaf 이전·업데이트

기존 서버를 이 커밋으로 바꾸기 **전**, 구 스크립트로 백업·정지하고 data와 .env를 별도 복사합니다.
신규 버전에서 열린 월드는 구 버전으로 안전하게 다운그레이드할 수 없습니다.

1. `.env`를 보존한 뒤 `.env.example`의 Paper 버전·빌드·SHA256·메모리·백업 값으로 수동 이관합니다.
2. 이전 Geyser/Floodgate/ViaVersion/Chunky JAR는 data 바깥의 보관 폴더로 이동합니다. 설정·키는 삭제하지 않습니다.
3. 브릿지를 새로 빌드·배치합니다. 기존 keepInventory는 원하면 차원마다 직접 변경합니다.
4. `./mc.sh download-paper`, `docker compose pull minecraft`, `./mc.sh start`, `./mc.sh check`.
5. 문제 발생 시 정지하고 **업그레이드 전 월드와 당시 설정·이미지**를 복구합니다.

향후 업데이트도 공식 STABLE 빌드·플러그인 호환 확인 → 백업·정지 → 버전·빌드·URL·SHA256
동시 수정 → 이미지 pull → 기동·검증 순서입니다. `latest` 또는 자동 플러그인 업데이트는 사용하지 않습니다.
Java25/백업 이미지 태그는 가변이므로 정확한 이미지 재현이 필요하면 검증한 digest를 함께 기록하세요.

## 외부 접속

주소는 `<OCI 공개 IP>:25565`입니다. 설치기는 공개 IP를 추정하거나 NSG를 변경하지 않습니다.
OCI ingress는 친구 IP CIDR에서 TCP 목적지 25565를 허용하고 SSH 22 규칙을 유지하세요.
필요한 경우에만 `0.0.0.0/0`을 사용합니다. 호스트 방화벽·Docker 전달 규칙도 별도로 확인하세요.
25575/8765/47865를 외부에 열거나 Docker 소켓을 게시하지 마세요. 방화벽 전체 초기화는 하지 않습니다.
