# 백업과 복구

백업은 `minecraft-backup` 사이드카가 수행합니다. 백업 파일은
`server/backups-cobblemon/`에 zstd tar로 저장됩니다.

## 정책

| 항목 | 값 |
|---|---|
| 주기 | 24시간 |
| 첫 백업 | 기동 3분 후 |
| 보존 | 7일 |
| 압축 | zstd (`-3 -T1`) |
| 정합성 | RCON `save-off` → `save-all flush` → 백업 → `save-on` |
| 공간 검사 | 백업 전 `backup-space.sh` |
| 무결성 | 백업 후 `backup-verify.sh`가 전체 아카이브 읽기 |
| 포함 | 월드 3차원, playerdata, Cobblemon 데이터, config, 화이트리스트 |
| 제외 | 모드 jar, logs, cache, libraries, versions, 임시 파일 |

모드 jar는 `mods.lock.json`으로 다시 설치할 수 있으므로 제외합니다. 월드와
Cobblemon 플레이어 데이터는 항상 포함됩니다.

## 수동 백업

```bash
cd server
./mc.sh backup
```

서버가 실행 중이어야 합니다. 백업이 끝나면 최신 아카이브를 자동 검증합니다.

## 백업 확인

```bash
./mc.sh verify-backup backups-cobblemon/cobblemon-YYYYMMDD-HHMMSS.tar.zst
tar --zstd -tf backups-cobblemon/cobblemon-YYYYMMDD-HHMMSS.tar.zst | head
```

## 복구

복구는 서버를 중지한 뒤 수행합니다.

```bash
cd server
./mc.sh stop
./mc.sh restore backups-cobblemon/cobblemon-YYYYMMDD-HHMMSS.tar.zst
./mc.sh start
./mc.sh check
```

`restore` 동작:

1. 아카이브 전체를 읽어 무결성 확인
2. 임시 디렉터리에 추출
3. `level.dat` 존재 확인
4. 기존 `data-cobblemon/`을 `data-cobblemon.before-restore-<시각>/`으로 이동
5. 새 데이터로 교체
6. 보호 사본의 모드 jar를 새 `mods/`로 복사 (백업에 jar가 없으므로)
7. 실패 시 기존 데이터는 그대로 유지

복구 후 `./mc.sh check`가 통과하면 보호 사본을 정리할 수 있습니다.

```bash
rm -rf data-cobblemon.before-restore-*
```

## 장애 대응

| 상황 | 대응 |
|---|---|
| 백업 공간 부족 | 오래된 아카이브 정리, `BACKUP_RETENTION_DAYS` 조정 |
| 백업 파일 손상 | 이전 아카이브로 복구, `verify-backup`으로 확인 |
| 월드 손상 | 최신 정상 백업으로 복구, 원인 로그 보존 |
| 모드 누락 | `./mc.sh install-mods` |
| 시크릿 분실 | `server/secrets/bridge_secret` 재생성 후 루트 `.env` 갱신 |
| 복구 실패 | `data-cobblemon.before-restore-*`가 그대로 남아 있음. 서버를 켜지 말고 아카이브를 다시 확인 |

## 주의

- 백업 중 `save-off` 상태가 길어지면 게임 저장이 멈출 수 있습니다. 사이드카 로그를
  확인하고, 실패 시 RCON으로 `save-on`을 실행하세요.
- 같은 `data-cobblemon/`을 두 서버가 동시에 마운트하지 마세요.
- 복구 후 첫 백업이 생성되기 전까지는 새 백업을 신뢰하지 마세요.
