#!/usr/bin/env bash
# Builds the Minecraft bridge plugin jar (minecraft-bridge/build/libs/*.jar).
set -euo pipefail
cd "$(dirname "$0")"
./gradlew --no-daemon --console=plain clean jar
ls -la build/libs/
