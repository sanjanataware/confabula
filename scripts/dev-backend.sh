#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-web}"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Create $ENV_FILE from .env.example before starting the backend." >&2
  exit 1
fi

cd "$ROOT/apps/backend"
case "$MODE" in
  web)
    [[ -f "$ROOT/.certs/dev-cert.pem" && -f "$ROOT/.certs/dev-key.pem" ]] || {
      echo "Run make dev-cert before the HTTPS backend." >&2
      exit 1
    }
    exec uv run --env-file "$ENV_FILE" uvicorn language_coach.main:app \
      --host 127.0.0.1 --port 8444 --no-access-log \
      --ssl-certfile "$ROOT/.certs/dev-cert.pem" \
      --ssl-keyfile "$ROOT/.certs/dev-key.pem"
    ;;
  android)
    BACKEND_PUBLIC_BASE_URL=http://127.0.0.1:8000 \
    ALLOW_INSECURE_LOOPBACK_DEBUG=true \
      exec uv run --env-file "$ENV_FILE" uvicorn language_coach.main:app \
        --host 127.0.0.1 --port 8000 --no-access-log
    ;;
  *)
    echo "Usage: $0 web|android" >&2
    exit 2
    ;;
esac
