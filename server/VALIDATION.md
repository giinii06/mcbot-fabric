# 구축·검증 기록

2026-10-20 도전과제 한국어화: Minecraft 26.3 공식 한국어 리소스와 기본 도전과제의 ID를
매칭하여 제목·설명 126개 전체를 검증했습니다. Bun 127개·타입 검사 통과 후 봇만 재배포했습니다.
목록에 없는 도전과제는 원문을 유지하며, 실제 플레이어 달성 알림의 Discord 표시 확인은 별도입니다.

채팅 출력 후속 변경: `player.chat`은 임베드 대신 일반 `content` 메시지로 전송합니다.
멘션 알림·링크 미리보기를 차단하고 Discord 2000자 제한을 적용했습니다.
일반 메시지/기존 임베드의 REST 요청, 인증·중복 제거·채널 전달을 포함해 Bun 125개와 타입 검사를 통과했습니다.

추가 운영 설정: `server/compose.yaml`의 `DIFFICULTY`를 `peaceful`로 고정하고 상태 검사도
이에 맞췄습니다. 실행 중인 세 차원에 적용·저장한 뒤 컨테이너를 재생성하여 고정 환경변수를 반영했습니다.

2026-10-19 후속 변경: 일반 채팅을 기존 Discord 로그 채널로 전달하는 `player.chat` 이벤트를
추가하고 봇·MinecraftBridge를 재배포했습니다. 채팅 이벤트→HTTP 전송, HTTP 인증·중복 제거→
로그 채널 전달, 빈 메시지·길이 제한·마크다운 처리를 포함해 Bun 124개·JUnit 61개와 타입 검사를 통과했습니다.
실제 플레이어의 채팅→Discord 게시까지의 실사용 확인은 별도이며, 아래 최초 구축 기록과 구분합니다.
이후 요청에 따라 세 차원의 keep_inventory도 true로 저장했으며 재시작 후 유지 여부를 확인했습니다.

2026-10-19 18:31 KST 기준. 아래 성능은 **실제 플레이어 0명** 상태의 관측값입니다.

| 항목 | 결과 |
|---|---|
| 실제 설치 | `/home/ubuntu/cod/mcbot/server`, 새 월드 생성, 기존 Minecraft 데이터 없음 |
| 호스트 | Ubuntu 24.04.4, Linux 7.0.0-1013-oracle, ARM64, 2 CPU, RAM 11925MiB, ext4 |
| 런타임 | Minecraft/Paper 26.3 #205 STABLE, Temurin Java 25.0.4.1 ARM64 |
| 실행 | `minecraft` healthy, `minecraft-backup` running |
| JVM | 실제 명령행 `-Xms2G -Xmx6G`, 컨테이너 메모리 상한 8GiB |
| 게임 설정 | Survival, Normal, PvP, 최대 10, view 6 / simulation 4 |
| 인증 | online-mode·화이트리스트·화이트리스트 강제 모두 true |
| 플러그인 | MinecraftBridge 1.0.0, Chunky 1.5.3 로딩 성공, Spark 내장 |
| 게임 규칙 | 신규 월드 keep_inventory=false, 브릿지의 강제 변경 제거 |
| TCP | 호스트 25565 게시 및 Minecraft health ping 통과; RCON/8765 미게시 |
| 관측 자원 | 게임 CPU 2.80%(Docker 1 CPU=100%), RAM 1.45GiB; 백업 대기 CPU 0%, RAM 3.188MiB |
| 관측 TPS | 1/5/15분 표시 20.0; 서버 실행 시간이 짧아 긴 구간은 충분한 표본이 아님 |
| 관측 MSPT | 최근 1분 평균 1.0ms, 최소 0.3ms, 최대 61.0ms(시작 직후 포함); 95백분위 미측정 |
| 백업 | `backups/world-20261019-183141.tar.zst` 생성·무결성 검증 성공 |
| 일정 | 첫 시작 후 3분, 이후 24시간 간격, 최근 7일 보관 설정 |
| 복원 | 앞선 검증 백업을 `backups/restore-check/`에 추출; 세 차원 region·level.dat·설정·화이트리스트·브릿지 설정 확인 |
| 재시작 | 저장 flush → 백업·게임 정상 종료 → 재기동 → healthy 확인 |
| 자동 실행 | Docker systemd enabled, 두 컨테이너 restart=unless-stopped; 호스트 재부팅 시험은 생략 |

