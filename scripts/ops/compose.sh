#!/usr/bin/env bash
# Sourced by operator scripts; no eval and no secret output.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mode=${1:-preview}
case "$mode" in
  preview) project=${EMIL2_COMPOSE_PROJECT:-emil2-local-preview}; compose=(docker compose -p "$project" -f docker-compose.yml -f docker-compose.preview.yml) ;;
  production) project=${EMIL2_COMPOSE_PROJECT:-emil2-production}; compose=(docker compose --env-file .env.production -p "$project" -f docker-compose.production.yml) ;;
  *) echo "Режим: preview или production." >&2; exit 2 ;;
esac
if [[ -n ${EMIL2_COMPOSE_OVERRIDE:-} ]]; then compose+=(-f "$EMIL2_COMPOSE_OVERRIDE"); fi
checksum() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@";
  else sha256sum "$@"; fi
}
