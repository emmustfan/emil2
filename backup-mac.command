#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -d /Applications/Docker.app/Contents/Resources/bin ]]; then export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"; fi
echo "На время копирования сайт и обработчик ненадолго остановятся, затем запустятся снова."
bash scripts/ops/backup.sh preview
if command -v open >/dev/null 2>&1; then open "${EMIL2_BACKUP_DIR:-$HOME/Documents/Emil2-Backups}"; fi
