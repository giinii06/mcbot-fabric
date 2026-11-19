# Paper에서 Fabric + Cobblemon으로 이전

이 저장소는 기존 Paper 26.3 서버를 **1.21.1 Fabric 서버로 다운그레이드하거나 변환하지
않습니다**. Paper 월드는 Minecraft 1.21.1에서 열 수 없으며, 자동 변환 도구도 지원하지
않습니다. 기존 데이터는 그대로 보존하고 새 Cobblemon 월드를 별도 디렉터리에 만듭니다.

## 보존되는 것

- `server/data/` 전체: 월드, `server.properties`, 플러그인 설정, 화이트리스트, ops
- 봇 SQLite: `data/mcbot.sqlite` (Java/Bedrock 등록 기록 포함)
- 기존 시크릿 파일: `server/secrets/` (있다면 재사용)
- 기존 백업: `server/backups/`

새 스택은 `server/data-cobblemon/`만 읽고 씁니다. `server/data/`를 마운트하지 않습니다.

## 이전할 수 없는 것

| 항목 | 이유 |
|---|---|
| Paper 26.3 월드 | 1.21.1보다 최신 데이터 버전. 열면 손상/거부 위험 |
| Paper 플러그인 jar | Fabric 모드와 호환되지 않음 |
| Geyser/Floodgate 설정 | Bedrock 미지원 |
| Paper `server.properties` | 새로 생성 (일부 값은 `.env`로 재설정) |
| 기존 월드의 keepInventory 외 게임 규칙 | 자동 복사하지 않음 |

## 절차

1. **기존 서버 백업**

   ```bash
   cd server
   ./mc.sh backup   # 기존 Paper 스택 기준
   ```

2. **기존 데이터 확인**

   ```bash
   ls -l data/level.dat
   ```

3. **새 스택 설치**

   ```bash
   # 기존 Paper .env가 있으면 새 키가 자동 보완됩니다.
   ./install.sh --new-world --no-start
   ```

   `--new-world`는 "기존 `data/`를 건드리지 않고 `data-cobblemon/`에 새 월드를
   만든다"는 명시적 동의입니다. 이 플래그 없이 `data/level.dat`가 있으면 설치가
   중단됩니다.

4. **봇 시크릿 연결**

   ```bash
   cat secrets/bridge_secret
   # 루트 .env의 MC_BRIDGE_SECRET에 같은 값 입력
   ```

5. **시작과 검증**

   ```bash
   ./mc.sh start
   ./mc.sh check
   cd .. && docker compose up -d --build
   curl -fsS http://127.0.0.1:47865/health
   ```

6. **Discord 등록**

   기존 Java 등록은 그대로 동작합니다. Bedrock 등록 명령은 지원 종료 안내를
   반환하며 DB 기록은 남습니다. 필요하면 `/유저해제`로 정리합니다.

## 기존 월드를 계속 쓰고 싶다면

Paper 26.3 서버를 별도 호스트/포트에서 계속 운영하세요. 이 저장소의 Fabric 스택과
동시에 같은 `server/data/`를 마운트하지 마세요. 두 서버가 같은 월드를 동시에 쓰면
손상됩니다.

## 되돌리기

새 스택을 중지하고 기존 Paper 스택으로 돌아가면 됩니다. `data-cobblemon/`과
`backups-cobblemon/`은 삭제하지 말고 보관하세요. 봇은 Java-only로 변경되었으므로
Bedrock 등록 UI는 이전 상태로 자동 복구되지 않습니다.
