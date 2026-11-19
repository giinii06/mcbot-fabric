#!/usr/bin/env bash
# Runs the Fabric bridge mod unit tests (JUnit 5).
set -euo pipefail
cd "$(dirname "$0")"
./gradlew --no-daemon --console=plain test
