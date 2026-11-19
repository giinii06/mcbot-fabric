#!/usr/bin/env bash
# Builds the Fabric bridge mod jar (minecraft-bridge/build/libs/*.jar).
set -euo pipefail
cd "$(dirname "$0")"
./gradlew --no-daemon --console=plain clean build
ls -la build/libs/
