# mcbot-fabric

Minecraft Java Edition 1.21.1용 Cobblemon 서버와 Discord 봇입니다. Discord에서 Java 계정을 등록하면 서버 화이트리스트에 추가됩니다. 봇은 접속, 채팅, 사망, 도전과제 알림을 지정된 Discord 채널에 보냅니다.

서버의 기본 난이도는 **평화로움**입니다. 서버가 시작될 때 오버월드, 네더, 엔드에 **소지품 유지**를 적용합니다. Bedrock Edition 접속과 신규 등록은 지원하지 않습니다.

## 서버에 접속하기

1. Discord에서 `/유저등록`을 실행해 본인의 Minecraft Java 닉네임을 등록하세요.
2. 공식 Minecraft Launcher에 Microsoft 계정으로 로그인한 뒤 런처를 완전히 종료하세요.
3. [최신 클라이언트 릴리스](https://github.com/giinii06/mcbot-fabric/releases/latest)에서 운영체제에 맞는 설치기를 받으세요. 비공개 저장소에 접근할 수 있는 GitHub 계정이 필요합니다.
   - **Windows x64**에서는 `MCBot-Cobblemon-Setup.exe`를 실행하세요.
   - **macOS 11 이상**에서는 `MCBot-Cobblemon-Setup-macOS.zip`을 풀고 **Cobblemon Setup.app**을 더블클릭하세요. Apple Silicon과 Intel을 모두 지원합니다.
4. 런처를 다시 열고 **Java Edition → 설치 설정 → Cobblemon Server**에서 실행하세요.
5. 게임의 **멀티플레이**에서 저장된 **Cobblemon Server**를 선택하세요.

설치기는 전용 게임 폴더에 Fabric과 모드를 설정하고, 모드 SHA256을 검증한 뒤 서버 주소를 저장합니다. macOS 앱은 Apple 공증을 받지 않았습니다. 첫 실행이 차단되면 [Apple의 앱 열기 안내](https://support.apple.com/ko-kr/102445)를 참고하세요.

### 수동 설치

공식 런처에서 Minecraft Java Edition `1.21.1`에 Fabric Loader `0.20.1`을 설치하세요. Fabric 프로필의 게임 폴더 아래 `mods`에 다음 두 파일을 넣으세요. [Fabric 설치기](https://fabricmc.net/use/installer/)

- [Fabric API `0.116.18+1.21.1`](https://modrinth.com/mod/fabric-api/version/5SwzqWUu)
- [Cobblemon `1.8.4F`](https://modrinth.com/mod/cobblemon/version/PdOzYHKU)

Fabric 프로필로 실행한 뒤 멀티플레이에서 운영자가 안내한 `호스트:포트`를 추가하세요. 기본 포트는 TCP `25565`입니다.

## Discord 명령

| 명령 | 기능 |
| --- | --- |
| `/유저등록 <마크아이디>` | 본인의 Java 계정 등록 및 화이트리스트 추가 |
| `/유저해제` | 등록 해제 |
| `/유저조회 <유저>` | 등록 정보, 플레이타임, 접속 상태 조회 |
| `/마크리더보드` | 플레이타임 순위 조회 |
| `/유저목록` | 등록 계정 목록 조회. 관리자 전용 |
| `/유저강제해제 <유저>` | 다른 유저의 등록 해제. 관리자 전용 |
| `/화이트리스트동기-sync` | 봇 등록 데이터와 서버 화이트리스트 동기화. 관리자 전용 |
| `/마크로그설치` | 이벤트 로그 채널 지정. 관리자 전용 |

`/유저등록베드락`은 지원 종료 안내를 표시합니다. 기존 Bedrock 등록은 `/유저해제`에서 정리할 수 있습니다.

도전과제 알림은 [한국어 제목 목록](src/minecraft/advancements.ko.json)에서 도전과제 ID로 찾습니다. 목록에 등록된 Cobblemon 1.8.4 제목 61개에는 `The World of Cobblemon!`의 공식 번역인 **코블몬의 세계에 잘 왔다!**가 포함됩니다. 목록에 없는 도전과제에는 서버에서 받은 제목을 표시합니다.

## 서버와 봇 배포

서버 호스트에는 Docker Engine, Docker Compose, `jq`, `unzip`, `curl`, `openssl`, `tar`, `zstd`가 필요합니다. Fabric 브릿지 모드를 호스트에서 빌드하려면 JDK 21을 설치하세요. Discord 명령 등록과 TypeScript 테스트에는 Bun을 사용합니다.

1. 저장소 루트와 `server/`에 있는 `.env.example`을 각각 같은 폴더의 `.env`로 복사하세요. 서버 파일의 `MC_UID`와 `MC_GID`를 호스트 사용자에 맞추세요. 봇의 Discord 토큰과 애플리케이션 ID는 루트 `.env`에 넣으세요.
2. 저장소 루트에서 서버 파일을 준비하세요.

   ```bash
   ./server/install.sh --no-start
   ```

   설치 스크립트가 `mc-discord` Docker 네트워크와 시크릿 파일을 만들고, 고정된 모드와 브릿지 JAR를 설치합니다. 기존 Paper 월드가 있으면 [이전 안내](docs/MIGRATION_FROM_PAPER.md)를 먼저 읽으세요.

3. `server/secrets/bridge_secret`의 값과 루트 `.env`의 `MC_BRIDGE_SECRET`을 일치시키세요. 실제 토큰과 시크릿은 Git에 넣지 마세요.
4. 저장소 루트에서 봇과 서버를 실행하세요.

   ```bash
   docker compose up -d --build --wait
   docker compose --project-directory server up -d --wait
   ./server/mc.sh check
   curl -fsS http://127.0.0.1:47865/health
   ```

   봇 상태 응답의 `ok`와 `minecraft`가 모두 `true`인지 확인하세요.

5. `bun install --frozen-lockfile` 후 `bun run minecraft:commands`로 전역 명령을 등록하세요. `bun run invite`가 출력한 URL에서 봇을 초대하고 Discord에서 `/마크로그설치`를 실행하세요.

자세한 환경 변수와 포트는 [서버 운영 안내](server/README.md)와 [OCI 배포 안내](docs/DEPLOY_OCI.md)를 참고하세요.

## 클라이언트 설치기 릴리스

GitHub 저장소 변수 `MINECRAFT_SERVER_ADDRESS`를 플레이어가 접속할 공개 `호스트:포트`로 설정하세요. 새 버전의 `client-v*` 태그를 푸시하면 GitHub Actions가 Windows EXE와 macOS 앱 ZIP을 빌드합니다. 각 운영체제에서 설치와 재설치 검증을 통과하면 두 파일을 같은 릴리스에 게시합니다. [릴리스 워크플로](.github/workflows/client-release.yml)

서버와 설치기가 공유하는 모드 버전, 다운로드 URL 및 해시는 [모드 목록](server/mods.lock.json)에 고정합니다.

## 개발과 운영 문서

| 경로 | 내용 |
| --- | --- |
| [`src/`](src/) | Bun, TypeScript, SQLite 기반 Discord 봇 |
| [`minecraft-bridge/`](minecraft-bridge/) | 게임 이벤트와 화이트리스트를 연결하는 Fabric 모드 |
| [`client/`](client/) | Windows와 macOS 클라이언트 설치기 |
| [`server/`](server/) | Docker Compose 서버, 게임 규칙, 백업과 점검 |
| [복구 절차](docs/RECOVERY.md) | 백업 확인과 월드 복구 |
| [브릿지 API](docs/minecraft-integration.md) | 인증, 이벤트, 서버 작업 |
| [검증 기록](server/VALIDATION.md) | 구축 및 운영 확인 결과 |

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run minecraft:test
```
