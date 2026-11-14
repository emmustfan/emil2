#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Use the existing isolated checkout; do not create additional Git worktrees.
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi
# Docker may be unavailable in cloud. Unit tests and the static page do not need it.
# Set CODEX_SKIP_DATABASE=1 only when deliberately preparing a unit-only environment.
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
  # Also supports an externally provisioned PostgreSQL + vector via DATABASE_URL.
  corepack pnpm db:migrate
  corepack pnpm db:seed
fi
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$PWD/tmp/playwright}"
corepack pnpm exec playwright install chromium
