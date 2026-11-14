#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Idempotent: preserves existing files and data. Do not reset the database.
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
if [[ "${CODEX_SKIP_DATABASE:-0}" != "1" ]]; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    compose=(docker compose -f docker-compose.yml)
    if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then compose+=(-f docker-compose.cloud.yml); fi
    "${compose[@]}" up -d postgres minio mailpit
    for attempt in {1..60}; do
      if docker compose exec -T postgres pg_isready -U app -d app >/dev/null 2>&1; then break; fi
      if [[ "$attempt" == 60 ]]; then echo "PostgreSQL readiness timed out" >&2; exit 1; fi
      sleep 1
    done
  fi
  corepack pnpm db:migrate
  corepack pnpm db:seed
fi