기본 G1 GC와 Paper 자체 생성 설정을 사용했습니다. 이미지의 외부 기본 설정 다운로드를
`SKIP_DOWNLOAD_DEFAULTS=true`로 차단했습니다. 엔티티·몹팜·호퍼·주민·레드스톤 규칙과
GC 스레드를 임의 조정하지 않았습니다. 초기 다운로드 설정은 `backups/initial-image-defaults/`에 보관했습니다.

검증 결과:

- Bun 테스트 120개 통과, TypeScript 타입 검사 통과.
- Java JUnit 60개 통과, 플러그인 빌드 성공. 구·신 통계 경로와 마이그레이션 후 우선순위 검사 포함.
- 실제 Docker 네트워크에서 기존 TypeScript `BridgeClient`의 health/status/온라인/화이트리스트 조회 성공.
- 플러그인의 인증된 시작 이벤트를 기존 TypeScript 이벤트 스키마로 수신, max=10 확인.
- 임시 통계 파일 123400틱을 실제 `/ops`로 조회하여 6170초·source=file 확인 후 해당 임시 파일만 제거.
- Chunky `world`·`world_nether` 선택 성공, 진행 작업 없음. 사전 생성은 실행하지 않음.
- 백업 저장 중단·flush·쓰기 재개·압축 파일 전체 읽기 검증 성공. 복원은 운영 월드와 별도 경로에서 수행.

최초 검증에서는 인증된 임시 수신기로 양방향 연결을 확인했고, 후속 요청에서 제공된
Discord 자격 증명을 루트 `.env`(600, git 제외)에 저장하여 실제 봇도 배포했습니다.
`mcbot` 컨테이너가 healthy 상태이며 `기니크래프트#5689`로 Discord 로그인에 성공했습니다.
봇 health는 `{"ok":true,"minecraft":true}`이고 전역 슬래시 명령 8개를 등록했습니다.
restart=unless-stopped, 관측 메모리 57.24MiB / 384MiB, CPU 0.13%입니다.
현재 참여한 Discord 서버는 0개이므로 봇 초대가 필요합니다. 초대 후 `/마크로그설치`로
로그 채널을 설정하고 `/유저등록`을 사용하세요. 실제 Discord 명령 실행·채널 메시지 전송은 아직 검증하지 않았습니다.

관리 명령은 [운영 문서](README.md)를 따릅니다. 재시작은 `./mc.sh restart`,
친구 추가는 Discord `/유저등록` 또는 봇 없이 `./mc.sh command whitelist add Java이름`입니다.

외부 접속 주소는 `<OCI 공개 IP>:25565`입니다. 공개 IP·OCI NSG/Security List·호스트 방화벽의
외부 허용 여부는 검증하지 않았습니다. 친구 CIDR의 TCP 25565 ingress만 추가하고 SSH 접근을 유지하세요.
10명 동시 접속·GC 정지시간·95백분위 MSPT·장기 장애 복구는 미측정입니다.
예상 병목은 2 OCPU에서의 신규 청크 탐험·엔티티 부하이며, 빈 시간대 사전 생성과 Spark 실측을 우선합니다.

검증 시 사용한 이미지 digest(태그는 가변):

```text
itzg/minecraft-server@sha256:e02138323fb1bd9bac652db8add563deb109cfb36c363cdbc948bdaf0a33df00
itzg/mc-backup@sha256:c5f2c369bbe47d0b712601bf44af5927e67a18cb5816dc378efb45eb993dab0a
```
