#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS="$ROOT/.certs"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required. Install it, then rerun make dev-cert." >&2
  exit 1
fi

mkdir -p "$CERTS"
mkcert -install
mkcert \
  -cert-file "$CERTS/dev-cert.pem" \
  -key-file "$CERTS/dev-key.pem" \
  localhost 127.0.0.1 ::1
