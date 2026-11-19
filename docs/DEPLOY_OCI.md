# OCI 배포

대상: Ubuntu ARM64, 2 OCPU / 12GB, Docker Engine + Compose. 이 문서는 공인 IP와
NSG/Security List를 직접 변경하지 않습니다. 아래 값은 사용자가 OCI 콘솔에서 확인해야
합니다.

## 1. 호스트 준비

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 jq unzip curl openssl tar zstd git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # 재로그인
docker compose version
```

JDK 21은 브릿지를 호스트에서 빌드할 때만 필요합니다. 빌드한 jar를 포함해 배포한다면
게임 호스트에는 필요하지 않습니다.

```bash
sudo apt-get install -y openjdk-21-jdk-headless
java -version
```

## 2. 소스와 시크릿

```bash
git clone git@github.com:giinii06/mcbot-fabric.git ~/mcbot
cd ~/mcbot

cd server
cp .env.example .env
chmod 600 .env
# MC_UID/GID를 호스트 사용자에 맞추고 DIFFICULTY=peaceful을 확인
./install.sh --no-start
```

`install.sh`가 `server/secrets/rcon_password`와 `server/secrets/bridge_secret`를
생성합니다. 브릿지 시크릿은 루트 `.env`의 `MC_BRIDGE_SECRET`와 같아야 합니다.

```bash
cd ..
cp .env.example .env
chmod 600 .env
# DISCORD_TOKEN, DISCORD_APPLICATION_ID 입력
# server/secrets/bridge_secret 값을 MC_BRIDGE_SECRET에 입력
```

값을 셸 기록이나 Git에 남기지 마세요.

## 3. 시작

```bash
docker compose up -d --build --wait
docker compose --project-directory server up -d --wait
./server/mc.sh check
curl -fsS http://127.0.0.1:47865/health
```

정상이라면 `{"ok":true,"minecraft":true}`가 반환됩니다.

## 4. OCI 네트워크

Security List/NSG ingress:

| 소스 | 프로토콜 | 목적지 포트 | 용도 |
|---|---|---|---|
| 친구 CIDR | TCP | 25565 | Java 게임 |
| 관리 CIDR | TCP | 22 | SSH |

다음 포트는 열지 않습니다: **25575 (RCON), 8765 (브릿지), 19132 (Bedrock)**.
Docker는 iptables를 직접 조작할 수 있으므로 호스트 UFW만 확인하지 말고 OCI NSG도
함께 확인하세요.

## 5. 재부팅 후 자동 시작

```bash
systemctl is-enabled docker
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' minecraft
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' minecraft-backup
```

두 컨테이너 모두 `unless-stopped`여야 합니다. 호스트 재부팅 후:

```bash
cd ~/mcbot/server && ./mc.sh check
```

## 6. 업데이트

버전은 `mods.lock.json`, `.env`, compose digest에 고정되어 있습니다. 자동 업데이트는
없습니다. 업데이트 절차:

```bash
cd ~/mcbot/server
./mc.sh backup
./mc.sh stop
# mods.lock.json / compose / .env 수정
./mc.sh install-mods
./mc.sh verify-mods
./mc.sh start
./mc.sh check
```

Paper 26.3 월드를 이 호스트에서 1.21.1로 열지 마세요. 필요하면 별도 호스트에서
기존 Paper 서버를 유지합니다.
