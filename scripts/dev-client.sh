#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-web}"
cd "$ROOT/apps/client"

case "$MODE" in
  web)
    [[ -f "$ROOT/.certs/dev-cert.pem" && -f "$ROOT/.certs/dev-key.pem" ]] || {
      echo "Run make dev-cert before the HTTPS web client." >&2
      exit 1
    }
    npx expo start --web --host localhost &
    EXPO_PID=$!
    trap 'kill "$EXPO_PID" 2>/dev/null || true' EXIT INT TERM
    npx local-ssl-proxy \
      --source 8443 --target 8081 \
      --cert "$ROOT/.certs/dev-cert.pem" \
      --key "$ROOT/.certs/dev-key.pem"
    ;;
  android)
    command -v adb >/dev/null 2>&1 || {
      echo "adb is required for the device-local Android workflow." >&2
      exit 1
    }
    adb reverse tcp:8000 tcp:8000
    EXPO_PUBLIC_LOOPBACK_DEBUG=1 exec npx expo start --android --host lan
    ;;
  *)
    echo "Usage: $0 web|android" >&2
    exit 2
    ;;
esac
